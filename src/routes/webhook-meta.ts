import type { FastifyPluginAsync } from "fastify";
import type Database from "better-sqlite3";
import { timingSafeEqual } from "crypto";
import { randomUUID } from "crypto";
import { findTeacherByPhone } from "../db/repositories/teachers.js";
import { findGuardiansByPhoneGlobal } from "../db/repositories/guardians.js";
import {
  insertInboundMessage,
  findInboundMessageByProviderId,
} from "../db/repositories/inbound-messages.js";
import {
  insertDeliveryEvent,
  findDeliveryEvent,
} from "../db/repositories/delivery-events.js";
import { findDispatchedMessageByProviderIdGlobal } from "../db/repositories/dispatched-messages.js";
import { matchAcknowledgement } from "../domain/ack-matcher.js";
import type { EvolutionClient } from "../transport/evolution-client.js";
import type { Dispatcher } from "../domain/dispatcher.js";
import type { BroadcastDispatcher } from "../domain/broadcast-dispatcher.js";
import type { RevisarHandler } from "../domain/revisar-handler.js";
import { parseCommand, HELP_TEXT } from "../pipeline/command-parser.js";
import { handleStatusCommand } from "./status-handler.js";
import { listStudentsByTeacher } from "../db/repositories/students.js";
import { buildWelcomeMessage } from "../domain/welcome.js";
import { markWelcomeSent } from "../db/repositories/teachers.js";

export interface WebhookMetaPluginOptions {
  getDb: () => Database.Database;
  evolutionClient?: EvolutionClient;
  dispatcher?: Dispatcher;
  broadcastDispatcher?: BroadcastDispatcher;
  revisarHandler?: RevisarHandler;
}

function normalizePhone(phone: string): string {
  return phone.startsWith("+") ? phone : `+${phone}`;
}

export const webhookMetaPlugin: FastifyPluginAsync<WebhookMetaPluginOptions> =
  async (app, opts) => {
    app.get("/webhook/meta", async (request, reply) => {
      const query = request.query as Record<string, string>;
      const mode = query["hub.mode"];
      const token = query["hub.verify_token"];
      const challenge = query["hub.challenge"];
      const expected = process.env["META_WEBHOOK_VERIFY_TOKEN"] ?? "";

      if (mode === "subscribe" && token === expected) {
        return reply.code(200).send(challenge);
      }
      return reply.code(403).send({ error: "Forbidden" });
    });

    app.post("/webhook/meta", async (request, reply) => {
      const db = opts.getDb();
      const raw = request.body as Record<string, unknown>;

      const entries = (raw["entry"] as Array<Record<string, unknown>>) ?? [];
      for (const entry of entries) {
        const changes = (entry["changes"] as Array<Record<string, unknown>>) ?? [];
        for (const change of changes) {
          const value = change["value"] as Record<string, unknown>;
          if (!value) continue;

          const messages = (value["messages"] as Array<Record<string, unknown>>) ?? [];
          for (const msg of messages) {
            void handleIncomingMessage(db, opts, msg, request.log).catch(() => undefined);
          }

          const statuses = (value["statuses"] as Array<Record<string, unknown>>) ?? [];
          for (const status of statuses) {
            handleStatusUpdate(db, status);
          }
        }
      }

      return reply.code(200).send({ ok: true });
    });
  };

async function handleIncomingMessage(
  db: Database.Database,
  opts: WebhookMetaPluginOptions,
  msg: Record<string, unknown>,
  log: { error: (obj: unknown, msg: string) => void },
): Promise<void> {
  const from = msg["from"] as string;
  const msgId = msg["id"] as string;
  const msgType = msg["type"] as string;

  if (!from || !msgId) return;

  const senderPhone = normalizePhone(from);

  const teacher = findTeacherByPhone(db, senderPhone);
  if (teacher) {
    if (findInboundMessageByProviderId(db, teacher.id, msgId)) return;

    if (teacher.welcomeSentAt === null && opts.evolutionClient) {
      const students = listStudentsByTeacher(db, teacher.id);
      const welcomeBody = buildWelcomeMessage(students.length);
      try {
        await opts.evolutionClient.sendText("", teacher.phoneE164, welcomeBody);
        markWelcomeSent(db, teacher.id);
      } catch (err) {
        log.error({ err, teacher_id: teacher.id }, "sendWelcome failed");
      }
    }

    const interactive = msg["interactive"] as Record<string, unknown> | undefined;
    if (msgType === "interactive" && interactive?.["type"] === "button_reply") {
      const buttonReply = interactive["button_reply"] as Record<string, string>;
      const selectedButtonId = buttonReply["id"] ?? "";
      const displayText = buttonReply["title"] ?? `[button: ${selectedButtonId}]`;
      insertInboundMessage(db, teacher.id, {
        id: randomUUID(),
        providerMessageId: msgId,
        bodyText: displayText,
        receivedAt: new Date().toISOString(),
      });
      if (opts.revisarHandler) {
        void opts.revisarHandler
          .handleButtonReply(teacher, selectedButtonId)
          .catch(() => undefined);
      }
      return;
    }

    const textBody = (msg["text"] as Record<string, string> | undefined)?.["body"] ?? "";
    const inbound = insertInboundMessage(db, teacher.id, {
      id: randomUUID(),
      providerMessageId: msgId,
      bodyText: textBody,
      receivedAt: new Date().toISOString(),
    });

    const command = parseCommand(inbound.bodyText);

    if (command.kind === "ajuda" && opts.evolutionClient) {
      void opts.evolutionClient
        .sendText("", teacher.phoneE164, HELP_TEXT)
        .catch(() => undefined);
      return;
    }

    if (command.kind === "revisar" && opts.revisarHandler) {
      void opts.revisarHandler.handle(teacher, command.draft).catch(() => undefined);
      return;
    }

    if (command.kind === "status" && opts.evolutionClient) {
      void handleStatusCommand(db, teacher, opts.evolutionClient, command.target).catch(
        () => undefined,
      );
      return;
    }

    if (command.kind === "dispatch" && opts.dispatcher) {
      void opts.dispatcher.dispatch(teacher.id, command.text).catch(() => undefined);
      return;
    }

    if (command.kind === "broadcast" && opts.broadcastDispatcher) {
      void opts.broadcastDispatcher
        .broadcastDispatch(teacher.id, command.classId, command.content)
        .catch(() => undefined);
    }
    return;
  }

  const guardianResults = findGuardiansByPhoneGlobal(db, senderPhone);
  if (guardianResults.length === 0) return;

  const textBody = (msg["text"] as Record<string, string> | undefined)?.["body"] ?? "";

  for (const { guardian, teacherId } of guardianResults) {
    if (findInboundMessageByProviderId(db, teacherId, msgId)) continue;

    const inbound = insertInboundMessage(db, teacherId, {
      id: randomUUID(),
      providerMessageId: msgId,
      bodyText: textBody,
      receivedAt: new Date().toISOString(),
    });

    matchAcknowledgement(db, teacherId, guardian.id, inbound);
  }
}

function handleStatusUpdate(
  db: Database.Database,
  status: Record<string, unknown>,
): void {
  const providerMsgId = status["id"] as string;
  const rawStatus = status["status"] as string;

  if (!providerMsgId || !rawStatus) return;

  const normalized =
    rawStatus === "delivered" ? "delivered" : rawStatus === "read" ? "read" : null;
  if (!normalized) return;

  const dispatch = findDispatchedMessageByProviderIdGlobal(db, providerMsgId);
  if (!dispatch) return;

  if (findDeliveryEvent(db, dispatch.teacherId, dispatch.id, normalized)) return;

  insertDeliveryEvent(db, dispatch.teacherId, {
    dispatchedMessageId: dispatch.id,
    status: normalized,
    observedAt: new Date().toISOString(),
  });
}
