import Database from "better-sqlite3";
import type { DeliveryEvent } from "../../domain/types.js";

interface DeliveryEventRow {
  id: number;
  dispatched_message_id: string;
  status: string;
  observed_at: string;
}

function requireTeacherId(teacherId: string): void {
  if (!teacherId) throw new TypeError("teacherId is required");
}

function toDeliveryEvent(row: DeliveryEventRow): DeliveryEvent {
  return {
    id: row.id,
    dispatchedMessageId: row.dispatched_message_id,
    status: row.status as "delivered" | "read",
    observedAt: row.observed_at,
  };
}

export function insertDeliveryEvent(
  db: Database.Database,
  teacherId: string,
  data: {
    dispatchedMessageId: string;
    status: "delivered" | "read";
    observedAt: string;
  },
): DeliveryEvent {
  requireTeacherId(teacherId);
  const result = db
    .prepare(
      "INSERT INTO delivery_events (dispatched_message_id, status, observed_at) VALUES (?, ?, ?)",
    )
    .run(data.dispatchedMessageId, data.status, data.observedAt);
  return {
    id: result.lastInsertRowid as number,
    dispatchedMessageId: data.dispatchedMessageId,
    status: data.status,
    observedAt: data.observedAt,
  };
}

export function findDeliveryEvent(
  db: Database.Database,
  teacherId: string,
  dispatchedMessageId: string,
  status: "delivered" | "read",
): DeliveryEvent | undefined {
  requireTeacherId(teacherId);
  const row = db
    .prepare(
      `SELECT de.* FROM delivery_events de
       JOIN dispatched_messages dm ON dm.id = de.dispatched_message_id
       WHERE de.dispatched_message_id = ? AND de.status = ? AND dm.teacher_id = ?`,
    )
    .get(dispatchedMessageId, status, teacherId) as DeliveryEventRow | undefined;
  return row ? toDeliveryEvent(row) : undefined;
}

export function listDeliveryEvents(
  db: Database.Database,
  teacherId: string,
  dispatchedMessageId: string,
): DeliveryEvent[] {
  return listDeliveryEventsByMessage(db, teacherId, dispatchedMessageId);
}

export function listDeliveryEventsByMessage(
  db: Database.Database,
  teacherId: string,
  dispatchedMessageId: string,
): DeliveryEvent[] {
  requireTeacherId(teacherId);
  return (
    db
      .prepare(
        `SELECT de.* FROM delivery_events de
         JOIN dispatched_messages dm ON dm.id = de.dispatched_message_id
         WHERE de.dispatched_message_id = ? AND dm.teacher_id = ?
         ORDER BY de.observed_at`,
      )
      .all(dispatchedMessageId, teacherId) as DeliveryEventRow[]
  ).map(toDeliveryEvent);
}
