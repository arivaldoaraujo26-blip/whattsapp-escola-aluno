import type Database from "better-sqlite3";
import {
  findDispatchedMessageById,
  getLatestDispatchByTeacher,
  listDispatchedMessagesByBroadcastGroup,
} from "../db/repositories/dispatched-messages.js";
import { findDeliveryEvent } from "../db/repositories/delivery-events.js";
import { findAcknowledgement } from "../db/repositories/acknowledgements.js";
import { findGuardianById } from "../db/repositories/guardians.js";
import type { DispatchedMessage } from "./types.js";

export interface GuardianStatusLine {
  guardianName: string;
  hasRead: boolean;
  hasAcknowledged: boolean;
}

export interface StatusQueryResult {
  lines: GuardianStatusLine[];
}

function resolveDispatches(
  db: Database.Database,
  teacherId: string,
  target: string,
): DispatchedMessage[] | null {
  if (target === "latest") {
    const latest = getLatestDispatchByTeacher(db, teacherId);
    if (!latest) return null;
    if (latest.broadcastGroupId) {
      return listDispatchedMessagesByBroadcastGroup(db, teacherId, latest.broadcastGroupId);
    }
    return [latest];
  }

  const dispatch = findDispatchedMessageById(db, teacherId, target);
  if (!dispatch) return null;
  if (dispatch.broadcastGroupId) {
    return listDispatchedMessagesByBroadcastGroup(db, teacherId, dispatch.broadcastGroupId);
  }
  return [dispatch];
}

export function queryStatus(
  db: Database.Database,
  teacherId: string,
  target: string,
): StatusQueryResult | null {
  const dispatches = resolveDispatches(db, teacherId, target);
  if (!dispatches) return null;

  const lines: GuardianStatusLine[] = dispatches.map((d) => {
    const guardian = findGuardianById(db, teacherId, d.guardianId);
    const guardianName = guardian?.name ?? d.guardianId;
    const readEvent = findDeliveryEvent(db, teacherId, d.id, "read");
    const ack = findAcknowledgement(db, teacherId, d.id);
    return {
      guardianName,
      hasRead: readEvent !== undefined,
      hasAcknowledged: ack !== undefined,
    };
  });

  return { lines };
}
