import type { FastifyPluginAsync } from "fastify";
import type Database from "better-sqlite3";
import { timingSafeEqual } from "crypto";
import { randomUUID } from "crypto";
import { findTeacherByInstance } from "../db/repositories/teachers.js";
import {
  insertInboundMessage,
  findInboundMessageByProviderId,
} from "../db/repositories/inbound-messages.js";
import {
  insertDeliveryEvent,
  findDeliveryEvent,
} from "../db/repositories/delivery-events.js";
import { findDispatchedMessageByProviderId } from "../db/repositories/dispatched-messages.js";
import { findGuardianByPhone } from "../db/repositories/guardians.js";
import { matchAcknowledgement } from "../domain/ack-matcher.js";
import type { EvolutionClient } from "../transport/evolution-client.js";
import type { Dispatcher } from "../domain/dispatcher.js";
import type { BroadcastDispatcher } from "../domain/broadcast-dispatcher.js";
import type { RevisarHandler } from "../domain/revisar-handler.js";
import type { Teacher } from "../domain/types.js";
import { parseCommand, HELP_TEXT } from "../pipeline/command-parser.js";
import { sendWelcomeIfNeeded } from "../domain/welcome.js";
import { handleStatusCommand } from "./status-handler.js";

export interface WebhookEvolutionPluginOptions {
  getDb: () => Database.Database;
  evolutionClient?: EvolutionClient;
  dispatcher?: Dispatcher;
  broadcastDispatcher?: BroadcastDispatcher;
  revisarHandler?: RevisarHandler;
  onInboundMessage?: (teacherId: string, messageId: string) => void | Promise<void>;
  onConnectionUpdate?: (
    teacherId: string,
    state: "open" | "close" | "connecting",
  ) => void | Promise<void>;
}

type UpsertPayload = {
  event: "messages.upsert";
  instance: string;
  data: {
    key: { id: string; remoteJid: string; fromMe: boolean };
    message: {
      conversation?: string;
      buttonsResponseMessage?: {
        selectedButtonId?: string;
        selectedDisplayText?: string;
      };
    };
    messageTimestamp: number;
  };
};

type UpdatePayload = {
  event: "messages.update";
  instance: string;
  data: { keyId: string; status: "DELIVERY_ACK" | "READ" };
};

type ConnectionPayload = {
  event: "connection.update";
  instance: string;
  data: { state: "open" | "close" | "connecting" };
};

type EvolutionWebhook = UpsertPayload | UpdatePayload | ConnectionPayload;

const bodySchema = {
  anyOf: [
    {
      type: "object",
      required: ["event", "instance", "data"],
      properties: {
        event: { type: "string", const: "messages.upsert" },
        instance: { type: "string" },
        data: {
          type: "object",
          required: ["key", "message", "messageTimestamp"],
          properties: {
            key: {
              type: "object",
              required: ["id", "remoteJid", "fromMe"],
              properties: {
                id: { type: "string" },
                remoteJid: { type: "string" },
                fromMe: { type: "boolean" },
              },
              additionalProperties: true,
            },
            message: {
              type: "object",
              properties: { conversation: { type: "string" } },
              additionalProperties: true,
            },
            messageTimestamp: { type: "number" },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    {
      type: "object",
      required: ["event", "instance", "data"],
      properties: {
        event: { type: "string", const: "messages.update" },
        instance: { type: "string" },
        data: {
          type: "object",
          required: ["keyId", "status"],
          properties: {
            keyId: { type: "string" },
            status: { type: "string", enum: ["DELIVERY_ACK", "READ"] },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    {
      type: "object",
      required: ["event", "instance", "data"],
      properties: {
        event: { type: "string", const: "connection.update" },
        instance: { type: "string" },
        data: {
          type: "object",
          required: ["state"],
          properties: {
            state: { type: "string", enum: ["open", "close", "connecting"] },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
  ],
};

function checkWebhookToken(provided: string): boolean {
  const expected = process.env["EVOLUTION_API_KEY"] ?? "";
  if (!expected || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function handleUpsert(
  db: Database.Database,
  teacher: Teacher,
  payload: UpsertPayload,
  opts: WebhookEvolutionPluginOptions,
): void {
  const { key, message } = payload.data;

  if (key.fromMe) return;

  const existing = findInboundMessageByProviderId(db, teacher.id, key.id);
  if (existing) return;

  // Button reply — route to revisar handler before normal command parsing
  const selectedButtonId = message.buttonsResponseMessage?.selectedButtonId;
  if (selectedButtonId !== undefined && opts.revisarHandler) {
    const bodyText =
      message.buttonsResponseMessage?.selectedDisplayText ?? `[button: ${selectedButtonId}]`;
    insertInboundMessage(db, teacher.id, {
      id: randomUUID(),
      providerMessageId: key.id,
      bodyText,
      receivedAt: new Date().toISOString(),
    });
    void opts.revisarHandler.handleButtonReply(teacher, selectedButtonId).catch(() => undefined);
    return;
  }

  const msg = insertInboundMessage(db, teacher.id, {
    id: randomUUID(),
    providerMessageId: key.id,
    bodyText: message.conversation ?? "",
    receivedAt: new Date().toISOString(),
  });

  const senderPhone = key.remoteJid.split("@")[0] ?? "";
  const guardian = senderPhone ? findGuardianByPhone(db, teacher.id, senderPhone) : undefined;
  if (guardian) {
    matchAcknowledgement(db, teacher.id, guardian.id, msg);
  }

  const command = parseCommand(msg.bodyText);

  if (command.kind === "ajuda" && opts.evolutionClient) {
    void opts.evolutionClient
      .sendText(teacher.evolutionInstance, teacher.phoneE164, HELP_TEXT)
      .catch(() => undefined);
  }

  if (command.kind === "revisar" && opts.revisarHandler) {
    void opts.revisarHandler.handle(teacher, command.draft).catch(() => undefined);
  }

  if (command.kind === "status" && opts.evolutionClient) {
    void handleStatusCommand(db, teacher, opts.evolutionClient, command.target).catch(() => undefined);
  }

  if (command.kind === "dispatch" && opts.dispatcher) {
    void opts.dispatcher.dispatch(teacher.id, command.text).catch(() => undefined);
  }

  if (command.kind === "broadcast" && opts.broadcastDispatcher) {
    void opts.broadcastDispatcher
      .broadcastDispatch(teacher.id, command.classId, command.content)
      .catch(() => undefined);
  }

  void opts.onInboundMessage?.(teacher.id, msg.id);
}

function handleUpdate(
  db: Database.Database,
  teacherId: string,
  payload: UpdatePayload,
): void {
  const { keyId, status } = payload.data;
  const normalizedStatus: "delivered" | "read" =
    status === "DELIVERY_ACK" ? "delivered" : "read";

  const dispatched = findDispatchedMessageByProviderId(db, teacherId, keyId);
  if (!dispatched) return;

  const existing = findDeliveryEvent(
    db,
    teacherId,
    dispatched.id,
    normalizedStatus,
  );
  if (existing) return;

  insertDeliveryEvent(db, teacherId, {
    dispatchedMessageId: dispatched.id,
    status: normalizedStatus,
    observedAt: new Date().toISOString(),
  });
}

export const webhookEvolutionPlugin: FastifyPluginAsync<
  WebhookEvolutionPluginOptions
> = async (app, opts) => {
  const connectionStates = new Map<
    string,
    "open" | "close" | "connecting"
  >();

  app.post(
    "/webhook/evolution",
    async (request, reply) => {
      const authHeader =
        (request.headers["authorization"] as string | undefined) ?? "";
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : "";

      if (!checkWebhookToken(token)) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const raw = request.body as Record<string, unknown>;
      const event = raw?.["event"];
      if (event !== "messages.upsert" && event !== "messages.update" && event !== "connection.update") {
        return reply.code(200).send({ ok: true, skipped: true });
      }

      const body = raw as unknown as EvolutionWebhook;
      const db = opts.getDb();

      const teacher = findTeacherByInstance(db, body.instance);
      if (!teacher) {
        return reply.code(400).send({ error: "Unknown instance" });
      }

      request.log.info(
        {
          teacher_id: teacher.id,
          event_type: body.event,
          request_id: request.id,
        },
        "Webhook received",
      );

      if (body.event === "messages.upsert") {
        handleUpsert(db, teacher, body, opts);
      } else if (body.event === "messages.update") {
        handleUpdate(db, teacher.id, body);
      } else if (body.event === "connection.update") {
        const state = body.data.state;
        connectionStates.set(teacher.id, state);
        if (state === "open" && opts.evolutionClient) {
          void sendWelcomeIfNeeded(db, teacher, opts.evolutionClient).catch((err) => {
            request.log.error({ err, teacher_id: teacher.id }, "sendWelcomeIfNeeded failed");
          });
        }
        void opts.onConnectionUpdate?.(teacher.id, state);
      }

      return reply.code(200).send({ ok: true });
    },
  );
};
