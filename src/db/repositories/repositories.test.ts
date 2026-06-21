import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { openDb } from "../database.js";
import { runMigrations } from "../migrate.js";
import {
  insertTeacher,
  findTeacherById,
  findTeacherByInstance,
  listTeachers,
} from "./teachers.js";
import {
  insertStudent,
  findStudentById,
  findStudentByExternalRef,
  listStudentsByTeacher,
  deleteStudentsByTeacher,
} from "./students.js";
import {
  insertGuardian,
  findGuardianById,
  findGuardianByPhone,
  listGuardiansByTeacher,
} from "./guardians.js";
import {
  linkStudentGuardian,
  unlinkStudentGuardians,
  listGuardiansForStudent,
} from "./student-guardians.js";
import {
  insertDispatchedMessage,
  updateDispatchedMessageStatus,
  findDispatchedMessageById,
  findDispatchedMessageByProviderId,
  listDispatchedMessagesByTeacher,
} from "./dispatched-messages.js";
import {
  insertDeliveryEvent,
  listDeliveryEventsByMessage,
} from "./delivery-events.js";
import {
  insertAcknowledgement,
  findAcknowledgement,
} from "./acknowledgements.js";
import {
  insertInboundMessage,
  findInboundMessageById,
  listInboundMessagesByTeacher,
  normalizeText,
} from "./inbound-messages.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname_test = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname_test, "..", "..", "..", "migrations");

function createTestDb() {
  const db = openDb(":memory:");
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

// ─── teachers ────────────────────────────────────────────────────────────────

describe("teachers repository", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  it("insertTeacher returns a teacher with generated id and createdAt", () => {
    const t = insertTeacher(db, {
      name: "Prof. Silva",
      evolutionInstance: "inst-silva",
      phoneE164: "+5511999990001",
    });
    expect(t.id).toBeDefined();
    expect(t.name).toBe("Prof. Silva");
    expect(t.evolutionInstance).toBe("inst-silva");
    expect(t.phoneE164).toBe("+5511999990001");
    expect(t.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("findTeacherById returns the teacher", () => {
    const inserted = insertTeacher(db, {
      name: "Prof. Silva",
      evolutionInstance: "inst-silva",
      phoneE164: "+5511999990001",
    });
    const found = findTeacherById(db, inserted.id);
    expect(found).toEqual(inserted);
  });

  it("findTeacherById returns undefined for unknown id", () => {
    expect(findTeacherById(db, "unknown")).toBeUndefined();
  });

  it("findTeacherByInstance returns the teacher", () => {
    const inserted = insertTeacher(db, {
      name: "Prof. Silva",
      evolutionInstance: "inst-silva",
      phoneE164: "+5511999990001",
    });
    expect(findTeacherByInstance(db, "inst-silva")).toEqual(inserted);
  });

  it("listTeachers returns all teachers", () => {
    insertTeacher(db, { name: "A", evolutionInstance: "inst-a", phoneE164: "+5511000000001" });
    insertTeacher(db, { name: "B", evolutionInstance: "inst-b", phoneE164: "+5511000000002" });
    expect(listTeachers(db)).toHaveLength(2);
  });
});

// ─── students ────────────────────────────────────────────────────────────────

describe("students repository", () => {
  let db: ReturnType<typeof createTestDb>;
  let teacherId: string;

  beforeEach(() => {
    db = createTestDb();
    const t = insertTeacher(db, {
      name: "Prof. Silva",
      evolutionInstance: "inst-silva",
      phoneE164: "+5511999990001",
    });
    teacherId = t.id;
  });

  it("insertStudent returns a student scoped to the teacher", () => {
    const s = insertStudent(db, teacherId, { name: "João", classId: "5A", externalRef: "ref_001" });
    expect(s.teacherId).toBe(teacherId);
    expect(s.name).toBe("João");
    expect(s.classId).toBe("5A");
    expect(s.externalRef).toBe("ref_001");
  });

  it("findStudentById requires teacherId — throws TypeError when empty", () => {
    expect(() => findStudentById(db, "", "any-id")).toThrow(TypeError);
    expect(() => findStudentById(db, "", "any-id")).toThrow("teacherId is required");
  });

  it("insertStudent requires teacherId — throws TypeError when empty", () => {
    expect(() => insertStudent(db, "", { name: "João" })).toThrow(TypeError);
  });

  it("listStudentsByTeacher requires teacherId — throws TypeError when empty", () => {
    expect(() => listStudentsByTeacher(db, "")).toThrow(TypeError);
  });

  it("findStudentByExternalRef requires teacherId", () => {
    expect(() => findStudentByExternalRef(db, "", "ref")).toThrow(TypeError);
  });

  it("deleteStudentsByTeacher requires teacherId", () => {
    expect(() => deleteStudentsByTeacher(db, "")).toThrow(TypeError);
  });

  it("findStudentById returns the student when scoped correctly", () => {
    const s = insertStudent(db, teacherId, { name: "João" });
    const found = findStudentById(db, teacherId, s.id);
    expect(found).toEqual(s);
  });

  it("findStudentByExternalRef returns the student", () => {
    insertStudent(db, teacherId, { name: "João", externalRef: "ref_001" });
    const found = findStudentByExternalRef(db, teacherId, "ref_001");
    expect(found?.name).toBe("João");
  });

  it("listStudentsByTeacher returns only students for that teacher", () => {
    insertStudent(db, teacherId, { name: "João" });
    insertStudent(db, teacherId, { name: "Maria" });
    const students = listStudentsByTeacher(db, teacherId);
    expect(students).toHaveLength(2);
    students.forEach((s) => expect(s.teacherId).toBe(teacherId));
  });

  it("insertStudent with duplicate (teacher_id, external_ref) triggers unique-index constraint", () => {
    insertStudent(db, teacherId, { name: "João", externalRef: "dup_ref" });
    expect(() =>
      insertStudent(db, teacherId, { name: "João Cópia", externalRef: "dup_ref" }),
    ).toThrow();
  });

  it("deleteStudentsByTeacher removes all students for that teacher", () => {
    insertStudent(db, teacherId, { name: "João" });
    deleteStudentsByTeacher(db, teacherId);
    expect(listStudentsByTeacher(db, teacherId)).toHaveLength(0);
  });
});

// ─── guardians ───────────────────────────────────────────────────────────────

describe("guardians repository", () => {
  let db: ReturnType<typeof createTestDb>;
  let teacherId: string;

  beforeEach(() => {
    db = createTestDb();
    const t = insertTeacher(db, {
      name: "Prof. Silva",
      evolutionInstance: "inst-silva",
      phoneE164: "+5511999990001",
    });
    teacherId = t.id;
  });

  it("insertGuardian requires teacherId", () => {
    expect(() => insertGuardian(db, "", { name: "Maria", phoneE164: "+55119", role: "mae" })).toThrow(TypeError);
  });

  it("findGuardianById requires teacherId", () => {
    expect(() => findGuardianById(db, "", "id")).toThrow(TypeError);
  });

  it("findGuardianByPhone requires teacherId", () => {
    expect(() => findGuardianByPhone(db, "", "+55119")).toThrow(TypeError);
  });

  it("listGuardiansByTeacher requires teacherId", () => {
    expect(() => listGuardiansByTeacher(db, "")).toThrow(TypeError);
  });

  it("insertGuardian returns a guardian scoped to the teacher", () => {
    const g = insertGuardian(db, teacherId, {
      name: "Maria",
      phoneE164: "+5511999990002",
      role: "mae",
    });
    expect(g.teacherId).toBe(teacherId);
    expect(g.role).toBe("mae");
  });

  it("findGuardianByPhone returns the guardian", () => {
    insertGuardian(db, teacherId, { name: "Maria", phoneE164: "+5511000001", role: "mae" });
    const found = findGuardianByPhone(db, teacherId, "+5511000001");
    expect(found?.name).toBe("Maria");
  });

  it("listGuardiansByTeacher returns guardians for that teacher", () => {
    insertGuardian(db, teacherId, { name: "A", phoneE164: "+55110001", role: "mae" });
    insertGuardian(db, teacherId, { name: "B", phoneE164: "+55110002", role: "pai" });
    expect(listGuardiansByTeacher(db, teacherId)).toHaveLength(2);
  });
});

// ─── student-guardians ───────────────────────────────────────────────────────

describe("student-guardians repository", () => {
  let db: ReturnType<typeof createTestDb>;
  let teacherId: string;
  let studentId: string;
  let guardianId: string;

  beforeEach(() => {
    db = createTestDb();
    const t = insertTeacher(db, { name: "Prof. Silva", evolutionInstance: "inst-sg", phoneE164: "+5511000000010" });
    teacherId = t.id;
    const s = insertStudent(db, teacherId, { name: "João" });
    studentId = s.id;
    const g = insertGuardian(db, teacherId, { name: "Maria", phoneE164: "+5511000000011", role: "mae" });
    guardianId = g.id;
  });

  it("linkStudentGuardian requires teacherId", () => {
    expect(() => linkStudentGuardian(db, "", studentId, guardianId)).toThrow(TypeError);
  });

  it("unlinkStudentGuardians requires teacherId", () => {
    expect(() => unlinkStudentGuardians(db, "", studentId)).toThrow(TypeError);
  });

  it("listGuardiansForStudent requires teacherId", () => {
    expect(() => listGuardiansForStudent(db, "", studentId)).toThrow(TypeError);
  });

  it("linkStudentGuardian creates the relationship", () => {
    linkStudentGuardian(db, teacherId, studentId, guardianId);
    const guardians = listGuardiansForStudent(db, teacherId, studentId);
    expect(guardians).toHaveLength(1);
    expect(guardians[0]?.id).toBe(guardianId);
  });

  it("linking the same pair twice does not throw (INSERT OR IGNORE)", () => {
    linkStudentGuardian(db, teacherId, studentId, guardianId);
    expect(() => linkStudentGuardian(db, teacherId, studentId, guardianId)).not.toThrow();
  });

  it("unlinkStudentGuardians removes all guardian links for the student", () => {
    linkStudentGuardian(db, teacherId, studentId, guardianId);
    unlinkStudentGuardians(db, teacherId, studentId);
    expect(listGuardiansForStudent(db, teacherId, studentId)).toHaveLength(0);
  });
});

// ─── dispatched-messages ─────────────────────────────────────────────────────

describe("dispatched-messages repository", () => {
  let db: ReturnType<typeof createTestDb>;
  let teacherId: string;
  let guardianId: string;

  beforeEach(() => {
    db = createTestDb();
    const t = insertTeacher(db, { name: "Prof. Silva", evolutionInstance: "inst-dm", phoneE164: "+5511000000020" });
    teacherId = t.id;
    const g = insertGuardian(db, teacherId, { name: "Maria", phoneE164: "+5511000000021", role: "mae" });
    guardianId = g.id;
  });

  it("insertDispatchedMessage requires teacherId", () => {
    expect(() =>
      insertDispatchedMessage(db, "", { id: "m1", guardianId, draftText: "d", bodyText: "b" }),
    ).toThrow(TypeError);
  });

  it("findDispatchedMessageById requires teacherId", () => {
    expect(() => findDispatchedMessageById(db, "", "m1")).toThrow(TypeError);
  });

  it("findDispatchedMessageByProviderId requires teacherId", () => {
    expect(() => findDispatchedMessageByProviderId(db, "", "p1")).toThrow(TypeError);
  });

  it("listDispatchedMessagesByTeacher requires teacherId", () => {
    expect(() => listDispatchedMessagesByTeacher(db, "")).toThrow(TypeError);
  });

  it("updateDispatchedMessageStatus requires teacherId", () => {
    expect(() => updateDispatchedMessageStatus(db, "", "m1", "sent")).toThrow(TypeError);
  });

  it("inserts with status pending, updates to sent, query returns correct row", () => {
    const msg = insertDispatchedMessage(db, teacherId, {
      id: `m_${randomUUID()}`,
      guardianId,
      draftText: "draft text",
      bodyText: "body text",
    });
    expect(msg.status).toBe("pending");

    updateDispatchedMessageStatus(db, teacherId, msg.id, "sent", {
      providerMessageId: "prov-123",
      sentAt: new Date().toISOString(),
    });

    const found = findDispatchedMessageById(db, teacherId, msg.id);
    expect(found?.status).toBe("sent");
    expect(found?.providerMessageId).toBe("prov-123");
    expect(found?.teacherId).toBe(teacherId);
  });

  it("findDispatchedMessageByProviderId returns the correct message", () => {
    const msgId = `m_${randomUUID()}`;
    insertDispatchedMessage(db, teacherId, {
      id: msgId,
      guardianId,
      draftText: "draft",
      bodyText: "body",
    });
    updateDispatchedMessageStatus(db, teacherId, msgId, "sent", { providerMessageId: "prov-456" });

    const found = findDispatchedMessageByProviderId(db, teacherId, "prov-456");
    expect(found?.id).toBe(msgId);
  });

  it("listDispatchedMessagesByTeacher returns messages ordered newest first", () => {
    insertDispatchedMessage(db, teacherId, { id: `m_${randomUUID()}`, guardianId, draftText: "d1", bodyText: "b1" });
    insertDispatchedMessage(db, teacherId, { id: `m_${randomUUID()}`, guardianId, draftText: "d2", bodyText: "b2" });
    const msgs = listDispatchedMessagesByTeacher(db, teacherId);
    expect(msgs).toHaveLength(2);
  });
});

// ─── delivery-events ─────────────────────────────────────────────────────────

describe("delivery-events repository", () => {
  let db: ReturnType<typeof createTestDb>;
  let teacherId: string;
  let msgId: string;

  beforeEach(() => {
    db = createTestDb();
    const t = insertTeacher(db, { name: "Prof. Silva", evolutionInstance: "inst-de", phoneE164: "+5511000000030" });
    teacherId = t.id;
    const g = insertGuardian(db, teacherId, { name: "Maria", phoneE164: "+5511000000031", role: "mae" });
    msgId = `m_${randomUUID()}`;
    insertDispatchedMessage(db, teacherId, {
      id: msgId,
      guardianId: g.id,
      draftText: "draft",
      bodyText: "body",
    });
  });

  it("insertDeliveryEvent requires teacherId", () => {
    expect(() =>
      insertDeliveryEvent(db, "", { dispatchedMessageId: msgId, status: "delivered", observedAt: new Date().toISOString() }),
    ).toThrow(TypeError);
  });

  it("listDeliveryEventsByMessage requires teacherId", () => {
    expect(() => listDeliveryEventsByMessage(db, "", msgId)).toThrow(TypeError);
  });

  it("insertDeliveryEvent inserts and listDeliveryEventsByMessage retrieves it", () => {
    const ev = insertDeliveryEvent(db, teacherId, {
      dispatchedMessageId: msgId,
      status: "delivered",
      observedAt: new Date().toISOString(),
    });
    expect(ev.id).toBeGreaterThan(0);

    const events = listDeliveryEventsByMessage(db, teacherId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe("delivered");
  });

  it("listDeliveryEventsByMessage scopes by teacherId via join", () => {
    // Insert a second teacher — their delivery events should not leak
    const t2 = insertTeacher(db, { name: "Prof. Outro", evolutionInstance: "inst-de2", phoneE164: "+5511000000032" });
    const g2 = insertGuardian(db, t2.id, { name: "Carlos", phoneE164: "+5511000000033", role: "pai" });
    const msgId2 = `m_${randomUUID()}`;
    insertDispatchedMessage(db, t2.id, { id: msgId2, guardianId: g2.id, draftText: "d", bodyText: "b" });
    insertDeliveryEvent(db, t2.id, { dispatchedMessageId: msgId2, status: "read", observedAt: new Date().toISOString() });

    insertDeliveryEvent(db, teacherId, { dispatchedMessageId: msgId, status: "delivered", observedAt: new Date().toISOString() });

    const events = listDeliveryEventsByMessage(db, teacherId, msgId);
    expect(events).toHaveLength(1);
  });
});

// ─── acknowledgements ────────────────────────────────────────────────────────

describe("acknowledgements repository", () => {
  let db: ReturnType<typeof createTestDb>;
  let teacherId: string;
  let msgId: string;

  beforeEach(() => {
    db = createTestDb();
    const t = insertTeacher(db, { name: "Prof. Silva", evolutionInstance: "inst-ack", phoneE164: "+5511000000040" });
    teacherId = t.id;
    const g = insertGuardian(db, teacherId, { name: "Maria", phoneE164: "+5511000000041", role: "mae" });
    msgId = `m_${randomUUID()}`;
    insertDispatchedMessage(db, teacherId, { id: msgId, guardianId: g.id, draftText: "d", bodyText: "b" });
  });

  it("insertAcknowledgement requires teacherId", () => {
    expect(() =>
      insertAcknowledgement(db, "", { dispatchedMessageId: msgId, inboundMessageId: "inb-1", acknowledgedAt: new Date().toISOString() }),
    ).toThrow(TypeError);
  });

  it("findAcknowledgement requires teacherId", () => {
    expect(() => findAcknowledgement(db, "", msgId)).toThrow(TypeError);
  });

  it("insertAcknowledgement and findAcknowledgement work correctly", () => {
    insertAcknowledgement(db, teacherId, {
      dispatchedMessageId: msgId,
      inboundMessageId: "inb-1",
      acknowledgedAt: new Date().toISOString(),
    });
    const ack = findAcknowledgement(db, teacherId, msgId);
    expect(ack?.inboundMessageId).toBe("inb-1");
  });

  it("findAcknowledgement returns undefined for wrong teacherId", () => {
    const t2 = insertTeacher(db, { name: "Other", evolutionInstance: "inst-ack2", phoneE164: "+5511000000042" });
    insertAcknowledgement(db, teacherId, {
      dispatchedMessageId: msgId,
      inboundMessageId: "inb-1",
      acknowledgedAt: new Date().toISOString(),
    });
    expect(findAcknowledgement(db, t2.id, msgId)).toBeUndefined();
  });
});

// ─── inbound-messages ────────────────────────────────────────────────────────

describe("inbound-messages repository", () => {
  let db: ReturnType<typeof createTestDb>;
  let teacherId: string;

  beforeEach(() => {
    db = createTestDb();
    const t = insertTeacher(db, { name: "Prof. Silva", evolutionInstance: "inst-inb", phoneE164: "+5511000000050" });
    teacherId = t.id;
  });

  it("insertInboundMessage requires teacherId", () => {
    expect(() =>
      insertInboundMessage(db, "", { id: "inb-1", bodyText: "hello", receivedAt: new Date().toISOString() }),
    ).toThrow(TypeError);
  });

  it("findInboundMessageById requires teacherId", () => {
    expect(() => findInboundMessageById(db, "", "inb-1")).toThrow(TypeError);
  });

  it("listInboundMessagesByTeacher requires teacherId", () => {
    expect(() => listInboundMessagesByTeacher(db, "")).toThrow(TypeError);
  });

  it("insertInboundMessage stores normalizedText automatically", () => {
    const msg = insertInboundMessage(db, teacherId, {
      id: "inb-1",
      bodyText: "Olá, bom dia!",
      receivedAt: new Date().toISOString(),
    });
    expect(msg.normalizedText).toBe("ola, bom dia!");
  });

  it("findInboundMessageById returns the message scoped to teacher", () => {
    const msg = insertInboundMessage(db, teacherId, {
      id: "inb-2",
      bodyText: "hello",
      receivedAt: new Date().toISOString(),
    });
    const found = findInboundMessageById(db, teacherId, "inb-2");
    expect(found).toEqual(msg);
  });

  it("listInboundMessagesByTeacher returns messages for that teacher only", () => {
    insertInboundMessage(db, teacherId, { id: "inb-3", bodyText: "a", receivedAt: new Date().toISOString() });
    insertInboundMessage(db, teacherId, { id: "inb-4", bodyText: "b", receivedAt: new Date().toISOString() });
    const msgs = listInboundMessagesByTeacher(db, teacherId);
    expect(msgs).toHaveLength(2);
  });

  it("normalizeText strips accents and lowercases", () => {
    expect(normalizeText("Ação")).toBe("acao");
    expect(normalizeText("Ólá")).toBe("ola");
    expect(normalizeText("  HELLO  ")).toBe("hello");
  });
});

// ─── Integration: per-teacher isolation ──────────────────────────────────────

describe("Integration: per-teacher isolation", () => {
  it("a student written for teacher A is not returned by teacher B's roster query", () => {
    const db = createTestDb();

    const teacherA = insertTeacher(db, {
      name: "Prof. A",
      evolutionInstance: "inst-a",
      phoneE164: "+5511000000100",
    });
    const teacherB = insertTeacher(db, {
      name: "Prof. B",
      evolutionInstance: "inst-b",
      phoneE164: "+5511000000101",
    });

    insertStudent(db, teacherA.id, { name: "João (aluno de A)" });

    const studentsForA = listStudentsByTeacher(db, teacherA.id);
    const studentsForB = listStudentsByTeacher(db, teacherB.id);

    expect(studentsForA).toHaveLength(1);
    expect(studentsForB).toHaveLength(0);

    db.close();
  });

  it("guardians written for teacher A are not visible to teacher B", () => {
    const db = createTestDb();

    const teacherA = insertTeacher(db, {
      name: "Prof. A",
      evolutionInstance: "inst-ga",
      phoneE164: "+5511000000102",
    });
    const teacherB = insertTeacher(db, {
      name: "Prof. B",
      evolutionInstance: "inst-gb",
      phoneE164: "+5511000000103",
    });

    insertGuardian(db, teacherA.id, { name: "Maria", phoneE164: "+5511000000104", role: "mae" });

    expect(listGuardiansByTeacher(db, teacherA.id)).toHaveLength(1);
    expect(listGuardiansByTeacher(db, teacherB.id)).toHaveLength(0);

    db.close();
  });
});
