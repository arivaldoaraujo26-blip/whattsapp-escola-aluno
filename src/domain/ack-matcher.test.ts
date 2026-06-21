import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { openDb } from "../db/database.js";
import { runMigrations } from "../db/migrate.js";
import { insertTeacher } from "../db/repositories/teachers.js";
import { insertGuardian } from "../db/repositories/guardians.js";
import { insertDispatchedMessage } from "../db/repositories/dispatched-messages.js";
import { findAcknowledgement } from "../db/repositories/acknowledgements.js";
import { matchAcknowledgement } from "./ack-matcher.js";
import type Database from "better-sqlite3";
import type { Teacher, Guardian } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = join(dirname(__filename), "..", "..", "migrations");

describe("matchAcknowledgement", () => {
  let db: Database.Database;
  let teacher: Teacher;
  let guardian: Guardian;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db, MIGRATIONS_DIR);
    teacher = insertTeacher(db, {
      name: "Prof. Silva",
      evolutionInstance: "teacher-abc",
      phoneE164: "+5511999990000",
    });
    guardian = insertGuardian(db, teacher.id, {
      name: "Maria",
      phoneE164: "+5511888887777",
      role: "mae",
    });
  });

  afterEach(() => {
    db.close();
  });

  function insertDispatchAtOffset(offsetMs: number): string {
    const msg = insertDispatchedMessage(db, teacher.id, {
      id: randomUUID(),
      guardianId: guardian.id,
      draftText: "Reunião",
      bodyText: "Reunião adiada.\n\nResponda 1 para confirmar.",
    });
    const createdAt = new Date(Date.now() + offsetMs).toISOString();
    db.prepare("UPDATE dispatched_messages SET created_at = ? WHERE id = ?").run(createdAt, msg.id);
    return msg.id;
  }

  // ─── bodyText matching ────────────────────────────────────────────────────

  it('matches and inserts acknowledgement for "1" (exact)', () => {
    const dispatchId = insertDispatchAtOffset(0);
    const inbound = { id: randomUUID(), bodyText: "1" };
    const result = matchAcknowledgement(db, teacher.id, guardian.id, inbound);
    expect(result).not.toBeNull();
    expect(result?.dispatchedMessageId).toBe(dispatchId);
    expect(result?.inboundMessageId).toBe(inbound.id);
    expect(findAcknowledgement(db, teacher.id, dispatchId)).toBeDefined();
  });

  it('matches and inserts acknowledgement for " 1" (leading space)', () => {
    const dispatchId = insertDispatchAtOffset(0);
    const inbound = { id: randomUUID(), bodyText: " 1" };
    const result = matchAcknowledgement(db, teacher.id, guardian.id, inbound);
    expect(result).not.toBeNull();
    expect(result?.dispatchedMessageId).toBe(dispatchId);
    expect(findAcknowledgement(db, teacher.id, dispatchId)).toBeDefined();
  });

  it('matches and inserts acknowledgement for "1 " (trailing space)', () => {
    const dispatchId = insertDispatchAtOffset(0);
    const inbound = { id: randomUUID(), bodyText: "1 " };
    const result = matchAcknowledgement(db, teacher.id, guardian.id, inbound);
    expect(result).not.toBeNull();
    expect(result?.dispatchedMessageId).toBe(dispatchId);
    expect(findAcknowledgement(db, teacher.id, dispatchId)).toBeDefined();
  });

  it('matches and inserts acknowledgement for "1\\n" (trailing newline)', () => {
    const dispatchId = insertDispatchAtOffset(0);
    const inbound = { id: randomUUID(), bodyText: "1\n" };
    const result = matchAcknowledgement(db, teacher.id, guardian.id, inbound);
    expect(result).not.toBeNull();
    expect(result?.dispatchedMessageId).toBe(dispatchId);
    expect(findAcknowledgement(db, teacher.id, dispatchId)).toBeDefined();
  });

  it('does NOT match for "1." (punctuation)', () => {
    insertDispatchAtOffset(0);
    const result = matchAcknowledgement(db, teacher.id, guardian.id, { id: randomUUID(), bodyText: "1." });
    expect(result).toBeNull();
  });

  it('does NOT match for "1!" (exclamation)', () => {
    insertDispatchAtOffset(0);
    const result = matchAcknowledgement(db, teacher.id, guardian.id, { id: randomUUID(), bodyText: "1!" });
    expect(result).toBeNull();
  });

  it('does NOT match for "ok"', () => {
    insertDispatchAtOffset(0);
    const result = matchAcknowledgement(db, teacher.id, guardian.id, { id: randomUUID(), bodyText: "ok" });
    expect(result).toBeNull();
  });

  it('does NOT match for "1 sim"', () => {
    insertDispatchAtOffset(0);
    const result = matchAcknowledgement(db, teacher.id, guardian.id, { id: randomUUID(), bodyText: "1 sim" });
    expect(result).toBeNull();
  });

  it('does NOT match for "recebi"', () => {
    insertDispatchAtOffset(0);
    const result = matchAcknowledgement(db, teacher.id, guardian.id, { id: randomUUID(), bodyText: "recebi" });
    expect(result).toBeNull();
  });

  it('does NOT match for "11"', () => {
    insertDispatchAtOffset(0);
    const result = matchAcknowledgement(db, teacher.id, guardian.id, { id: randomUUID(), bodyText: "11" });
    expect(result).toBeNull();
  });

  // ─── 24h window ──────────────────────────────────────────────────────────

  it("returns null and inserts no acknowledgement when no dispatch within 24h", () => {
    const dispatchId = insertDispatchAtOffset(-25 * 60 * 60 * 1000); // 25h ago
    const inbound = { id: randomUUID(), bodyText: "1" };
    const result = matchAcknowledgement(db, teacher.id, guardian.id, inbound);
    expect(result).toBeNull();
    expect(findAcknowledgement(db, teacher.id, dispatchId)).toBeUndefined();
  });

  // ─── Idempotency ─────────────────────────────────────────────────────────

  it("inserts only one acknowledgement row when called twice with the same dispatch (idempotency)", () => {
    const dispatchId = insertDispatchAtOffset(0);
    const inbound = { id: randomUUID(), bodyText: "1" };

    matchAcknowledgement(db, teacher.id, guardian.id, inbound);
    matchAcknowledgement(db, teacher.id, guardian.id, inbound);

    const rows = db
      .prepare("SELECT COUNT(*) as cnt FROM acknowledgements WHERE dispatched_message_id = ?")
      .get(dispatchId) as { cnt: number };
    expect(rows.cnt).toBe(1);
  });

  // ─── Most recent dispatch ─────────────────────────────────────────────────

  it("links acknowledgement to the most recent dispatch when multiple are pending within 24h", () => {
    const olderDispatchId = insertDispatchAtOffset(-2 * 60 * 60 * 1000); // 2h ago
    const newerDispatchId = insertDispatchAtOffset(-1 * 60 * 60 * 1000); // 1h ago

    const inbound = { id: randomUUID(), bodyText: "1" };
    const result = matchAcknowledgement(db, teacher.id, guardian.id, inbound);

    expect(result?.dispatchedMessageId).toBe(newerDispatchId);
    expect(findAcknowledgement(db, teacher.id, newerDispatchId)).toBeDefined();
    expect(findAcknowledgement(db, teacher.id, olderDispatchId)).toBeUndefined();
  });
});
