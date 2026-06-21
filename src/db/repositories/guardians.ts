import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { Guardian } from "../../domain/types.js";

interface GuardianRow {
  id: string;
  teacher_id: string;
  name: string;
  phone_e164: string;
  role: string;
  is_active: number;
  created_at: string;
}

function toGuardian(row: GuardianRow): Guardian {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    name: row.name,
    phoneE164: row.phone_e164,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function requireTeacherId(teacherId: string): void {
  if (!teacherId) throw new TypeError("teacherId is required");
}

export function insertGuardian(
  db: Database.Database,
  teacherId: string,
  data: { name: string; phoneE164: string; role: string; externalRef?: string | null },
): Guardian {
  requireTeacherId(teacherId);
  const guardian: Guardian = {
    id: randomUUID(),
    teacherId,
    name: data.name,
    phoneE164: data.phoneE164,
    role: data.role,
    isActive: 1,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    "INSERT INTO guardians (id, teacher_id, name, phone_e164, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    guardian.id,
    guardian.teacherId,
    guardian.name,
    guardian.phoneE164,
    guardian.role,
    guardian.createdAt,
  );
  return guardian;
}

export function updateGuardian(
  db: Database.Database,
  teacherId: string,
  id: string,
  data: { name: string; role: string },
): void {
  requireTeacherId(teacherId);
  db.prepare(
    "UPDATE guardians SET name = ?, role = ? WHERE id = ? AND teacher_id = ?",
  ).run(data.name, data.role, id, teacherId);
}

export function setGuardianActive(
  db: Database.Database,
  teacherId: string,
  id: string,
  active: boolean,
): void {
  requireTeacherId(teacherId);
  db.prepare(
    "UPDATE guardians SET is_active = ? WHERE id = ? AND teacher_id = ?",
  ).run(active ? 1 : 0, id, teacherId);
}

export function findGuardianById(
  db: Database.Database,
  teacherId: string,
  id: string,
): Guardian | undefined {
  requireTeacherId(teacherId);
  const row = db
    .prepare("SELECT * FROM guardians WHERE id = ? AND teacher_id = ?")
    .get(id, teacherId) as GuardianRow | undefined;
  return row ? toGuardian(row) : undefined;
}

export function findGuardianByPhone(
  db: Database.Database,
  teacherId: string,
  phoneE164: string,
): Guardian | undefined {
  requireTeacherId(teacherId);
  const row = db
    .prepare(
      "SELECT * FROM guardians WHERE teacher_id = ? AND phone_e164 = ?",
    )
    .get(teacherId, phoneE164) as GuardianRow | undefined;
  return row ? toGuardian(row) : undefined;
}

export function listGuardiansByTeacher(
  db: Database.Database,
  teacherId: string,
): Guardian[] {
  requireTeacherId(teacherId);
  return (
    db
      .prepare("SELECT * FROM guardians WHERE teacher_id = ? ORDER BY name")
      .all(teacherId) as GuardianRow[]
  ).map(toGuardian);
}

export function findGuardiansByPhoneGlobal(
  db: Database.Database,
  phone: string,
): Array<{ guardian: Guardian; teacherId: string }> {
  const normalized = phone.startsWith("+") ? phone : `+${phone}`;
  const rows = db
    .prepare("SELECT * FROM guardians WHERE phone_e164 = ?")
    .all(normalized) as GuardianRow[];
  return rows.map((row) => ({ guardian: toGuardian(row), teacherId: row.teacher_id }));
}

export function getGuardiansByClassId(
  db: Database.Database,
  teacherId: string,
  classId: string,
): Guardian[] {
  requireTeacherId(teacherId);
  if (classId === "*") {
    return (
      db
        .prepare(
          `SELECT DISTINCT g.* FROM guardians g
           JOIN student_guardians sg ON sg.guardian_id = g.id
           JOIN students s ON s.id = sg.student_id
           WHERE s.teacher_id = ? AND g.is_active = 1
           ORDER BY g.name`,
        )
        .all(teacherId) as GuardianRow[]
    ).map(toGuardian);
  }
  return (
    db
      .prepare(
        `SELECT DISTINCT g.* FROM guardians g
         JOIN student_guardians sg ON sg.guardian_id = g.id
         JOIN students s ON s.id = sg.student_id
         WHERE s.teacher_id = ? AND s.class_id = ? AND g.is_active = 1
         ORDER BY g.name`,
      )
      .all(teacherId, classId) as GuardianRow[]
  ).map(toGuardian);
}
