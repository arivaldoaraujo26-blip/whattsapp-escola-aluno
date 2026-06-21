import Database from "better-sqlite3";
import type { InboundMessage } from "../../domain/types.js";

interface InboundMessageRow {
  id: string;
  teacher_id: string;
  guardian_id: string | null;
  provider_message_id: string | null;
  body_text: string;
  normalized_text: string;
  received_at: string;
}

function requireTeacherId(teacherId: string): void {
  if (!teacherId) throw new TypeError("teacherId is required");
}

function toInboundMessage(row: InboundMessageRow): InboundMessage {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    guardianId: row.guardian_id,
    providerMessageId: row.provider_message_id,
    bodyText: row.body_text,
    normalizedText: row.normalized_text,
    receivedAt: row.received_at,
  };
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function insertInboundMessage(
  db: Database.Database,
  teacherId: string,
  data: {
    id: string;
    guardianId?: string | null;
    providerMessageId?: string | null;
    bodyText: string;
    receivedAt: string;
  },
): InboundMessage {
  requireTeacherId(teacherId);
  const msg: InboundMessage = {
    id: data.id,
    teacherId,
    guardianId: data.guardianId ?? null,
    providerMessageId: data.providerMessageId ?? null,
    bodyText: data.bodyText,
    normalizedText: normalizeText(data.bodyText),
    receivedAt: data.receivedAt,
  };
  db.prepare(
    `INSERT INTO inbound_messages
     (id, teacher_id, guardian_id, provider_message_id, body_text, normalized_text, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.teacherId,
    msg.guardianId,
    msg.providerMessageId,
    msg.bodyText,
    msg.normalizedText,
    msg.receivedAt,
  );
  return msg;
}

export function findInboundMessageById(
  db: Database.Database,
  teacherId: string,
  id: string,
): InboundMessage | undefined {
  requireTeacherId(teacherId);
  const row = db
    .prepare(
      "SELECT * FROM inbound_messages WHERE id = ? AND teacher_id = ?",
    )
    .get(id, teacherId) as InboundMessageRow | undefined;
  return row ? toInboundMessage(row) : undefined;
}

export function findInboundMessageByProviderId(
  db: Database.Database,
  teacherId: string,
  providerMessageId: string,
): InboundMessage | undefined {
  requireTeacherId(teacherId);
  const row = db
    .prepare(
      "SELECT * FROM inbound_messages WHERE provider_message_id = ? AND teacher_id = ?",
    )
    .get(providerMessageId, teacherId) as InboundMessageRow | undefined;
  return row ? toInboundMessage(row) : undefined;
}

export function listInboundMessagesByTeacher(
  db: Database.Database,
  teacherId: string,
  limit = 50,
): InboundMessage[] {
  requireTeacherId(teacherId);
  return (
    db
      .prepare(
        "SELECT * FROM inbound_messages WHERE teacher_id = ? ORDER BY received_at DESC LIMIT ?",
      )
      .all(teacherId, limit) as InboundMessageRow[]
  ).map(toInboundMessage);
}
