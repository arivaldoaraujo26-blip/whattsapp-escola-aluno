import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IdentifyRequest } from "./llm-client.js";
import { DomainError } from "../domain/errors.js";
import { TokenBucketRateLimiter } from "./rate-limiter.js";

// ── Mock @google/genai ──────────────────────────────────────────────────────
// vi.hoisted ensures the mock fn is initialized before vi.mock factory runs.

const mockGenerateContent = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => ({
    models: { generateContent: mockGenerateContent },
  })),
  Type: {
    OBJECT: "OBJECT",
    STRING: "STRING",
    NUMBER: "NUMBER",
    ARRAY: "ARRAY",
    BOOLEAN: "BOOLEAN",
  },
}));

// Import after mock registration (vi.mock is hoisted so this is safe)
import { GeminiLlmClient } from "./gemini-llm-client.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_ROSTER: IdentifyRequest["roster"] = [
  {
    student_id: "sid-joao",
    student_name: "João Silva",
    guardians: [
      { guardian_id: "gid-maria", name: "Maria Silva", role: "mae" },
      { guardian_id: "gid-carlos", name: "Carlos Silva", role: "pai" },
    ],
  },
  {
    student_id: "sid-ana",
    student_name: "Ana Costa",
    guardians: [
      { guardian_id: "gid-fernanda", name: "Fernanda Costa", role: "mae" },
    ],
  },
];

// Phones that must never appear in any outbound LLM payload
const SAMPLE_PHONES = ["+5511999998888", "+5511988887777", "+5511977776666"];

// ── Helpers ─────────────────────────────────────────────────────────────────

function freshLimiter(): TokenBucketRateLimiter {
  return new TokenBucketRateLimiter(10);
}

function exhaustedLimiter(): TokenBucketRateLimiter {
  const limiter = new TokenBucketRateLimiter(1);
  limiter.consume();
  return limiter;
}

function geminiResponse(overrides: Record<string, unknown> = {}): {
  text: string;
} {
  return {
    text: JSON.stringify({
      intent: "single",
      matched_student_name: "João Silva",
      matched_guardian_name: "Maria Silva",
      content: "a reunião foi adiada",
      confidence: 0.95,
      ...overrides,
    }),
  };
}

/**
 * Mandatory safety assertion — call at the end of every identify test.
 * Checks that no phone number from SAMPLE_PHONES appears in the outbound
 * payload sent to the Gemini API.
 */
function assertNoPhones(): void {
  const calls = mockGenerateContent.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const payload = JSON.stringify(calls[calls.length - 1]);
  for (const phone of SAMPLE_PHONES) {
    expect(payload).not.toContain(phone);
  }
  expect(payload).not.toMatch(/\+55\d{10,11}/);
}

// ── identify tests ───────────────────────────────────────────────────────────

describe("GeminiLlmClient.identify", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it("returns a validated IdentifyResult when Gemini response matches schema", async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse());

    const client = new GeminiLlmClient("test-key", freshLimiter());
    const result = await client.identify({
      text: "Avisar a mãe do João que a reunião foi adiada",
      roster: SAMPLE_ROSTER,
    });

    expect(result.intent).toBe("single");
    expect(result.student_id).toBe("sid-joao");
    expect(result.guardian_id).toBe("gid-maria");
    expect(result.confidence).toBe(0.95);
    expect(result.content).toBe("a reunião foi adiada");

    assertNoPhones();
  });

  it("throws DomainError('llm_unavailable') when Gemini response fails schema validation", async () => {
    // Response is missing required 'intent' and 'confidence' — Zod rejects it
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ student_id: "sid-joao", guardian_id: "gid-maria" }),
    });

    const client = new GeminiLlmClient("test-key", freshLimiter());
    await expect(
      client.identify({ text: "test", roster: SAMPLE_ROSTER }),
    ).rejects.toMatchObject({ code: "llm_unavailable" });

    assertNoPhones();
  });

  it("prompt payload does NOT contain any phone number from the roster", async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse());

    // Simulate roster where phone fields exist at runtime (e.g. passed by accident)
    const rosterWithRuntimePhones = SAMPLE_ROSTER.map((s, i) =>
      Object.assign({}, s, { phone_e164: SAMPLE_PHONES[i] ?? "+5511000000000" }),
    );

    const client = new GeminiLlmClient("test-key", freshLimiter());
    await client.identify({
      text: "Avisar a mãe do João",
      roster: rosterWithRuntimePhones as IdentifyRequest["roster"],
    });

    assertNoPhones();
  });

  it("prompt payload contains student_name/guardian_name/role but NOT student_id or guardian_id", async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse());

    const client = new GeminiLlmClient("test-key", freshLimiter());
    await client.identify({
      text: "Avisar a mãe do João que a reunião foi adiada",
      roster: SAMPLE_ROSTER,
    });

    const call = mockGenerateContent.mock.calls[0]!;
    const payload = JSON.stringify(call);

    // Names and role ARE present in the rendered prompt
    expect(payload).toContain("João Silva");
    expect(payload).toContain("Maria Silva");
    expect(payload).toContain("mae");

    // IDs must NOT be forwarded into the prompt content
    expect(payload).not.toContain("sid-joao");
    expect(payload).not.toContain("sid-ana");
    expect(payload).not.toContain("gid-maria");
    expect(payload).not.toContain("gid-fernanda");

    assertNoPhones();
  });

  it("overrides intent to 'ambiguous' when confidence < 0.7", async () => {
    mockGenerateContent.mockResolvedValueOnce(
      geminiResponse({ intent: "single", confidence: 0.5 }),
    );

    const client = new GeminiLlmClient("test-key", freshLimiter());
    const result = await client.identify({
      text: "Avisar alguém",
      roster: SAMPLE_ROSTER,
    });

    expect(result.intent).toBe("ambiguous");
    expect(result.confidence).toBe(0.5);

    assertNoPhones();
  });

  it("throws DomainError('llm_unavailable') when rate limit is exceeded", async () => {
    const client = new GeminiLlmClient("test-key", exhaustedLimiter());

    await expect(
      client.identify({ text: "test", roster: SAMPLE_ROSTER }),
    ).rejects.toMatchObject({ code: "llm_unavailable" });

    // No Gemini call should be attempted when rate-limited
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});

  it("throws DomainError('llm_unavailable') when Gemini returns empty text", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "" });

    const client = new GeminiLlmClient("test-key", freshLimiter());
    await expect(
      client.identify({ text: "test", roster: SAMPLE_ROSTER }),
    ).rejects.toMatchObject({ code: "llm_unavailable" });

    assertNoPhones();
  });

  it("throws DomainError('llm_unavailable') when Gemini returns non-JSON text", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "não é JSON" });

    const client = new GeminiLlmClient("test-key", freshLimiter());
    await expect(
      client.identify({ text: "test", roster: SAMPLE_ROSTER }),
    ).rejects.toMatchObject({ code: "llm_unavailable" });

    assertNoPhones();
  });

  it("maps ambiguity_candidates to student_id/guardian_id via name lookup", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        intent: "ambiguous",
        confidence: 0.8,
        ambiguity_candidates: [
          { student_name: "João Silva", guardian_name: "Maria Silva", label: "João Silva — mãe Maria" },
          { student_name: "Ana Costa", guardian_name: "Fernanda Costa", label: "Ana Costa — mãe Fernanda" },
        ],
      }),
    });

    const client = new GeminiLlmClient("test-key", freshLimiter());
    const result = await client.identify({ text: "avisar", roster: SAMPLE_ROSTER });

    expect(result.intent).toBe("ambiguous");
    expect(result.ambiguity_candidates).toHaveLength(2);
    expect(result.ambiguity_candidates?.[0]?.student_id).toBe("sid-joao");
    expect(result.ambiguity_candidates?.[0]?.guardian_id).toBe("gid-maria");
    expect(result.ambiguity_candidates?.[1]?.student_id).toBe("sid-ana");

    assertNoPhones();
  });

  it("returns undefined student_id/guardian_id when Gemini names don't match roster", async () => {
    mockGenerateContent.mockResolvedValueOnce(
      geminiResponse({ matched_student_name: "Aluno Inexistente", matched_guardian_name: "Responsável Inexistente" }),
    );

    const client = new GeminiLlmClient("test-key", freshLimiter());
    const result = await client.identify({ text: "test", roster: SAMPLE_ROSTER });

    expect(result.student_id).toBeUndefined();
    expect(result.guardian_id).toBeUndefined();

    assertNoPhones();
  });

// ── rewrite tests ────────────────────────────────────────────────────────────

describe("GeminiLlmClient.rewrite", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it("sends only the draft text and returns the improved string", async () => {
    const improved =
      "Prezada Maria Silva,\nInformamos que a reunião foi remarcada.";
    mockGenerateContent.mockResolvedValueOnce({ text: improved });

    const client = new GeminiLlmClient("test-key", freshLimiter());
    const result = await client.rewrite("A reuniao foi adiada");

    expect(result).toBe(improved);

    const call = mockGenerateContent.mock.calls[0]!;
    const payload = JSON.stringify(call);
    // Roster, student IDs, guardian IDs must NOT appear in the rewrite payload
    expect(payload).not.toMatch(/student_id|guardian_id|roster|sid-|gid-/);
    expect(payload).not.toMatch(/\+55\d{10,11}/);
  });

  it("throws DomainError('llm_unavailable') on Gemini 5xx / network error", async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new Error("503 Service Unavailable"),
    );

    const client = new GeminiLlmClient("test-key", freshLimiter());
    await expect(client.rewrite("test draft")).rejects.toMatchObject({
      code: "llm_unavailable",
    });
  });

  it("throws DomainError('llm_unavailable') when Gemini returns empty text", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "" });

    const client = new GeminiLlmClient("test-key", freshLimiter());
    await expect(client.rewrite("test draft")).rejects.toMatchObject({
      code: "llm_unavailable",
    });
  });
});

// ── TokenBucketRateLimiter unit tests ────────────────────────────────────────

describe("TokenBucketRateLimiter", () => {
  it("allows calls up to capacity and rejects beyond with DomainError('llm_unavailable')", () => {
    const limiter = new TokenBucketRateLimiter(3);

    // First three calls succeed
    expect(() => limiter.consume()).not.toThrow();
    expect(() => limiter.consume()).not.toThrow();
    expect(() => limiter.consume()).not.toThrow();

    // Fourth call exceeds capacity
    let caught: unknown;
    try {
      limiter.consume();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe("llm_unavailable");
  });
});
