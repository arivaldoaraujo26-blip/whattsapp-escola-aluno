import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { LlmClient } from "../llm/llm-client.js";
import type { EvolutionClient } from "../transport/evolution-client.js";
import { DomainError } from "./errors.js";
import { findTeacherById } from "../db/repositories/teachers.js";
import { listStudentsByTeacher, findStudentById } from "../db/repositories/students.js";
import { findGuardianById } from "../db/repositories/guardians.js";
import { listGuardiansForStudent } from "../db/repositories/student-guardians.js";
import {
  insertDispatchedMessage,
  updateDispatchedMessageStatus,
  findDispatchedMessageById,
} from "../db/repositories/dispatched-messages.js";

export interface Dispatcher {
  dispatch(teacherId: string, text: string): Promise<DispatchOutcome>;
}

export type DispatchOutcome =
  | { kind: "sent"; messageId: string; guardianLabel: string }
  | { kind: "clarification"; candidates: Array<{ id: string; label: string }>; draft: string }
  | { kind: "broadcast"; messageIds: string[]; classId: string; recipients: number }
  | { kind: "rejected"; reason: string };

const RETRY_DELAYS_MS = [1000, 3000, 9000];

const DOMAIN_ERROR_MESSAGES: Record<string, string> = {
  llm_unavailable: "Desculpe, não consegui entender — pode reformular?",
  transport_failed: "Falha ao enviar a mensagem. Tente novamente.",
  roster_not_found: "Aluno não encontrado na lista de alunos.",
  teacher_not_found: "Professor não encontrado.",
};

function domainErrorToPortuguese(code: string): string {
  return DOMAIN_ERROR_MESSAGES[code] ?? "Ocorreu um erro. Tente novamente.";
}

async function withRetry<T>(
  fn: () => Promise<T>,
  delays = RETRY_DELAYS_MS,
): Promise<T> {
  let lastError: unknown;
  const maxAttempts = delays.length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isTransport = err instanceof DomainError && err.code === "transport_failed";
      if (!isTransport || attempt >= delays.length) throw err;
      await new Promise<void>((r) => setTimeout(r, delays[attempt]!));
    }
  }
  throw lastError;
}

function buildGuardianLabel(guardianName: string, role: string, studentName: string): string {
  let roleDisplay: string;
  let article: string;
  if (role === "mae") {
    roleDisplay = "mãe";
    article = "da";
  } else if (role === "pai") {
    roleDisplay = "pai";
    article = "do";
  } else {
    roleDisplay = "responsável";
    article = "do";
  }
  return `${guardianName} (${roleDisplay} ${article} ${studentName})`;
}

export class SingleDispatcher implements Dispatcher {
  constructor(
    private readonly db: Database.Database,
    private readonly llmClient: LlmClient,
    private readonly evolutionClient: EvolutionClient,
  ) {}

  async dispatch(teacherId: string, text: string): Promise<DispatchOutcome> {
    const teacher = findTeacherById(this.db, teacherId);
    if (!teacher) {
      return { kind: "rejected", reason: domainErrorToPortuguese("teacher_not_found") };
    }

    // Build roster for LLM (name-only, no PII beyond names per ADR-005)
    const students = listStudentsByTeacher(this.db, teacherId);
    const roster = students.map((s) => {
      const guardians = listGuardiansForStudent(this.db, teacherId, s.id);
      return {
        student_id: s.id,
        student_name: s.name,
        guardians: guardians.map((g) => ({
          guardian_id: g.id,
          name: g.name,
          role: g.role,
        })),
      };
    });

    let identified;
    try {
      identified = await this.llmClient.identify({ text, roster });
    } catch (err) {
      const reason = err instanceof DomainError
        ? domainErrorToPortuguese(err.code)
        : domainErrorToPortuguese("llm_unavailable");
      void this.sendTeacherReply(teacher, reason);
      return { kind: "rejected", reason };
    }

    // Ambiguous or low-confidence → clarification
    if (identified.intent === "ambiguous" || identified.confidence < 0.7) {
      const candidates = identified.ambiguity_candidates ?? [];
      let msg: string;
      if (candidates.length > 0) {
        const list = candidates.map((c, i) => `${i + 1}. ${c.label}`).join("\n");
        msg = `Encontrei mais de um aluno. Pode especificar?\n${list}`;
      } else {
        msg = "Não consegui identificar o aluno com certeza. Pode reformular?";
      }
      void this.sendTeacherReply(teacher, msg);
      return {
        kind: "clarification",
        candidates: candidates.map((c) => ({ id: c.student_id, label: c.label })),
        draft: text,
      };
    }

    // Unknown intent or missing student
    if (identified.intent === "unknown" || !identified.student_id) {
      const reason = "Não consegui identificar o aluno. Pode reformular?";
      void this.sendTeacherReply(teacher, reason);
      return { kind: "rejected", reason };
    }

    // Validate student_id is in this teacher's roster
    const student = findStudentById(this.db, teacherId, identified.student_id);
    if (!student) {
      const reason = domainErrorToPortuguese("roster_not_found");
      void this.sendTeacherReply(teacher, reason);
      return { kind: "rejected", reason };
    }

    if (!identified.guardian_id) {
      const reason = "Não consegui identificar o responsável. Pode especificar?";
      void this.sendTeacherReply(teacher, reason);
      return { kind: "rejected", reason };
    }

    const guardian = findGuardianById(this.db, teacherId, identified.guardian_id);
    if (!guardian) {
      const reason = "Responsável não encontrado.";
      void this.sendTeacherReply(teacher, reason);
      return { kind: "rejected", reason };
    }

    // Compose body: LLM content + ADR-006 suffix (appended AFTER LLM call)
    const content = identified.content ?? text;
    const bodyText = `${content}\n\nResponda 1 para confirmar.`;

    // Idempotency: generate a stable message ID and check for existing sent row
    const messageId = `m_${randomUUID().replace(/-/g, "").slice(0, 8)}`;

    // Insert pending row before sending (ensures no orphaned sends)
    insertDispatchedMessage(this.db, teacherId, {
      id: messageId,
      studentId: student.id,
      guardianId: guardian.id,
      draftText: text,
      bodyText,
    });

    // Send to guardian with exponential-backoff retry
    let providerMessageId: string;
    try {
      const result = await withRetry(() =>
        this.evolutionClient.sendText(teacher.evolutionInstance, guardian.phoneE164, bodyText),
      );
      providerMessageId = result.providerMessageId;
    } catch (err) {
      const failedReason = err instanceof DomainError ? err.message : String(err);
      updateDispatchedMessageStatus(this.db, teacherId, messageId, "failed", { failedReason });
      const reason = domainErrorToPortuguese("transport_failed");
      void this.sendTeacherReply(teacher, reason);
      return { kind: "rejected", reason };
    }

    // Update row to sent
    updateDispatchedMessageStatus(this.db, teacherId, messageId, "sent", {
      providerMessageId,
      sentAt: new Date().toISOString(),
    });

    const guardianLabel = buildGuardianLabel(guardian.name, guardian.role, student.name);
    const confirmation = `Enviado para ${guardianLabel} — #${messageId}`;
    void this.sendTeacherReply(teacher, confirmation);

    return { kind: "sent", messageId, guardianLabel };
  }

  private async sendTeacherReply(
    teacher: { evolutionInstance: string; phoneE164: string },
    message: string,
  ): Promise<void> {
    try {
      await this.evolutionClient.sendText(teacher.evolutionInstance, teacher.phoneE164, message);
    } catch {
      // Best-effort — teacher reply failures must not propagate
    }
  }
}
