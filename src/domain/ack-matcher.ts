import type Database from "better-sqlite3";
import type { Acknowledgement } from "./types.js";
import { getRecentDispatchForGuardian } from "../db/repositories/dispatched-messages.js";
import {
  findAcknowledgement,
  insertAcknowledgement,
} from "../db/repositories/acknowledgements.js";

export function matchAcknowledgement(
  db: Database.Database,
  teacherId: string,
  guardianId: string,
  inboundMessage: { id: string; bodyText: string },
): Acknowledgement | null {
  if (inboundMessage.bodyText.trim() !== "1") return null;

  return db.transaction((): Acknowledgement | null => {
    const dispatch = getRecentDispatchForGuardian(db, teacherId, guardianId, 24);
    if (!dispatch) return null;

    const existing = findAcknowledgement(db, teacherId, dispatch.id);
    if (existing) return existing;

    return insertAcknowledgement(db, teacherId, {
      dispatchedMessageId: dispatch.id,
      inboundMessageId: inboundMessage.id,
      acknowledgedAt: new Date().toISOString(),
    });
  })();
}
