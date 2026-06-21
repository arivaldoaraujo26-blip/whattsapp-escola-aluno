import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
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
import { BUTTON_ORIGINAL_ID, BUTTON_REVISADO_ID } from "../domain/revisar-handler.js";

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = join(dirname(__filename), "..", "..", "migrations");

const EVOLUTION_API_KEY = "test-revisar-secret";
const AUTH = `Bearer ${EVOLUTION_API_KEY}`;

function makeUpsertPayload(
  instance: string,
  conversation: string,
  messageId = "wa-revisar-001",
) {
  return {
    event: "messages.upsert",
    instance,
    data: {
      key: { id: messageId, remoteJid: "+5511900000099@s.whatsapp.net", fromMe: false },
      message: { conversation },
      messageTimestamp: 1700000000,
    },
  };
}

function makeButtonReplyPayload(
  instance: string,
  selectedButtonId: string,
  selectedDisplayText: string,
  messageId = "wa-revisar-btn-001",
) {
  return {
    event: "messages.upsert",
    instance,
    data: {
      key: { id: messageId, remoteJid: "+5511900000099@s.whatsapp.net", fromMe: false },
      message: {
        buttonsResponseMessage: {
          selectedButtonId,
          selectedDisplayText,
        },
      },
      messageTimestamp: 1700000001,
    },
  };
}

describe("/revisar integration — full round-trip", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let teacher: Teacher;
  let student: Student;
  let guardian: Guardian;
  let mockSendText: ReturnType<typeof vi.fn>;
  let mockSendButtons: ReturnType<typeof vi.fn>;
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
      name: "Prof. Carla",
      evolutionInstance: "teacher-revisar-001",
      phoneE164: "+5511900000010",
    });
    student = insertStudent(db, teacher.id, { name: "Lucas Ferreira", classId: "3B" });
    guardian = insertGuardian(db, teacher.id, {
      name: "Ana Ferreira",
      phoneE164: "+5511900000011",
      role: "mae",
    });
    linkStudentGuardian(db, teacher.id, student.id, guardian.id);

    mockSendText = vi.fn().mockResolvedValue({ providerMessageId: "prov-rev-001" });
    mockSendButtons = vi.fn().mockResolvedValue({ providerMessageId: "prov-rev-btn-001" });
    mockEvolution = { sendText: mockSendText, sendInteractiveButtons: mockSendButtons };

    mockLlm = {
      identify: vi.fn().mockResolvedValue({
        intent: "single",
        confidence: 0.93,
        student_id: student.id,
        guardian_id: guardian.id,
        content: "A reunião foi remarcada.",
      } as IdentifyResult),
      rewrite: vi.fn().mockResolvedValue("Prezada família, a reunião foi remarcada para sexta-feira."),
    };

    const dispatcher = new SingleDispatcher(db, mockLlm, mockEvolution);
    app = buildApp({
      db,
      evolutionClient: mockEvolution as unknown as import("../transport/evolution-client.js").HttpEvolutionClient,
      dispatcher,
      llmClient: mockLlm,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    vi.clearAllMocks();
  });

  // ─── Full /revisar → buttons → Enviar revisado → guardian receives ────────

  it("[e2e] teacher sends /revisar → buttons sent → teacher selects Enviar revisado → guardian receives rewritten message", async () => {
    // Step 1: teacher sends /revisar command
    const resp1 = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(
        makeUpsertPayload("teacher-revisar-001", "/revisar Reunião adiada para sexta"),
      ),
    });
    expect(resp1.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    // LLM rewrite was called with only the draft text
    expect(mockLlm.rewrite).toHaveBeenCalledOnce();
    expect(mockLlm.rewrite).toHaveBeenCalledWith("Reunião adiada para sexta");
    expect(mockLlm.identify).not.toHaveBeenCalled();

    // Buttons were sent to teacher
    expect(mockSendButtons).toHaveBeenCalledOnce();
    const [, toE164, , buttons] = mockSendButtons.mock.calls[0]!;
    expect(toE164).toBe(teacher.phoneE164);
    expect((buttons as Array<{ id: string; label: string }>)).toHaveLength(2);
    expect((buttons as Array<{ id: string; label: string }>)[0]!.label).toBe("Enviar original");
    expect((buttons as Array<{ id: string; label: string }>)[1]!.label).toBe("Enviar revisado");

    // No dispatch yet
    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);

    // Step 2: teacher selects "Enviar revisado"
    const resp2 = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(
        makeButtonReplyPayload(
          "teacher-revisar-001",
          BUTTON_REVISADO_ID,
          "Enviar revisado",
        ),
      ),
    });
    expect(resp2.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    // Dispatcher was called with the rewritten text
    expect(mockLlm.identify).toHaveBeenCalledOnce();
    expect((mockLlm.identify as ReturnType<typeof vi.fn>).mock.calls[0]![0].text).toBe(
      "Prezada família, a reunião foi remarcada para sexta-feira.",
    );

    // Guardian received the message
    const rows = listDispatchedMessagesByTeacher(db, teacher.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("sent");
    expect(rows[0]!.guardianId).toBe(guardian.id);
  });

  // ─── Full /revisar → buttons → Enviar original ────────────────────────────

  it("[e2e] teacher selects Enviar original → dispatcher receives the original draft text unmodified", async () => {
    const resp1 = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(
        makeUpsertPayload(
          "teacher-revisar-001",
          "/revisar Mensagem original do professor",
          "wa-rev-orig-001",
        ),
      ),
    });
    expect(resp1.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    const resp2 = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(
        makeButtonReplyPayload(
          "teacher-revisar-001",
          BUTTON_ORIGINAL_ID,
          "Enviar original",
          "wa-rev-orig-btn-001",
        ),
      ),
    });
    expect(resp2.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    // Dispatcher called with original draft (not rewritten)
    expect((mockLlm.identify as ReturnType<typeof vi.fn>).mock.calls[0]![0].text).toBe(
      "Mensagem original do professor",
    );

    const rows = listDispatchedMessagesByTeacher(db, teacher.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.draftText).toBe("Mensagem original do professor");
  });

  // ─── LLM error → fallback message, no dispatch ───────────────────────────

  it("[e2e] LLM rewrite error → teacher receives fallback message, no dispatch created", async () => {
    const { DomainError } = await import("../domain/errors.js");
    (mockLlm.rewrite as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DomainError("llm_unavailable", "Gemini down"),
    );

    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(
        makeUpsertPayload(
          "teacher-revisar-001",
          "/revisar Texto que vai falhar",
          "wa-rev-fail-001",
        ),
      ),
    });
    expect(resp.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    // Fallback message sent to teacher
    const teacherCalls = mockSendText.mock.calls.filter(
      (args) => args[1] === teacher.phoneE164,
    );
    expect(teacherCalls).toHaveLength(1);
    expect(teacherCalls[0]![2]).toContain(
      "/revisar está temporariamente indisponível",
    );

    // No buttons sent
    expect(mockSendButtons).not.toHaveBeenCalled();

    // No dispatch row created
    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);
  });

  // ─── /revisar command does not auto-dispatch (no button press yet) ────────

  it("[e2e] /revisar command alone does not dispatch to guardian", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(
        makeUpsertPayload(
          "teacher-revisar-001",
          "/revisar Reunião cancelada",
          "wa-rev-nodispatch-001",
        ),
      ),
    });
    expect(resp.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);
    expect(mockLlm.identify).not.toHaveBeenCalled();
  });
});
