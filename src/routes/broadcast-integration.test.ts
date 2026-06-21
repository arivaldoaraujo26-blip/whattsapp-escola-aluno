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
import { DefaultBroadcastDispatcher } from "../domain/broadcast-dispatcher.js";
import type { EvolutionClient } from "../transport/evolution-client.js";
import type { RateLimiter } from "../domain/rate-limiter.js";
import type Database from "better-sqlite3";
import type { Teacher } from "../domain/types.js";

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = join(dirname(__filename), "..", "..", "migrations");

const EVOLUTION_API_KEY = "test-broadcast-secret";
const AUTH = `Bearer ${EVOLUTION_API_KEY}`;

const noopRateLimiter: RateLimiter = { wait: () => Promise.resolve() };

function makeBroadcastPayload(instance: string, text: string, messageId = "wa-bc-001") {
  return {
    event: "messages.upsert",
    instance,
    data: {
      key: { id: messageId, remoteJid: "+5511999998888@s.whatsapp.net", fromMe: false },
      message: { conversation: text },
      messageTimestamp: 1700000000,
    },
  };
}

describe("Broadcast integration — webhook → broadcast pipeline", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let teacher: Teacher;
  let mockSendText: ReturnType<typeof vi.fn>;
  let mockEvolution: EvolutionClient;

  beforeAll(() => {
    process.env["EVOLUTION_API_KEY"] = EVOLUTION_API_KEY;
    process.env["ADMIN_TOKEN"] = "test-admin-token-bc";
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
      name: "Prof. Broadcast",
      evolutionInstance: "teacher-bc-001",
      phoneE164: "+5511900001111",
    });

    // 3 students in class 5A with guardians
    for (let i = 1; i <= 3; i++) {
      const student = insertStudent(db, teacher.id, { name: `Aluno ${i}`, classId: "5A" });
      const guardian = insertGuardian(db, teacher.id, {
        name: `Resp ${i}`,
        phoneE164: `+551190000200${i}`,
        role: "mae",
      });
      linkStudentGuardian(db, teacher.id, student.id, guardian.id);
    }

    mockSendText = vi.fn().mockResolvedValue({ providerMessageId: "prov-bc-int-001" });
    mockEvolution = { sendText: mockSendText, sendInteractiveButtons: vi.fn() };

    const broadcastDispatcher = new DefaultBroadcastDispatcher(
      db,
      mockEvolution,
      () => noopRateLimiter,
    );

    app = buildApp({
      db,
      evolutionClient: mockEvolution as unknown as import("../transport/evolution-client.js").HttpEvolutionClient,
      broadcastDispatcher,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    vi.clearAllMocks();
  });

  // ─── E2E: broadcast pattern fan-out ──────────────────────────────────────

  it("[e2e] teacher webhook with broadcast pattern → all guardians in class receive exactly one dispatch row", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeBroadcastPayload("teacher-bc-001", "Para o 5A: Reunião amanhã")),
    });

    expect(resp.statusCode).toBe(200);

    // Wait for the async broadcast pipeline to settle
    await new Promise((r) => setTimeout(r, 100));

    const rows = listDispatchedMessagesByTeacher(db, teacher.id);
    expect(rows).toHaveLength(3);

    // All rows share the same broadcast_group_id
    const groupIds = new Set(rows.map((r) => r.broadcastGroupId));
    expect(groupIds.size).toBe(1);
    expect([...groupIds][0]).toMatch(/^bg_[0-9a-f]{8}$/);

    // All rows are sent
    for (const row of rows) {
      expect(row.status).toBe("sent");
    }

    // Each guardian received exactly one message
    const guardianCalls = mockSendText.mock.calls.filter(
      (args) => args[1] !== teacher.phoneE164,
    );
    expect(guardianCalls).toHaveLength(3);
    const recipients = new Set(guardianCalls.map((args) => args[1] as string));
    expect(recipients.size).toBe(3);
  });

  // ─── E2E: broadcast message bodies end with ADR-006 suffix ───────────────

  it("[e2e] every broadcast outbound message body ends with the ADR-006 confirmation suffix", async () => {
    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeBroadcastPayload("teacher-bc-001", "Para o 5A: Aviso importante", "wa-bc-002")),
    });

    await new Promise((r) => setTimeout(r, 100));

    const guardianCalls = mockSendText.mock.calls.filter(
      (args) => args[1] !== teacher.phoneE164,
    );
    for (const call of guardianCalls) {
      expect(call[2]).toMatch(/\n\nResponda 1 para confirmar\.$/);
    }
  });

  // ─── E2E: teacher receives summary after broadcast ────────────────────────

  it("[e2e] teacher receives a summary confirmation message after broadcast", async () => {
    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeBroadcastPayload("teacher-bc-001", "Para o 5A: Prova sexta", "wa-bc-003")),
    });

    await new Promise((r) => setTimeout(r, 100));

    const teacherCalls = mockSendText.mock.calls.filter(
      (args) => args[1] === teacher.phoneE164,
    );
    expect(teacherCalls).toHaveLength(1);
    const msg = teacherCalls[0]![2] as string;
    expect(msg).toContain("3 responsáveis");
    expect(msg).toContain("5A");
    expect(msg).toMatch(/#bg_[0-9a-f]{8}/);
  });

  // ─── E2E: two teachers with same class_id get independent fan-outs ────────

  it("[e2e] two teachers with same class_id receive independent, non-overlapping broadcast fan-outs", async () => {
    // Set up teacher2 with their own 2 students in "5A"
    const teacher2 = insertTeacher(db, {
      name: "Prof. Segundo",
      evolutionInstance: "teacher-bc-002",
      phoneE164: "+5511900009999",
    });
    for (let i = 1; i <= 2; i++) {
      const student = insertStudent(db, teacher2.id, { name: `T2 Aluno ${i}`, classId: "5A" });
      const guardian = insertGuardian(db, teacher2.id, {
        name: `T2 Resp ${i}`,
        phoneE164: `+551190000300${i}`,
        role: "pai",
      });
      linkStudentGuardian(db, teacher2.id, student.id, guardian.id);
    }

    const broadcastDispatcher2 = new DefaultBroadcastDispatcher(
      db,
      mockEvolution,
      () => noopRateLimiter,
    );
    const app2 = buildApp({
      db,
      evolutionClient: mockEvolution as unknown as import("../transport/evolution-client.js").HttpEvolutionClient,
      broadcastDispatcher: broadcastDispatcher2,
    });
    await app2.ready();

    try {
      await app.inject({
        method: "POST",
        url: "/webhook/evolution",
        headers: { authorization: AUTH, "content-type": "application/json" },
        payload: JSON.stringify(makeBroadcastPayload("teacher-bc-001", "Para o 5A: Aviso T1", "wa-bc-t1")),
      });
      await app2.inject({
        method: "POST",
        url: "/webhook/evolution",
        headers: { authorization: AUTH, "content-type": "application/json" },
        payload: JSON.stringify(makeBroadcastPayload("teacher-bc-002", "Para o 5A: Aviso T2", "wa-bc-t2")),
      });

      await new Promise((r) => setTimeout(r, 100));

      const rowsT1 = listDispatchedMessagesByTeacher(db, teacher.id);
      const rowsT2 = listDispatchedMessagesByTeacher(db, teacher2.id);

      // Teacher 1 has 3 rows, teacher 2 has 2 rows
      expect(rowsT1).toHaveLength(3);
      expect(rowsT2).toHaveLength(2);

      // Group IDs are different between teachers
      const groupT1 = [...new Set(rowsT1.map((r) => r.broadcastGroupId))];
      const groupT2 = [...new Set(rowsT2.map((r) => r.broadcastGroupId))];
      expect(groupT1).toHaveLength(1);
      expect(groupT2).toHaveLength(1);
      expect(groupT1[0]).not.toBe(groupT2[0]);
    } finally {
      await app2.close();
    }
  });

  // ─── E2E: broadcast to unknown class returns no rows ─────────────────────

  it("[e2e] broadcast to a class not in the roster creates no dispatch rows", async () => {
    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeBroadcastPayload("teacher-bc-001", "Para o 9Z: Aviso", "wa-bc-unk")),
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);
  });
});
