import {
  describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi,
} from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { openDb } from "../db/database.js";
import { runMigrations } from "../db/migrate.js";
import { insertTeacher } from "../db/repositories/teachers.js";
import { buildApp } from "../app.js";
import type { EvolutionClient } from "../transport/evolution-client.js";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations",
);
const META_API_KEY = "test-evolution-key";

function makeClient(): EvolutionClient {
  return {
    sendText: vi.fn().mockResolvedValue({ providerMessageId: "wamid.sent1" }),
    sendInteractiveButtons: vi.fn().mockResolvedValue({ providerMessageId: "wamid.btn1" }),
  };
}

function makeTextPayload(from: string, text: string, msgId = "wamid.abc123") {
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: {
      messaging_product: "whatsapp",
      contacts: [{ wa_id: from, profile: { name: "Test" } }],
      messages: [{
        from,
        id: msgId,
        timestamp: "1750000000",
        type: "text",
        text: { body: text },
      }],
    }, field: "messages" }] }],
  };
}

function makeStatusPayload(msgId: string, status: "delivered" | "read", recipientId: string) {
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: {
      messaging_product: "whatsapp",
      statuses: [{
        id: msgId,
        status,
        recipient_id: recipientId,
        timestamp: "1750000100",
      }],
    }, field: "messages" }] }],
  };
}

describe("Webhook Meta", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let evolutionClient: EvolutionClient;
  let teacherId: string;

  beforeAll(() => {
    process.env["META_WEBHOOK_VERIFY_TOKEN"] = "verify-secret";
    process.env["GEMINI_API_KEY"] = "test-key";
  });

  afterAll(() => {
    delete process.env["META_WEBHOOK_VERIFY_TOKEN"];
    delete process.env["GEMINI_API_KEY"];
  });

  beforeEach(async () => {
    db = openDb(":memory:");
    runMigrations(db, MIGRATIONS_DIR);
    evolutionClient = makeClient();

    const teacher = insertTeacher(db, {
      name: "Prof. Iago",
      evolutionInstance: "meta-abc",
      phoneE164: "+5511942219711",
    });
    teacherId = teacher.id;

    app = buildApp({ db, evolutionClient });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  describe("GET /webhook/meta (verification)", () => {
    it("returns challenge when verify token matches", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/webhook/meta?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=abc456",
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("abc456");
    });

    it("returns 403 when verify token does not match", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/webhook/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc456",
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /webhook/meta", () => {
    it("returns 200 and processes teacher command /ajuda", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/webhook/meta",
        payload: makeTextPayload("5511942219711", "/ajuda"),
      });
      expect(res.statusCode).toBe(200);
      // wait for async processing
      await new Promise(r => setTimeout(r, 50));
      expect(evolutionClient.sendText).toHaveBeenCalled();
      const calls = (evolutionClient.sendText as ReturnType<typeof vi.fn>).mock.calls as [string, string, string][];
      const tos = calls.map(([, to]) => to);
      expect(tos.some((to: string) => to === "+5511942219711")).toBe(true);
    });

    it("sends welcome message on first teacher interaction", async () => {
      await app.inject({
        method: "POST",
        url: "/webhook/meta",
        payload: makeTextPayload("5511942219711", "/ajuda"),
      });
      await new Promise(r => setTimeout(r, 50));
      const calls = (evolutionClient.sendText as ReturnType<typeof vi.fn>).mock.calls as [string, string, string][];
      const bodies = calls.map(([, , body]) => body);
      expect(bodies.some((b: string) => b.includes("conectado"))).toBe(true);
    });

    it("does NOT send welcome twice", async () => {
      await app.inject({
        method: "POST",
        url: "/webhook/meta",
        payload: makeTextPayload("5511942219711", "/ajuda"),
      });
      await new Promise(r => setTimeout(r, 50));
      (evolutionClient.sendText as ReturnType<typeof vi.fn>).mockClear();

      await app.inject({
        method: "POST",
        url: "/webhook/meta",
        payload: makeTextPayload("5511942219711", "/ajuda", "wamid.abc124"),
      });
      await new Promise(r => setTimeout(r, 50));
      const bodies = ((evolutionClient.sendText as ReturnType<typeof vi.fn>).mock.calls as [string, string, string][])
        .map(([, , body]) => body);
      expect(bodies.every((b: string) => !b.includes("conectado"))).toBe(true);
    });

    it("returns 200 and skips unknown sender", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/webhook/meta",
        payload: makeTextPayload("5511000000000", "oi"),
      });
      expect(res.statusCode).toBe(200);
      await new Promise(r => setTimeout(r, 50));
      expect(evolutionClient.sendText).not.toHaveBeenCalled();
    });

    it("records delivery status update", async () => {
      const { insertDispatchedMessage, updateDispatchedMessageSent } =
        await import("../db/repositories/dispatched-messages.js");
      const { insertGuardian } = await import("../db/repositories/guardians.js");
      const { insertStudent } = await import("../db/repositories/students.js");
      const { linkStudentGuardian } = await import("../db/repositories/student-guardians.js");

      const student = insertStudent(db, teacherId, {
        name: "João Silva", externalRef: null, classId: "1A",
      });
      const guardian = insertGuardian(db, teacherId, {
        name: "Maria", phoneE164: "+5511987654321", role: "mae", externalRef: null,
      });
      linkStudentGuardian(db, teacherId, student.id, guardian.id);
      insertDispatchedMessage(db, teacherId, {
        id: "msg-abc",
        studentId: student.id,
        guardianId: guardian.id,
        draftText: "texto",
        bodyText: "texto",
        broadcastGroupId: null,
      });
      updateDispatchedMessageSent(db, teacherId, "msg-abc", "wamid.msg1");

      const res = await app.inject({
        method: "POST",
        url: "/webhook/meta",
        payload: makeStatusPayload("wamid.msg1", "read", "5511987654321"),
      });
      expect(res.statusCode).toBe(200);

      const { listDeliveryEvents } = await import("../db/repositories/delivery-events.js");
      const events = listDeliveryEvents(db, teacherId, "msg-abc");
      expect(events.some((e) => e.status === "read")).toBe(true);
    });
  });
});
