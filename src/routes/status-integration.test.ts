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
import { insertGuardian } from "../db/repositories/guardians.js";
import {
  insertDispatchedMessage,
  updateDispatchedMessageStatus,
} from "../db/repositories/dispatched-messages.js";
import { insertDeliveryEvent } from "../db/repositories/delivery-events.js";
import { insertAcknowledgement } from "../db/repositories/acknowledgements.js";
import { buildApp } from "../app.js";
import type { EvolutionClient } from "../transport/evolution-client.js";
import type Database from "better-sqlite3";
import type { Teacher, Guardian } from "../domain/types.js";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = join(dirname(__filename), "..", "..", "migrations");

const EVOLUTION_API_KEY = "test-status-secret";
const AUTH = `Bearer ${EVOLUTION_API_KEY}`;

function makeUpsertPayload(instance: string, conversation: string, messageId = "wa-status-001") {
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

function seedDispatch(
  db: Database.Database,
  teacherId: string,
  guardianId: string,
  opts?: { broadcastGroupId?: string },
) {
  const id = `m_${randomUUID().slice(0, 8)}`;
  const msg = insertDispatchedMessage(db, teacherId, {
    id,
    guardianId,
    draftText: "Reunião adiada",
    bodyText: "Reunião adiada.\n\nResponda 1 para confirmar.",
    broadcastGroupId: opts?.broadcastGroupId ?? null,
  });
  updateDispatchedMessageStatus(db, teacherId, msg.id, "sent", {
    providerMessageId: `prov-${id}`,
    sentAt: new Date().toISOString(),
  });
  return msg;
}

describe("/status integration", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let teacher: Teacher;
  let guardian: Guardian;
  let mockSendText: ReturnType<typeof vi.fn>;
  let mockEvolution: EvolutionClient;

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
      name: "Prof. Status",
      evolutionInstance: "teacher-status-001",
      phoneE164: "+5511900000001",
    });
    guardian = insertGuardian(db, teacher.id, {
      name: "Maria Silva",
      phoneE164: "+5511900000002",
      role: "mae",
    });

    mockSendText = vi.fn().mockResolvedValue({ providerMessageId: "prov-status-001" });
    mockEvolution = { sendText: mockSendText, sendInteractiveButtons: vi.fn() };

    app = buildApp({
      db,
      evolutionClient: mockEvolution as unknown as import("../transport/evolution-client.js").HttpEvolutionClient,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    vi.clearAllMocks();
  });

  it("[e2e] /status último with no dispatches → friendly 'nenhuma mensagem' reply", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeUpsertPayload("teacher-status-001", "/status")),
    });
    expect(resp.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    const teacherCalls = mockSendText.mock.calls.filter((args) => args[1] === teacher.phoneE164);
    expect(teacherCalls).toHaveLength(1);
    expect(teacherCalls[0]![2]).toContain("Nenhuma mensagem encontrada");
  });

  it("[e2e] /status último after a dispatch where guardian read and replied '1' → ✅ line", async () => {
    const dispatch = seedDispatch(db, teacher.id, guardian.id);
    insertDeliveryEvent(db, teacher.id, {
      dispatchedMessageId: dispatch.id,
      status: "read",
      observedAt: new Date().toISOString(),
    });
    insertAcknowledgement(db, teacher.id, {
      dispatchedMessageId: dispatch.id,
      inboundMessageId: randomUUID(),
      acknowledgedAt: new Date().toISOString(),
    });

    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeUpsertPayload("teacher-status-001", "/status último")),
    });
    expect(resp.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    const teacherCalls = mockSendText.mock.calls.filter((args) => args[1] === teacher.phoneE164);
    expect(teacherCalls).toHaveLength(1);
    const reply = teacherCalls[0]![2] as string;
    expect(reply).toContain("✅");
    expect(reply).toContain("Maria Silva");
    expect(reply).toContain("lida e confirmada");
  });

  it("[e2e] /status último after broadcast fan-out shows one line per guardian with correct symbols", async () => {
    const g2 = insertGuardian(db, teacher.id, {
      name: "Carlos Costa",
      phoneE164: "+5511900000003",
      role: "pai",
    });
    const bgId = randomUUID();
    const d1 = seedDispatch(db, teacher.id, guardian.id, { broadcastGroupId: bgId });
    const d2 = seedDispatch(db, teacher.id, g2.id, { broadcastGroupId: bgId });

    // Maria read it
    insertDeliveryEvent(db, teacher.id, {
      dispatchedMessageId: d1.id,
      status: "read",
      observedAt: new Date().toISOString(),
    });
    // Carlos only got delivery ACK
    insertDeliveryEvent(db, teacher.id, {
      dispatchedMessageId: d2.id,
      status: "delivered",
      observedAt: new Date().toISOString(),
    });

    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeUpsertPayload("teacher-status-001", "/status último", "wa-status-002")),
    });
    expect(resp.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    const teacherCalls = mockSendText.mock.calls.filter((args) => args[1] === teacher.phoneE164);
    expect(teacherCalls).toHaveLength(1);
    const reply = teacherCalls[0]![2] as string;

    expect(reply).toContain("👀");
    expect(reply).toContain("Maria Silva");
    expect(reply).toContain("⏳");
    expect(reply).toContain("Carlos Costa");
  });

  it("[e2e] /status <id> for an unknown ID → 'não encontrado' reply", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeUpsertPayload("teacher-status-001", "/status m_deadbeef", "wa-status-003")),
    });
    expect(resp.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    const teacherCalls = mockSendText.mock.calls.filter((args) => args[1] === teacher.phoneE164);
    expect(teacherCalls).toHaveLength(1);
    expect(teacherCalls[0]![2]).toContain("não encontrada");
  });
});
