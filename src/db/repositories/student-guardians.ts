import Database from "better-sqlite3";
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

function requireTeacherId(teacherId: string): void {
  if (!teacherId) throw new TypeError("teacherId is required");
}

export function linkStudentGuardian(
  db: Database.Database,
  teacherId: string,
  studentId: string,
  guardianId: string,
): void {
  requireTeacherId(teacherId);
  db.prepare(
    "INSERT OR IGNORE INTO student_guardians (student_id, guardian_id) VALUES (?, ?)",
  ).run(studentId, guardianId);
}

export function unlinkStudentGuardians(
  db: Database.Database,
  teacherId: string,
  studentId: string,
): void {
  requireTeacherId(teacherId);
  db.prepare(
    "DELETE FROM student_guardians WHERE student_id = ?",
  ).run(studentId);
}

export function unlinkStudentGuardian(
  db: Database.Database,
  teacherId: string,
  studentId: string,
  guardianId: string,
): void {
  requireTeacherId(teacherId);
  db.prepare(
    "DELETE FROM student_guardians WHERE student_id = ? AND guardian_id = ?",
  ).run(studentId, guardianId);
}

export function countStudentLinksForGuardian(
  db: Database.Database,
  guardianId: string,
): number {
  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM student_guardians WHERE guardian_id = ?")
    .get(guardianId) as { cnt: number };
  return row.cnt;
}

export function listGuardiansForStudent(
  db: Database.Database,
  teacherId: string,
  studentId: string,
): Guardian[] {
  requireTeacherId(teacherId);
  const rows = db
    .prepare(
      `SELECT g.* FROM guardians g
       JOIN student_guardians sg ON sg.guardian_id = g.id
       WHERE sg.student_id = ? AND g.teacher_id = ?
       ORDER BY g.name`,
    )
    .all(studentId, teacherId) as GuardianRow[];
  return rows.map((row) => ({
    id: row.id,
    teacherId: row.teacher_id,
    name: row.name,
    phoneE164: row.phone_e164,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
  }));
}
