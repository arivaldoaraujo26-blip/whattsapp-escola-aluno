import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { Student } from "../../domain/types.js";

interface StudentRow {
  id: string;
  teacher_id: string;
  name: string;
  class_id: string | null;
  external_ref: string | null;
  created_at: string;
}

function toStudent(row: StudentRow): Student {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    name: row.name,
    classId: row.class_id,
    externalRef: row.external_ref,
    createdAt: row.created_at,
  };
}

function requireTeacherId(teacherId: string): void {
  if (!teacherId) throw new TypeError("teacherId is required");
}

export function insertStudent(
  db: Database.Database,
  teacherId: string,
  data: {
    name: string;
    classId?: string | null;
    externalRef?: string | null;
  },
): Student {
  requireTeacherId(teacherId);
  const student: Student = {
    id: randomUUID(),
    teacherId,
    name: data.name,
    classId: data.classId ?? null,
    externalRef: data.externalRef ?? null,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    "INSERT INTO students (id, teacher_id, name, class_id, external_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    student.id,
    student.teacherId,
    student.name,
    student.classId,
    student.externalRef,
    student.createdAt,
  );
  return student;
}

export function findStudentById(
  db: Database.Database,
  teacherId: string,
  id: string,
): Student | undefined {
  requireTeacherId(teacherId);
  const row = db
    .prepare("SELECT * FROM students WHERE id = ? AND teacher_id = ?")
    .get(id, teacherId) as StudentRow | undefined;
  return row ? toStudent(row) : undefined;
}

export function findStudentByExternalRef(
  db: Database.Database,
  teacherId: string,
  externalRef: string,
): Student | undefined {
  requireTeacherId(teacherId);
  const row = db
    .prepare(
      "SELECT * FROM students WHERE teacher_id = ? AND external_ref = ?",
    )
    .get(teacherId, externalRef) as StudentRow | undefined;
  return row ? toStudent(row) : undefined;
}

export function listStudentsByTeacher(
  db: Database.Database,
  teacherId: string,
): Student[] {
  requireTeacherId(teacherId);
  return (
    db
      .prepare("SELECT * FROM students WHERE teacher_id = ? ORDER BY name")
      .all(teacherId) as StudentRow[]
  ).map(toStudent);
}

export function updateStudent(
  db: Database.Database,
  teacherId: string,
  id: string,
  data: { name: string; classId?: string | null },
): void {
  requireTeacherId(teacherId);
  db.prepare(
    "UPDATE students SET name = ?, class_id = ? WHERE id = ? AND teacher_id = ?",
  ).run(data.name, data.classId ?? null, id, teacherId);
}

export function deleteStudentsByTeacher(
  db: Database.Database,
  teacherId: string,
): void {
  requireTeacherId(teacherId);
  db.prepare("DELETE FROM students WHERE teacher_id = ?").run(teacherId);
}
