import Database from "better-sqlite3";
import type { DispatchedMessage } from "../../domain/types.js";

interface DispatchedMessageRow {
  id: string;
  teacher_id: string;
  broadcast_group_id: string | null;
  student_id: string | null;
  guardian_id: string;
  draft_text: string;
  body_text: string;
  status: string;
  provider_message_id: string | null;
  created_at: string;
  sent_at: string | null;
  failed_reason: string | null;
}

function toDispatchedMessage(row: DispatchedMessageRow): DispatchedMessage {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    broadcastGroupId: row.broadcast_group_id,
    studentId: row.student_id,
    guardianId: row.guardian_id,
    draftText: row.draft_text,
    bodyText: row.body_text,
    status: row.status as "pending" | "sent" | "failed",
    providerMessageId: row.provider_message_id,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    failedReason: row.failed_reason,
  };
}

function requireTeacherId(teacherId: string): void {
  if (!teacherId) throw new TypeError("teacherId is required");
}

export function insertDispatchedMessage(
  db: Database.Database,
  teacherId: string,
  data: {
    id: string;
    broadcastGroupId?: string | null;
    studentId?: string | null;
    guardianId: string;
    draftText: string;
    bodyText: string;
  },
): DispatchedMessage {
  requireTeacherId(teacherId);
  const now = new Date().toISOString();
  const msg: DispatchedMessage = {
    id: data.id,
    teacherId,
    broadcastGroupId: data.broadcastGroupId ?? null,
    studentId: data.studentId ?? null,
    guardianId: data.guardianId,
    draftText: data.draftText,
    bodyText: data.bodyText,
    status: "pending",
    providerMessageId: null,
    createdAt: now,
    sentAt: null,
    failedReason: null,
  };
  db.prepare(
    `INSERT INTO dispatched_messages
     (id, teacher_id, broadcast_group_id, student_id, guardian_id, draft_text, body_text, status, provider_message_id, created_at, sent_at, failed_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.teacherId,
    msg.broadcastGroupId,
    msg.studentId,
    msg.guardianId,
    msg.draftText,
    msg.bodyText,
    msg.status,
    msg.providerMessageId,
    msg.createdAt,
    msg.sentAt,
    msg.failedReason,
  );
  return msg;
}

export function updateDispatchedMessageStatus(
  db: Database.Database,
  teacherId: string,
  id: string,
  status: "sent" | "failed",
  extra?: {
    providerMessageId?: string;
    sentAt?: string;
    failedReason?: string;
  },
): void {
  requireTeacherId(teacherId);
  db.prepare(
    `UPDATE dispatched_messages
     SET status = ?, provider_message_id = COALESCE(?, provider_message_id),
         sent_at = COALESCE(?, sent_at), failed_reason = COALESCE(?, failed_reason)
     WHERE id = ? AND teacher_id = ?`,
  ).run(
    status,
    extra?.providerMessageId ?? null,
    extra?.sentAt ?? null,
    extra?.failedReason ?? null,
    id,
    teacherId,
  );
}

export function findDispatchedMessageById(
  db: Database.Database,
  teacherId: string,
  id: string,
): DispatchedMessage | undefined {
  requireTeacherId(teacherId);
  const row = db
    .prepare(
      "SELECT * FROM dispatched_messages WHERE id = ? AND teacher_id = ?",
    )
    .get(id, teacherId) as DispatchedMessageRow | undefined;
  return row ? toDispatchedMessage(row) : undefined;
}

export function findDispatchedMessageByProviderId(
  db: Database.Database,
  teacherId: string,
  providerMessageId: string,
): DispatchedMessage | undefined {
  requireTeacherId(teacherId);
  const row = db
    .prepare(
      "SELECT * FROM dispatched_messages WHERE provider_message_id = ? AND teacher_id = ?",
    )
    .get(providerMessageId, teacherId) as DispatchedMessageRow | undefined;
  return row ? toDispatchedMessage(row) : undefined;
}

export function listDispatchedMessagesByTeacher(
  db: Database.Database,
  teacherId: string,
  limit = 50,
): DispatchedMessage[] {
  requireTeacherId(teacherId);
  return (
    db
      .prepare(
        "SELECT * FROM dispatched_messages WHERE teacher_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(teacherId, limit) as DispatchedMessageRow[]
  ).map(toDispatchedMessage);
}

export function getLatestDispatchByTeacher(
  db: Database.Database,
  teacherId: string,
): DispatchedMessage | undefined {
  requireTeacherId(teacherId);
  const row = db
    .prepare(
      "SELECT * FROM dispatched_messages WHERE teacher_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(teacherId) as DispatchedMessageRow | undefined;
  return row ? toDispatchedMessage(row) : undefined;
}

export function listDispatchedMessagesByBroadcastGroup(
  db: Database.Database,
  teacherId: string,
  broadcastGroupId: string,
): DispatchedMessage[] {
  requireTeacherId(teacherId);
  return (
    db
      .prepare(
        "SELECT * FROM dispatched_messages WHERE teacher_id = ? AND broadcast_group_id = ? ORDER BY created_at ASC",
      )
      .all(teacherId, broadcastGroupId) as DispatchedMessageRow[]
  ).map(toDispatchedMessage);
}

export function updateDispatchedMessageSent(
  db: Database.Database,
  teacherId: string,
  id: string,
  providerMessageId: string,
): void {
  requireTeacherId(teacherId);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE dispatched_messages
     SET status = 'sent', provider_message_id = ?, sent_at = ?
     WHERE id = ? AND teacher_id = ?`,
  ).run(providerMessageId, now, id, teacherId);
}

export function findDispatchedMessageByProviderIdGlobal(
  db: Database.Database,
  providerMessageId: string,
): DispatchedMessage | undefined {
  const row = db
    .prepare(
      "SELECT * FROM dispatched_messages WHERE provider_message_id = ? LIMIT 1",
    )
    .get(providerMessageId) as DispatchedMessageRow | undefined;
  return row ? toDispatchedMessage(row) : undefined;
}

export function getRecentDispatchForGuardian(
  db: Database.Database,
  teacherId: string,
  guardianId: string,
  withinHours: number,
): DispatchedMessage | undefined {
  requireTeacherId(teacherId);
  const cutoff = new Date(Date.now() - withinHours * 3600 * 1000).toISOString();
  const row = db
    .prepare(
      `SELECT * FROM dispatched_messages
       WHERE teacher_id = ? AND guardian_id = ? AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(teacherId, guardianId, cutoff) as DispatchedMessageRow | undefined;
  return row ? toDispatchedMessage(row) : undefined;
}
