import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { openDb } from "../db/database.js";
import { runMigrations } from "../db/migrate.js";
import { insertTeacher } from "../db/repositories/teachers.js";
import { insertGuardian } from "../db/repositories/guardians.js";
import { insertDispatchedMessage, updateDispatchedMessageStatus } from "../db/repositories/dispatched-messages.js";
import { insertDeliveryEvent } from "../db/repositories/delivery-events.js";
import { insertAcknowledgement } from "../db/repositories/acknowledgements.js";
import { queryStatus } from "./status-query.js";
import type Database from "better-sqlite3";
import type { Teacher, Guardian } from "./types.js";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = join(dirname(__filename), "..", "..", "migrations");

function makeDispatch(
  db: Database.Database,
  teacherId: string,
  guardianId: string,
  opts?: { broadcastGroupId?: string },
) {
  const id = `m_${randomUUID().slice(0, 8)}`;
  const msg = insertDispatchedMessage(db, teacherId, {
    id,
    guardianId,
    draftText: "Reunião adiada",
    bodyText: "Reunião adiada.\n\nResponda 1 para confirmar.",
    broadcastGroupId: opts?.broadcastGroupId ?? null,
  });
  updateDispatchedMessageStatus(db, teacherId, msg.id, "sent", {
    providerMessageId: `prov-${id}`,
    sentAt: new Date().toISOString(),
  });
  return msg;
}

describe("queryStatus", () => {
  let db: Database.Database;
  let teacher: Teacher;
  let guardian: Guardian;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db, MIGRATIONS_DIR);
    teacher = insertTeacher(db, {
      name: "Prof. Teste",
      evolutionInstance: "teacher-status-test",
      phoneE164: "+5511900000001",
    });
    guardian = insertGuardian(db, teacher.id, {
      name: "Maria Silva",
      phoneE164: "+5511900000002",
      role: "mae",
    });
  });

  afterEach(() => {
    db.close();
  });

  it("returns null when there are no dispatches and target is 'latest'", () => {
    expect(queryStatus(db, teacher.id, "latest")).toBeNull();
  });

  it("returns null for a specific ID that belongs to a different teacher", () => {
    const otherTeacher = insertTeacher(db, {
      name: "Prof. Outro",
      evolutionInstance: "teacher-other",
      phoneE164: "+5511900000099",
    });
    const otherGuardian = insertGuardian(db, otherTeacher.id, {
      name: "Outro Responsável",
      phoneE164: "+5511900000098",
      role: "pai",
    });
    const dispatch = makeDispatch(db, otherTeacher.id, otherGuardian.id);

    expect(queryStatus(db, teacher.id, dispatch.id)).toBeNull();
  });

  it("returns null for a specific ID that does not exist", () => {
    expect(queryStatus(db, teacher.id, "m_nonexistent")).toBeNull();
  });

  it("dispatch with READ event + acknowledgement → hasRead=true, hasAcknowledged=true", () => {
    const dispatch = makeDispatch(db, teacher.id, guardian.id);
    insertDeliveryEvent(db, teacher.id, {
      dispatchedMessageId: dispatch.id,
      status: "read",
      observedAt: new Date().toISOString(),
    });
    insertAcknowledgement(db, teacher.id, {
      dispatchedMessageId: dispatch.id,
      inboundMessageId: randomUUID(),
      acknowledgedAt: new Date().toISOString(),
    });

    const result = queryStatus(db, teacher.id, dispatch.id);
    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(1);
    expect(result!.lines[0]!.guardianName).toBe("Maria Silva");
    expect(result!.lines[0]!.hasRead).toBe(true);
    expect(result!.lines[0]!.hasAcknowledged).toBe(true);
  });

  it("dispatch with READ event but no acknowledgement → hasRead=true, hasAcknowledged=false", () => {
    const dispatch = makeDispatch(db, teacher.id, guardian.id);
    insertDeliveryEvent(db, teacher.id, {
      dispatchedMessageId: dispatch.id,
      status: "read",
      observedAt: new Date().toISOString(),
    });

    const result = queryStatus(db, teacher.id, dispatch.id);
    expect(result).not.toBeNull();
    expect(result!.lines[0]!.hasRead).toBe(true);
    expect(result!.lines[0]!.hasAcknowledged).toBe(false);
  });

  it("dispatch with only DELIVERY_ACK (not read) → hasRead=false, hasAcknowledged=false", () => {
    const dispatch = makeDispatch(db, teacher.id, guardian.id);
    insertDeliveryEvent(db, teacher.id, {
      dispatchedMessageId: dispatch.id,
      status: "delivered",
      observedAt: new Date().toISOString(),
    });

    const result = queryStatus(db, teacher.id, dispatch.id);
    expect(result).not.toBeNull();
    expect(result!.lines[0]!.hasRead).toBe(false);
    expect(result!.lines[0]!.hasAcknowledged).toBe(false);
  });

  it("dispatch with no delivery event → hasRead=false, hasAcknowledged=false", () => {
    const dispatch = makeDispatch(db, teacher.id, guardian.id);

    const result = queryStatus(db, teacher.id, dispatch.id);
    expect(result).not.toBeNull();
    expect(result!.lines[0]!.hasRead).toBe(false);
    expect(result!.lines[0]!.hasAcknowledged).toBe(false);
  });

  it("'latest' returns status for the most recent dispatch", () => {
    const g2 = insertGuardian(db, teacher.id, {
      name: "Carlos Costa",
      phoneE164: "+5511900000003",
      role: "pai",
    });
    makeDispatch(db, teacher.id, guardian.id);
    const latest = makeDispatch(db, teacher.id, g2.id);
    // Force latest dispatch to have a clearly later created_at to avoid same-ms ties
    db.prepare("UPDATE dispatched_messages SET created_at = ? WHERE id = ?").run(
      "2099-01-01T00:00:00.000Z",
      latest.id,
    );

    insertDeliveryEvent(db, teacher.id, {
      dispatchedMessageId: latest.id,
      status: "read",
      observedAt: new Date().toISOString(),
    });

    const result = queryStatus(db, teacher.id, "latest");
    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(1);
    expect(result!.lines[0]!.guardianName).toBe("Carlos Costa");
    expect(result!.lines[0]!.hasRead).toBe(true);
  });

  it("broadcast group: 'latest' returns all dispatches in the group", () => {
    const g2 = insertGuardian(db, teacher.id, {
      name: "João Souza",
      phoneE164: "+5511900000004",
      role: "pai",
    });
    const bgId = randomUUID();
    const d1 = makeDispatch(db, teacher.id, guardian.id, { broadcastGroupId: bgId });
    const d2 = makeDispatch(db, teacher.id, g2.id, { broadcastGroupId: bgId });

    insertDeliveryEvent(db, teacher.id, {
      dispatchedMessageId: d1.id,
      status: "read",
      observedAt: new Date().toISOString(),
    });

    const result = queryStatus(db, teacher.id, "latest");
    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(2);

    const names = result!.lines.map((l) => l.guardianName).sort();
    expect(names).toEqual(["João Souza", "Maria Silva"].sort());

    const mariaLine = result!.lines.find((l) => l.guardianName === "Maria Silva")!;
    expect(mariaLine.hasRead).toBe(true);

    const joaoLine = result!.lines.find((l) => l.guardianName === "João Souza")!;
    expect(joaoLine.hasRead).toBe(false);
  });

  it("specific message_id for a broadcast returns all dispatches in the group", () => {
    const g2 = insertGuardian(db, teacher.id, {
      name: "Pedro Lima",
      phoneE164: "+5511900000005",
      role: "responsavel",
    });
    const bgId = randomUUID();
    const d1 = makeDispatch(db, teacher.id, guardian.id, { broadcastGroupId: bgId });
    makeDispatch(db, teacher.id, g2.id, { broadcastGroupId: bgId });

    const result = queryStatus(db, teacher.id, d1.id);
    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(2);
  });
});
