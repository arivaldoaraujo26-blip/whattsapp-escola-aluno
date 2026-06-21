import Database from "better-sqlite3";
import type { Acknowledgement } from "../../domain/types.js";

interface AcknowledgementRow {
  dispatched_message_id: string;
  inbound_message_id: string;
  acknowledged_at: string;
}

function requireTeacherId(teacherId: string): void {
  if (!teacherId) throw new TypeError("teacherId is required");
}

function toAcknowledgement(row: AcknowledgementRow): Acknowledgement {
  return {
    dispatchedMessageId: row.dispatched_message_id,
    inboundMessageId: row.inbound_message_id,
    acknowledgedAt: row.acknowledged_at,
  };
}

export function insertAcknowledgement(
  db: Database.Database,
  teacherId: string,
  data: {
    dispatchedMessageId: string;
    inboundMessageId: string;
    acknowledgedAt: string;
  },
): Acknowledgement {
  requireTeacherId(teacherId);
  db.prepare(
    "INSERT OR IGNORE INTO acknowledgements (dispatched_message_id, inbound_message_id, acknowledged_at) VALUES (?, ?, ?)",
  ).run(data.dispatchedMessageId, data.inboundMessageId, data.acknowledgedAt);
  return {
    dispatchedMessageId: data.dispatchedMessageId,
    inboundMessageId: data.inboundMessageId,
    acknowledgedAt: data.acknowledgedAt,
  };
}

export function findAcknowledgement(
  db: Database.Database,
  teacherId: string,
  dispatchedMessageId: string,
): Acknowledgement | undefined {
  requireTeacherId(teacherId);
  const row = db
    .prepare(
      `SELECT a.* FROM acknowledgements a
       JOIN dispatched_messages dm ON dm.id = a.dispatched_message_id
       WHERE a.dispatched_message_id = ? AND dm.teacher_id = ?`,
    )
    .get(dispatchedMessageId, teacherId) as AcknowledgementRow | undefined;
  return row ? toAcknowledgement(row) : undefined;
}
