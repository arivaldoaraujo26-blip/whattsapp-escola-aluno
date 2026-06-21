import { GoogleGenAI, Type } from "@google/genai";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { DomainError } from "../domain/errors.js";
import type { LlmClient, IdentifyRequest, IdentifyResult } from "./llm-client.js";
import { TokenBucketRateLimiter } from "./rate-limiter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MODEL = "gemini-2.5-flash";

const GeminiIdentifySchema = z.object({
  intent: z.enum(["single", "class", "ambiguous", "unknown"]),
  matched_student_name: z.string().optional(),
  matched_guardian_name: z.string().optional(),
  class_id: z.string().optional(),
  content: z.string().optional(),
  confidence: z.number(),
  ambiguity_candidates: z
    .array(
      z.object({
        student_name: z.string(),
        guardian_name: z.string(),
        label: z.string(),
      }),
    )
    .optional(),
});

function buildRosterText(
  roster: IdentifyRequest["roster"],
): string {
  return roster
    .map((s) => {
      const guardians = s.guardians
        .map((g) => `  - ${g.name} (${g.role})`)
        .join("\n");
      return `- ${s.student_name}\n${guardians}`;
    })
    .join("\n");
}

function lookupIds(
  roster: IdentifyRequest["roster"],
  studentName: string | undefined,
  guardianName: string | undefined,
): { student_id?: string; guardian_id?: string } {
  if (!studentName) return {};

  const student = roster.find(
    (s) => s.student_name.toLowerCase() === studentName.toLowerCase(),
  );
  if (!student) return {};

  const guardian =
    guardianName !== undefined
      ? student.guardians.find(
          (g) => g.name.toLowerCase() === guardianName.toLowerCase(),
        )
      : undefined;

  return { student_id: student.student_id, guardian_id: guardian?.guardian_id };
}

export class GeminiLlmClient implements LlmClient {
  private readonly client: GoogleGenAI;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly promptTemplate: string;

  constructor(apiKey?: string, rateLimiter?: TokenBucketRateLimiter) {
    this.client = new GoogleGenAI({
      apiKey: apiKey ?? process.env["GEMINI_API_KEY"] ?? "",
    });
    this.rateLimiter = rateLimiter ?? new TokenBucketRateLimiter(10);
    this.promptTemplate = readFileSync(
      join(__dirname, "../../prompts/identify.md"),
      "utf-8",
    );
  }

  async identify(input: IdentifyRequest): Promise<IdentifyResult> {
    this.rateLimiter.consume();

    const requestId = randomUUID();
    const rosterText = buildRosterText(input.roster);
    const prompt = this.promptTemplate
      .replace("{{ROSTER}}", rosterText)
      .replace("{{TEXT}}", input.text);

    console.info(
      JSON.stringify({
        event: "llm.identify.request",
        request_id: requestId,
        roster_count: input.roster.length,
        text_length: input.text.length,
      }),
    );

    let responseText: string;
    try {
      const response = await this.client.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              intent: {
                type: Type.STRING,
                enum: ["single", "class", "ambiguous", "unknown"],
              },
              matched_student_name: { type: Type.STRING },
              matched_guardian_name: { type: Type.STRING },
              class_id: { type: Type.STRING },
              content: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              ambiguity_candidates: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    student_name: { type: Type.STRING },
                    guardian_name: { type: Type.STRING },
                    label: { type: Type.STRING },
                  },
                },
              },
            },
            required: ["intent", "confidence"],
          },
        },
      });
      responseText = response.text ?? "";
    } catch (err) {
      throw new DomainError(
        "llm_unavailable",
        `Gemini API error: ${String(err)}`,
      );
    }

    if (!responseText) {
      throw new DomainError("llm_unavailable", "Gemini returned empty response");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new DomainError("llm_unavailable", "Gemini returned invalid JSON");
    }

    const validated = GeminiIdentifySchema.safeParse(parsed);
    if (!validated.success) {
      throw new DomainError(
        "llm_unavailable",
        `Gemini response failed validation: ${validated.error.message}`,
      );
    }

    const gemini = validated.data;

    const intent: IdentifyResult["intent"] =
      gemini.confidence < 0.7 ? "ambiguous" : gemini.intent;

    const { student_id, guardian_id } = lookupIds(
      input.roster,
      gemini.matched_student_name,
      gemini.matched_guardian_name,
    );

    const ambiguity_candidates = gemini.ambiguity_candidates?.map((c) => {
      const { student_id: sid, guardian_id: gid } = lookupIds(
        input.roster,
        c.student_name,
        c.guardian_name,
      );
      return { student_id: sid ?? "", guardian_id: gid ?? "", label: c.label };
    });

    console.info(
      JSON.stringify({
        event: "llm.identify.response",
        request_id: requestId,
        intent,
        confidence: gemini.confidence,
      }),
    );

    return {
      intent,
      student_id,
      guardian_id,
      class_id: gemini.class_id,
      content: gemini.content,
      confidence: gemini.confidence,
      ambiguity_candidates,
    };
  }

  async rewrite(draft: string): Promise<string> {
    this.rateLimiter.consume();

    const requestId = randomUUID();
    const prompt = [
      "Você é um assistente especializado em comunicação escolar em português brasileiro.",
      "Melhore a clareza e o tom da seguinte mensagem de um professor para pais/responsáveis.",
      "Mantenha o mesmo significado, mas torne a mensagem mais clara, profissional e cordial.",
      "Retorne apenas o texto melhorado, sem explicações ou comentários adicionais.",
      "",
      "Mensagem original:",
      draft,
    ].join("\n");

    console.info(
      JSON.stringify({
        event: "llm.rewrite.request",
        request_id: requestId,
        draft_length: draft.length,
      }),
    );

    let responseText: string;
    try {
      const response = await this.client.models.generateContent({
        model: MODEL,
        contents: prompt,
      });
      responseText = response.text ?? "";
    } catch (err) {
      throw new DomainError(
        "llm_unavailable",
        `Gemini API error: ${String(err)}`,
      );
    }

    if (!responseText) {
      throw new DomainError("llm_unavailable", "Gemini returned empty response");
    }

    return responseText;
  }
}
