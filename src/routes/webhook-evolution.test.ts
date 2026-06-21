import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  vi,
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
import { listInboundMessagesByTeacher } from "../db/repositories/inbound-messages.js";
import { listDeliveryEventsByMessage } from "../db/repositories/delivery-events.js";
import { buildApp } from "../app.js";
import type Database from "better-sqlite3";
import type { Teacher } from "../domain/types.js";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = join(dirname(__filename), "..", "..", "migrations");

const EVOLUTION_API_KEY = "test-evolution-webhook-secret";
const VALID_AUTH = `Bearer ${EVOLUTION_API_KEY}`;

function makeUpsertPayload(
  instance: string,
  overrides?: {
    fromMe?: boolean;
    messageId?: string;
    conversation?: string;
  },
) {
  return {
    event: "messages.upsert",
    instance,
    data: {
      key: {
        id: overrides?.messageId ?? "wa-msg-id-001",
        remoteJid: "+5511999998888@s.whatsapp.net",
        fromMe: overrides?.fromMe ?? false,
      },
      message: { conversation: overrides?.conversation ?? "Olá, recebi a mensagem" },
      messageTimestamp: 1700000000,
    },
  };
}

function makeUpdatePayload(
  instance: string,
  keyId: string,
  status: "DELIVERY_ACK" | "READ" = "READ",
) {
  return {
    event: "messages.update",
    instance,
    data: { keyId, status },
  };
}

function makeConnectionPayload(
  instance: string,
  state: "open" | "close" | "connecting",
) {
  return { event: "connection.update", instance, data: { state } };
}

describe("POST /webhook/evolution", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let teacher: Teacher;

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
      name: "Prof. Silva",
      evolutionInstance: "teacher-abc123",
      phoneE164: "+5511999990000",
    });
    app = buildApp({ db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    vi.clearAllMocks();
  });

  // ─── Auth ────────────────────────────────────────────────────────────────

  it("returns 401 when Authorization header is missing", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(makeUpsertPayload("teacher-abc123")),
    });
    expect(resp.statusCode).toBe(401);
    expect(resp.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 401 when Authorization token is invalid", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: "Bearer wrong-key",
        "content-type": "application/json",
      },
      payload: JSON.stringify(makeUpsertPayload("teacher-abc123")),
    });
    expect(resp.statusCode).toBe(401);
  });

  // ─── Schema validation ────────────────────────────────────────────────────

  it("returns 400 when payload does not match any known event shape", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        event: "messages.reaction",
        instance: "teacher-abc123",
        data: {},
      }),
    });
    expect(resp.statusCode).toBe(400);
  });

  it("returns 400 when instance is unknown", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(makeUpsertPayload("teacher-unknown")),
    });
    expect(resp.statusCode).toBe(400);
    expect(resp.json()).toMatchObject({ error: "Unknown instance" });
  });

  // ─── messages.upsert ─────────────────────────────────────────────────────

  it("does NOT insert inbound_messages row when fromMe is true", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(
        makeUpsertPayload("teacher-abc123", { fromMe: true }),
      ),
    });
    expect(resp.statusCode).toBe(200);
    const rows = listInboundMessagesByTeacher(db, teacher.id);
    expect(rows).toHaveLength(0);
  });

  it("does NOT insert second inbound_messages row for duplicate provider_message_id", async () => {
    const payload = makeUpsertPayload("teacher-abc123", {
      messageId: "wa-dup-001",
    });

    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    expect(resp.statusCode).toBe(200);
    const rows = listInboundMessagesByTeacher(db, teacher.id);
    expect(rows).toHaveLength(1);
  });

  it("inserts inbound_messages row and returns 200 for valid upsert", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(
        makeUpsertPayload("teacher-abc123", {
          messageId: "wa-msg-valid-001",
          conversation: "Confirmado!",
        }),
      ),
    });

    expect(resp.statusCode).toBe(200);
    expect(resp.json()).toMatchObject({ ok: true });

    const rows = listInboundMessagesByTeacher(db, teacher.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      teacherId: teacher.id,
      providerMessageId: "wa-msg-valid-001",
      bodyText: "Confirmado!",
    });
  });

  it("invokes onInboundMessage hook with teacherId and messageId for valid upsert", async () => {
    const onInboundMessage = vi.fn();
    await app.close();
    app = buildApp({ db, onInboundMessage });
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(
        makeUpsertPayload("teacher-abc123", { messageId: "wa-hook-001" }),
      ),
    });

    expect(onInboundMessage).toHaveBeenCalledOnce();
    const [calledTeacherId, calledMsgId] = onInboundMessage.mock.calls[0]!;
    expect(calledTeacherId).toBe(teacher.id);
    expect(typeof calledMsgId).toBe("string");
    expect(calledMsgId).toBeTruthy();
  });

  it("does NOT invoke onInboundMessage hook when fromMe is true", async () => {
    const onInboundMessage = vi.fn();
    await app.close();
    app = buildApp({ db, onInboundMessage });
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(
        makeUpsertPayload("teacher-abc123", { fromMe: true }),
      ),
    });

    expect(onInboundMessage).not.toHaveBeenCalled();
  });

  // ─── messages.update ─────────────────────────────────────────────────────

  it("inserts delivery_events row for READ status linked to correct dispatched_message_id", async () => {
    const guardian = insertGuardian(db, teacher.id, {
      name: "Maria",
      phoneE164: "+5511888887777",
      role: "mae",
    });
    const dispatched = insertDispatchedMessage(db, teacher.id, {
      id: randomUUID(),
      guardianId: guardian.id,
      draftText: "Reunião adiada",
      bodyText: "Olá Maria, a reunião foi adiada.",
    });
    const provId = "wa-out-msg-001";
    updateDispatchedMessageStatus(db, teacher.id, dispatched.id, "sent", {
      providerMessageId: provId,
      sentAt: new Date().toISOString(),
    });

    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(
        makeUpdatePayload("teacher-abc123", provId, "READ"),
      ),
    });

    expect(resp.statusCode).toBe(200);
    const events = listDeliveryEventsByMessage(db, teacher.id, dispatched.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      dispatchedMessageId: dispatched.id,
      status: "read",
    });
  });

  it("inserts delivery_events row for DELIVERY_ACK as 'delivered'", async () => {
    const guardian = insertGuardian(db, teacher.id, {
      name: "Carlos",
      phoneE164: "+5511777776666",
      role: "pai",
    });
    const dispatched = insertDispatchedMessage(db, teacher.id, {
      id: randomUUID(),
      guardianId: guardian.id,
      draftText: "Aviso",
      bodyText: "Aviso importante.",
    });
    const provId = "wa-out-msg-002";
    updateDispatchedMessageStatus(db, teacher.id, dispatched.id, "sent", {
      providerMessageId: provId,
      sentAt: new Date().toISOString(),
    });

    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(
        makeUpdatePayload("teacher-abc123", provId, "DELIVERY_ACK"),
      ),
    });

    expect(resp.statusCode).toBe(200);
    const events = listDeliveryEventsByMessage(db, teacher.id, dispatched.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe("delivered");
  });

  it("inserts only one delivery_events row when same (dispatched_message_id, READ) is received twice", async () => {
    const guardian = insertGuardian(db, teacher.id, {
      name: "Ana",
      phoneE164: "+5511666665555",
      role: "mae",
    });
    const dispatched = insertDispatchedMessage(db, teacher.id, {
      id: randomUUID(),
      guardianId: guardian.id,
      draftText: "Aviso",
      bodyText: "Aviso.",
    });
    const provId = "wa-out-msg-003";
    updateDispatchedMessageStatus(db, teacher.id, dispatched.id, "sent", {
      providerMessageId: provId,
      sentAt: new Date().toISOString(),
    });

    const payload = makeUpdatePayload("teacher-abc123", provId, "READ");
    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });
    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });

    const events = listDeliveryEventsByMessage(db, teacher.id, dispatched.id);
    expect(events).toHaveLength(1);
  });

  it("returns 200 and creates no delivery_events row when provider_message_id has no matching dispatched_message", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(
        makeUpdatePayload("teacher-abc123", "wa-no-match-999", "READ"),
      ),
    });

    expect(resp.statusCode).toBe(200);
  });

  // ─── connection.update ────────────────────────────────────────────────────

  it("calls onConnectionUpdate hook with teacherId and state", async () => {
    const onConnectionUpdate = vi.fn();
    await app.close();
    app = buildApp({ db, onConnectionUpdate });
    await app.ready();

    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(
        makeConnectionPayload("teacher-abc123", "open"),
      ),
    });

    expect(resp.statusCode).toBe(200);
    expect(onConnectionUpdate).toHaveBeenCalledOnce();
    expect(onConnectionUpdate).toHaveBeenCalledWith(teacher.id, "open");
  });

  it("returns 200 for connection.update without hook configured", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(
        makeConnectionPayload("teacher-abc123", "close"),
      ),
    });
    expect(resp.statusCode).toBe(200);
  });

  // ─── Welcome message ──────────────────────────────────────────────────────

  it("calls sendText for connection.update → open when teacher has no welcome_sent_at", async () => {
    const sendText = vi.fn().mockResolvedValue({ providerMessageId: "welcome-id" });
    const mockClient = { sendText, sendInteractiveButtons: vi.fn() };
    await app.close();
    app = buildApp({ db, evolutionClient: mockClient as unknown as import("../transport/evolution-client.js").HttpEvolutionClient });
    await app.ready();

    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: VALID_AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeConnectionPayload("teacher-abc123", "open")),
    });

    expect(resp.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendText).toHaveBeenCalledOnce();
    const [, phone] = sendText.mock.calls[0] as [string, string, string];
    expect(phone).toBe(teacher.phoneE164);
  });

  it("does NOT call sendText for connection.update → open when teacher welcome_sent_at is already set", async () => {
    // Mark welcome as already sent
    db.prepare("UPDATE teachers SET welcome_sent_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      teacher.id,
    );

    const sendText = vi.fn().mockResolvedValue({ providerMessageId: "x" });
    const mockClient = { sendText, sendInteractiveButtons: vi.fn() };
    await app.close();
    app = buildApp({ db, evolutionClient: mockClient as unknown as import("../transport/evolution-client.js").HttpEvolutionClient });
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: VALID_AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeConnectionPayload("teacher-abc123", "open")),
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(sendText).not.toHaveBeenCalled();
  });

  it("does NOT call sendText for connection.update → close", async () => {
    const sendText = vi.fn();
    const mockClient = { sendText, sendInteractiveButtons: vi.fn() };
    await app.close();
    app = buildApp({ db, evolutionClient: mockClient as unknown as import("../transport/evolution-client.js").HttpEvolutionClient });
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: VALID_AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeConnectionPayload("teacher-abc123", "close")),
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(sendText).not.toHaveBeenCalled();
  });

  it("does NOT call sendText for connection.update → connecting", async () => {
    const sendText = vi.fn();
    const mockClient = { sendText, sendInteractiveButtons: vi.fn() };
    await app.close();
    app = buildApp({ db, evolutionClient: mockClient as unknown as import("../transport/evolution-client.js").HttpEvolutionClient });
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: VALID_AUTH, "content-type": "application/json" },
      payload: JSON.stringify(makeConnectionPayload("teacher-abc123", "connecting")),
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(sendText).not.toHaveBeenCalled();
  });

  // ─── /ajuda command ──────────────────────────────────────────────────────

  it("calls evolutionClient.sendText with help text when /ajuda is received", async () => {
    const sendText = vi.fn().mockResolvedValue({ providerMessageId: "reply-id" });
    const mockClient = { sendText, sendInteractiveButtons: vi.fn() };
    await app.close();
    app = buildApp({ db, evolutionClient: mockClient as unknown as import("../transport/evolution-client.js").HttpEvolutionClient });
    await app.ready();

    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: VALID_AUTH, "content-type": "application/json" },
      payload: JSON.stringify(
        makeUpsertPayload("teacher-abc123", { conversation: "/ajuda" }),
      ),
    });

    expect(resp.statusCode).toBe(200);
    // sendText fires asynchronously; wait a tick for the promise to settle
    await new Promise((r) => setTimeout(r, 0));
    expect(sendText).toHaveBeenCalledOnce();
    const [instance, phone, body] = sendText.mock.calls[0] as [string, string, string];
    expect(instance).toBe(teacher.evolutionInstance);
    expect(phone).toBe(teacher.phoneE164);
    expect(body).toMatch(/ajuda/i);
  });

  it("does NOT call evolutionClient for non-ajuda messages", async () => {
    const sendText = vi.fn().mockResolvedValue({ providerMessageId: "reply-id" });
    const mockClient = { sendText, sendInteractiveButtons: vi.fn() };
    await app.close();
    app = buildApp({ db, evolutionClient: mockClient as unknown as import("../transport/evolution-client.js").HttpEvolutionClient });
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: { authorization: VALID_AUTH, "content-type": "application/json" },
      payload: JSON.stringify(
        makeUpsertPayload("teacher-abc123", { conversation: "Olá, recebi a mensagem" }),
      ),
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(sendText).not.toHaveBeenCalled();
  });

  // ─── Integration: full webhook flow ──────────────────────────────────────

  it("[integration] messages.upsert webhook creates inbound_messages row and invokes pipeline", async () => {
    const onInboundMessage = vi.fn();
    await app.close();
    app = buildApp({ db, onInboundMessage });
    await app.ready();

    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(
        makeUpsertPayload("teacher-abc123", {
          messageId: "wa-integration-001",
          conversation: "Mensagem de teste",
        }),
      ),
    });

    expect(resp.statusCode).toBe(200);

    const rows = listInboundMessagesByTeacher(db, teacher.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.providerMessageId).toBe("wa-integration-001");
    expect(rows[0]?.bodyText).toBe("Mensagem de teste");

    expect(onInboundMessage).toHaveBeenCalledOnce();
    expect(onInboundMessage.mock.calls[0]?.[0]).toBe(teacher.id);
  });

  it("[integration] messages.update with matching provider_message_id creates delivery_events row", async () => {
    const guardian = insertGuardian(db, teacher.id, {
      name: "Luisa",
      phoneE164: "+5511555554444",
      role: "responsavel",
    });
    const dispatched = insertDispatchedMessage(db, teacher.id, {
      id: randomUUID(),
      guardianId: guardian.id,
      draftText: "Aviso integração",
      bodyText: "Aviso para integração.",
    });
    const provId = "wa-integration-out-001";
    updateDispatchedMessageStatus(db, teacher.id, dispatched.id, "sent", {
      providerMessageId: provId,
      sentAt: new Date().toISOString(),
    });

    const resp = await app.inject({
      method: "POST",
      url: "/webhook/evolution",
      headers: {
        authorization: VALID_AUTH,
        "content-type": "application/json",
      },
      payload: JSON.stringify(
        makeUpdatePayload("teacher-abc123", provId, "READ"),
      ),
    });

    expect(resp.statusCode).toBe(200);

    const events = listDeliveryEventsByMessage(db, teacher.id, dispatched.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.dispatchedMessageId).toBe(dispatched.id);
    expect(events[0]?.status).toBe("read");
  });
});
