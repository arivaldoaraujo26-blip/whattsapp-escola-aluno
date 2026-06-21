import { describe, it, expect, vi, beforeEach } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { openDb } from "../db/database.js";
import { runMigrations } from "../db/migrate.js";
import { insertTeacher } from "../db/repositories/teachers.js";
import { insertStudent } from "../db/repositories/students.js";
import { insertGuardian } from "../db/repositories/guardians.js";
import { linkStudentGuardian } from "../db/repositories/student-guardians.js";
import { listDispatchedMessagesByTeacher, findDispatchedMessageById } from "../db/repositories/dispatched-messages.js";
import type { LlmClient, IdentifyResult } from "../llm/llm-client.js";
import type { EvolutionClient } from "../transport/evolution-client.js";
import { SingleDispatcher } from "./dispatcher.js";
import type Database from "better-sqlite3";
import type { Teacher, Student, Guardian } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = join(dirname(__filename), "..", "..", "migrations");

function makeDb(): Database.Database {
  const db = openDb(":memory:");
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

function makeLlmClient(result: Partial<IdentifyResult> = {}): LlmClient {
  return {
    identify: vi.fn().mockResolvedValue({
      intent: "single",
      confidence: 0.95,
      content: "A reunião foi adiada.",
      ...result,
    } as IdentifyResult),
    rewrite: vi.fn(),
  };
}

function makeEvolutionClient(providerMessageId = "prov-001"): EvolutionClient {
  return {
    sendText: vi.fn().mockResolvedValue({ providerMessageId }),
    sendInteractiveButtons: vi.fn(),
  };
}

describe("SingleDispatcher", () => {
  let db: Database.Database;
  let teacher: Teacher;
  let student: Student;
  let guardian: Guardian;

  beforeEach(() => {
    db = makeDb();
    teacher = insertTeacher(db, {
      name: "Prof. Silva",
      evolutionInstance: "teacher-abc",
      phoneE164: "+5511999990000",
    });
    student = insertStudent(db, teacher.id, { name: "João Silva", classId: "5A" });
    guardian = insertGuardian(db, teacher.id, {
      name: "Maria Silva",
      phoneE164: "+5511888887777",
      role: "mae",
    });
    linkStudentGuardian(db, teacher.id, student.id, guardian.id);
  });

  // ─── Happy path ─────────────────────────────────────────────────────────────

  it("high-confidence identify result dispatches a message and returns sent outcome", async () => {
    const llm = makeLlmClient({ student_id: student.id, guardian_id: guardian.id });
    const evolution = makeEvolutionClient("prov-sent-001");
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    const outcome = await dispatcher.dispatch(teacher.id, "Avisar a mãe do João que a reunião foi adiada");

    expect(outcome.kind).toBe("sent");
    if (outcome.kind !== "sent") throw new Error("assertion");
    expect(outcome.messageId).toMatch(/^m_[0-9a-f]{8}$/);
    expect(outcome.guardianLabel).toContain("Maria Silva");
    expect(outcome.guardianLabel).toContain("mãe");
    expect(outcome.guardianLabel).toContain("João Silva");
  });

  it("persists dispatched_messages row with status=sent after successful dispatch", async () => {
    const llm = makeLlmClient({ student_id: student.id, guardian_id: guardian.id });
    const evolution = makeEvolutionClient("prov-persist-001");
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    const outcome = await dispatcher.dispatch(teacher.id, "Avisar a mãe do João");

    expect(outcome.kind).toBe("sent");
    const rows = listDispatchedMessagesByTeacher(db, teacher.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("sent");
    expect(rows[0]!.providerMessageId).toBe("prov-persist-001");
    expect(rows[0]!.guardianId).toBe(guardian.id);
    expect(rows[0]!.studentId).toBe(student.id);
  });

  it("outbound guardian message body ends with '\\n\\nResponda 1 para confirmar.'", async () => {
    const llm = makeLlmClient({ student_id: student.id, guardian_id: guardian.id, content: "A reunião foi adiada." });
    const evolution = makeEvolutionClient();
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    await dispatcher.dispatch(teacher.id, "Avisar a mãe do João");

    const sendText = evolution.sendText as ReturnType<typeof vi.fn>;
    const guardianCalls = sendText.mock.calls.filter(
      (args) => args[1] === guardian.phoneE164,
    );
    expect(guardianCalls).toHaveLength(1);
    const body = guardianCalls[0]![2] as string;
    expect(body).toMatch(/\n\nResponda 1 para confirmar\.$/);
  });

  it("sends confirmation to teacher after successful dispatch naming guardian and student", async () => {
    const llm = makeLlmClient({ student_id: student.id, guardian_id: guardian.id });
    const evolution = makeEvolutionClient();
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    await dispatcher.dispatch(teacher.id, "Avisar a mãe do João");

    const sendText = evolution.sendText as ReturnType<typeof vi.fn>;
    const teacherCalls = sendText.mock.calls.filter(
      (args) => args[1] === teacher.phoneE164,
    );
    expect(teacherCalls).toHaveLength(1);
    const msg = teacherCalls[0]![2] as string;
    expect(msg).toContain("Maria Silva");
    expect(msg).toContain("João Silva");
    expect(msg).toMatch(/^Enviado para /);
  });

  // ─── Ambiguous / clarification ───────────────────────────────────────────────

  it("ambiguous intent returns clarification outcome without calling sendText to guardian", async () => {
    const llm = makeLlmClient({
      intent: "ambiguous",
      confidence: 0.9,
      ambiguity_candidates: [
        { student_id: student.id, guardian_id: guardian.id, label: "João Silva — mãe Maria" },
      ],
    });
    const evolution = makeEvolutionClient();
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    const outcome = await dispatcher.dispatch(teacher.id, "Avisar a mãe do João");

    expect(outcome.kind).toBe("clarification");
    const sendText = evolution.sendText as ReturnType<typeof vi.fn>;
    const guardianCalls = sendText.mock.calls.filter(
      (args) => args[1] === guardian.phoneE164,
    );
    expect(guardianCalls).toHaveLength(0);
    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);
  });

  it("low confidence (< 0.7) returns clarification outcome without dispatching", async () => {
    const llm = makeLlmClient({ intent: "single", confidence: 0.6, student_id: student.id, guardian_id: guardian.id });
    const evolution = makeEvolutionClient();
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    const outcome = await dispatcher.dispatch(teacher.id, "João algo");

    expect(outcome.kind).toBe("clarification");
    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);
  });

  // ─── Rejected — student not in roster ────────────────────────────────────────

  it("student_id from LLM not in teacher roster returns rejected outcome", async () => {
    const llm = makeLlmClient({ student_id: "non-existent-id", guardian_id: guardian.id });
    const evolution = makeEvolutionClient();
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    const outcome = await dispatcher.dispatch(teacher.id, "Avisar alguém");

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") throw new Error("assertion");
    expect(outcome.reason).toContain("Aluno");
    const sendText = evolution.sendText as ReturnType<typeof vi.fn>;
    const guardianCalls = sendText.mock.calls.filter(
      (args) => args[1] === guardian.phoneE164,
    );
    expect(guardianCalls).toHaveLength(0);
    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);
  });

  // ─── LLM error ───────────────────────────────────────────────────────────────

  it("LlmClient.identify throws DomainError(llm_unavailable) → returns rejected with Portuguese message", async () => {
    const { DomainError } = await import("./errors.js");
    const llm: LlmClient = {
      identify: vi.fn().mockRejectedValue(new DomainError("llm_unavailable", "Gemini down")),
      rewrite: vi.fn(),
    };
    const evolution = makeEvolutionClient();
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    const outcome = await dispatcher.dispatch(teacher.id, "Avisar a mãe do João");

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") throw new Error("assertion");
    expect(outcome.reason).toBe("Desculpe, não consegui entender — pode reformular?");

    // Teacher gets the error message
    const sendText = evolution.sendText as ReturnType<typeof vi.fn>;
    const teacherCalls = sendText.mock.calls.filter(
      (args) => args[1] === teacher.phoneE164,
    );
    expect(teacherCalls).toHaveLength(1);
    expect(teacherCalls[0]![2]).toBe("Desculpe, não consegui entender — pode reformular?");
    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);
  });

  // ─── Retry logic ─────────────────────────────────────────────────────────────

  it("sendText fails once (5xx) then succeeds on second attempt → returns sent", async () => {
    const { DomainError } = await import("./errors.js");
    const llm = makeLlmClient({ student_id: student.id, guardian_id: guardian.id });
    const sendText = vi
      .fn()
      .mockRejectedValueOnce(new DomainError("transport_failed", "5xx"))
      .mockResolvedValue({ providerMessageId: "prov-retry-001" });
    const evolution: EvolutionClient = { sendText, sendInteractiveButtons: vi.fn() };
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    const outcome = await dispatcher.dispatch(teacher.id, "Avisar a mãe do João");

    expect(outcome.kind).toBe("sent");
    // Guardian sendText was called twice (first fails, second succeeds)
    const guardianCalls = sendText.mock.calls.filter(
      (args) => args[1] === guardian.phoneE164,
    );
    expect(guardianCalls).toHaveLength(2);

    const rows = listDispatchedMessagesByTeacher(db, teacher.id);
    expect(rows[0]!.status).toBe("sent");
  }, 30000);

  it("sendText fails all 3 retries → dispatch row is marked failed, returns rejected", async () => {
    const { DomainError } = await import("./errors.js");
    const llm = makeLlmClient({ student_id: student.id, guardian_id: guardian.id });
    const sendText = vi
      .fn()
      .mockRejectedValue(new DomainError("transport_failed", "5xx always"));
    const evolution: EvolutionClient = { sendText, sendInteractiveButtons: vi.fn() };
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    const outcome = await dispatcher.dispatch(teacher.id, "Avisar a mãe do João");

    expect(outcome.kind).toBe("rejected");
    const rows = listDispatchedMessagesByTeacher(db, teacher.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.failedReason).toBeTruthy();
  }, 60000);

  // ─── Dispatch row never left as pending ──────────────────────────────────────

  it("dispatch row transitions: pending → sent (no permanent pending state)", async () => {
    const llm = makeLlmClient({ student_id: student.id, guardian_id: guardian.id });
    const evolution = makeEvolutionClient();
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    await dispatcher.dispatch(teacher.id, "Avisar a mãe do João");

    const rows = listDispatchedMessagesByTeacher(db, teacher.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).not.toBe("pending");
  });

  // ─── Unknown intent ──────────────────────────────────────────────────────────

  it("unknown intent returns rejected without dispatching", async () => {
    const llm = makeLlmClient({ intent: "unknown", confidence: 0.8 });
    const evolution = makeEvolutionClient();
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    const outcome = await dispatcher.dispatch(teacher.id, "algo sem sentido");

    expect(outcome.kind).toBe("rejected");
    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);
  });

  // ─── Missing guardian_id from LLM ────────────────────────────────────────────

  it("LLM returns student_id but no guardian_id → rejected with clarification message", async () => {
    const llm = makeLlmClient({ intent: "single", confidence: 0.95, student_id: student.id, guardian_id: undefined });
    const evolution = makeEvolutionClient();
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    const outcome = await dispatcher.dispatch(teacher.id, "Avisar alguém do João");

    expect(outcome.kind).toBe("rejected");
    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);
  });

  // ─── Guardian not found in DB ──────────────────────────────────────────────────

  it("LLM returns a guardian_id not in DB → rejected", async () => {
    const llm = makeLlmClient({ intent: "single", confidence: 0.95, student_id: student.id, guardian_id: "non-existent-guardian" });
    const evolution = makeEvolutionClient();
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    const outcome = await dispatcher.dispatch(teacher.id, "Avisar responsável do João");

    expect(outcome.kind).toBe("rejected");
    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);
  });

  // ─── Non-domain LLM error ──────────────────────────────────────────────────────

  it("LlmClient.identify throws non-DomainError → returns rejected with generic Portuguese message", async () => {
    const llm: LlmClient = {
      identify: vi.fn().mockRejectedValue(new Error("network timeout")),
      rewrite: vi.fn(),
    };
    const evolution = makeEvolutionClient();
    const dispatcher = new SingleDispatcher(db, llm, evolution);

    const outcome = await dispatcher.dispatch(teacher.id, "Avisar a mãe do João");

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") throw new Error("assertion");
    expect(outcome.reason).toBe("Desculpe, não consegui entender — pode reformular?");
  });
});
