import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { Teacher } from "../../domain/types.js";

interface TeacherRow {
  id: string;
  name: string;
  evolution_instance: string;
  phone_e164: string;
  external_ref: string | null;
  created_at: string;
  welcome_sent_at: string | null;
}

function toTeacher(row: TeacherRow): Teacher {
  return {
    id: row.id,
    name: row.name,
    evolutionInstance: row.evolution_instance,
    phoneE164: row.phone_e164,
    externalRef: row.external_ref,
    createdAt: row.created_at,
    welcomeSentAt: row.welcome_sent_at ?? null,
  };
}

export function insertTeacher(
  db: Database.Database,
  data: { id?: string; name: string; evolutionInstance: string; phoneE164: string; externalRef?: string | null },
): Teacher {
  const teacher: Teacher = {
    id: data.id ?? randomUUID(),
    name: data.name,
    evolutionInstance: data.evolutionInstance,
    phoneE164: data.phoneE164,
    externalRef: data.externalRef ?? null,
    createdAt: new Date().toISOString(),
    welcomeSentAt: null,
  };
  db.prepare(
    "INSERT INTO teachers (id, name, evolution_instance, phone_e164, external_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    teacher.id,
    teacher.name,
    teacher.evolutionInstance,
    teacher.phoneE164,
    teacher.externalRef,
    teacher.createdAt,
  );
  return teacher;
}

export function findTeacherById(
  db: Database.Database,
  id: string,
): Teacher | undefined {
  const row = db
    .prepare("SELECT * FROM teachers WHERE id = ?")
    .get(id) as TeacherRow | undefined;
  return row ? toTeacher(row) : undefined;
}

export function findTeacherByInstance(
  db: Database.Database,
  evolutionInstance: string,
): Teacher | undefined {
  const row = db
    .prepare("SELECT * FROM teachers WHERE evolution_instance = ?")
    .get(evolutionInstance) as TeacherRow | undefined;
  return row ? toTeacher(row) : undefined;
}

export function findTeacherByExternalRef(
  db: Database.Database,
  externalRef: string,
): Teacher | undefined {
  const row = db
    .prepare("SELECT * FROM teachers WHERE external_ref = ?")
    .get(externalRef) as TeacherRow | undefined;
  return row ? toTeacher(row) : undefined;
}

export function deleteTeacherById(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM teachers WHERE id = ?").run(id);
}

export function listTeachers(db: Database.Database): Teacher[] {
  return (
    db.prepare("SELECT * FROM teachers ORDER BY created_at").all() as TeacherRow[]
  ).map(toTeacher);
}

export function markWelcomeSent(db: Database.Database, teacherId: string): void {
  db.prepare("UPDATE teachers SET welcome_sent_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    teacherId,
  );
}

export function findTeacherByPhone(
  db: Database.Database,
  phone: string,
): Teacher | undefined {
  const normalized = phone.startsWith("+") ? phone : `+${phone}`;
  const row = db
    .prepare("SELECT * FROM teachers WHERE phone_e164 = ?")
    .get(normalized) as TeacherRow | undefined;
  return row ? toTeacher(row) : undefined;
}
