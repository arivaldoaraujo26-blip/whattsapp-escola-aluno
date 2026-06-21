import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { FastifyInstance } from "fastify";
import { openDb } from "../db/database.js";
import { runMigrations } from "../db/migrate.js";
import { insertTeacher } from "../db/repositories/teachers.js";
import { insertStudent } from "../db/repositories/students.js";
import { insertGuardian } from "../db/repositories/guardians.js";
import { linkStudentGuardian } from "../db/repositories/student-guardians.js";
import { listDispatchedMessagesByTeacher } from "../db/repositories/dispatched-messages.js";
import { buildApp } from "../app.js";
import { SingleDispatcher } from "../domain/dispatcher.js";
import type { LlmClient, IdentifyResult } from "../llm/llm-client.js";
import type { EvolutionClient } from "../transport/evolution-client.js";
import type Database from "better-sqlite3";
import type { Teacher, Student, Guardian } from "../domain/types.js";

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = join(dirname(__filename), "..", "..", "migrations");

const EVOLUTION_API_KEY = "test-webhook-disp-secret";
const AUTH = `Bearer ${EVOLUTION_API_KEY}`;

function makeUpsertPayload(instance: string, conversation: string, messageId = "wa-msg-001") {
  return {
    event: "messages.upsert",
    instance,
    data: {
      key: { id: messageId, remoteJid: "+5511999998888@s.whatsapp.net", fromMe: false },
      message: { conversation },
      messageTimestamp: 1700000000,
    },
  };
}

describe("Dispatcher integration — webhook → dispatch pipeline", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let teacher: Teacher;
  let student: Student;
  let guardian: Guardian;
  let mockSendText: ReturnType<typeof vi.fn>;
  let mockEvolution: EvolutionClient;
  let mockLlm: LlmClient;

  beforeAll(() => {
    process.env["EVOLUTION_API_KEY"] = EVOLUTION_API_KEY;
    process.env["ADMIN_TOKEN"] = "test-admin-token";
    process.env["EVOLUTION_API_URL"] = "http://evolution-mock:8080";
    process.env["WEBHOOK_URL"] = "http://backend/webhook/evolution";
  });

  afterAll(() => {
    delete process.env["EVOLUTION_API_KEY"];
    delete process.env["ADMIN_TOKEN"];
    delete process.env["EVOLUTION_API_URL"];
    delete process.env["WEBHOOK_URL"];
  });

  beforeEach(async () => {
    db = openDb(":memory:");
    runMigrations(db, MIGRATIONS_DIR);

    teacher = insertTeacher(db, {
      name: "Prof. Fernanda",
      evolutionInstance: "teacher-disp-001",
      phoneE164: "+5511900000001",
    });
    student = insertStudent(db, teacher.id, { name: "Ana Costa", classId: "4B" });
    guardian = insertGuardian(db, teacher.id, {
      name: "Carlos Costa",
      phoneE164: "+5511900000002",
      role: "pai",
    });
    linkStudentGuardian(db, teacher.id, student.id, guardian.id);

    mockSendText = vi.fn().mockResolvedValue({ providerMessageId: "prov-int-001" });
    mockEvolution = { sendText: mockSendText, sendInteractiveButtons: vi.fn() };

    mockLlm = {
      identify: vi.fn().mockResolvedValue({
        intent: "single",
        confidence: 0.92,
        student_id: student.id,
        guardian_id: guardian.id,
        content: "A reunião foi adiada para sexta.",
      } as IdentifyResult),
      rewrite: vi.fn(),
    };

    const dispatcher = new SingleDispatcher(db, mockLlm, mockEvolution);
    app = buildApp({ db, evolutionClient: mockEvolution as unknown as import("../transport/evolution-client.js").HttpEvolutionClient, dispatcher });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    vi.clearAllMocks();
  });

  // ─── End-to-end happy path ────────────────────────────────────────────────

  it("[e2e] teacher dispatch webhook → identify → dispatched_messages row with status=sent", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeUpsertPayload("teacher-disp-001", "Avisar o pai da Ana que a reunião foi adiada")),
    });

    expect(resp.statusCode).toBe(200);

    // Let the async dispatch pipeline settle
    await new Promise((r) => setTimeout(r, 50));

    const rows = listDispatchedMessagesByTeacher(db, teacher.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("sent");
    expect(rows[0]!.guardianId).toBe(guardian.id);
    expect(rows[0]!.studentId).toBe(student.id);
    expect(rows[0]!.bodyText).toMatch(/\n\nResponda 1 para confirmar\.$/);
  });

  it("[e2e] sends confirmation to teacher with guardian name and message ID", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeUpsertPayload("teacher-disp-001", "Avisar o pai da Ana")),
    });

    expect(resp.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    const teacherCalls = mockSendText.mock.calls.filter(
      (args) => args[1] === teacher.phoneE164,
    );
    expect(teacherCalls).toHaveLength(1);
    const msg = teacherCalls[0]![2] as string;
    expect(msg).toContain("Carlos Costa");
    expect(msg).toContain("Ana Costa");
    expect(msg).toMatch(/^Enviado para /);
    expect(msg).toMatch(/#m_[0-9a-f]{8}/);
  });

  // ─── Ambiguous identify → clarification, no dispatch row ─────────────────

  it("[e2e] ambiguous identify result → clarification to teacher, no dispatched_messages row", async () => {
    (mockLlm.identify as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "ambiguous",
      confidence: 0.88,
      ambiguity_candidates: [
        { student_id: student.id, guardian_id: guardian.id, label: "Ana Costa — pai Carlos" },
      ],
    } as IdentifyResult);

    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeUpsertPayload("teacher-disp-001", "Avisar sobre a reunião", "wa-amb-001")),
    });

    expect(resp.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);

    const teacherCalls = mockSendText.mock.calls.filter(
      (args) => args[1] === teacher.phoneE164,
    );
    expect(teacherCalls).toHaveLength(1);
    const msg = teacherCalls[0]![2] as string;
    expect(msg).toContain("Ana Costa — pai Carlos");
  });

  // ─── Idempotency — same webhook twice ────────────────────────────────────

  it("[e2e] idempotent: same teacher webhook twice → exactly one dispatched_messages row", async () => {
    const payload = makeUpsertPayload("teacher-disp-001", "Avisar o pai da Ana", "wa-idem-001");

    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });

    await new Promise((r) => setTimeout(r, 50));

    const rows = listDispatchedMessagesByTeacher(db, teacher.id);
    expect(rows).toHaveLength(1);
  });

  // ─── Non-dispatch messages don't trigger dispatcher ───────────────────────

  it("[e2e] /ajuda command does not create dispatched_messages row", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeUpsertPayload("teacher-disp-001", "/ajuda", "wa-ajuda-001")),
    });

    expect(resp.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);
    expect(mockLlm.identify).not.toHaveBeenCalled();
  });
});
