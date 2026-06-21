import Database from "better-sqlite3";
import type { CsvRow } from "./csv-parser.js";
import { findTeacherByExternalRef } from "../db/repositories/teachers.js";
import {
  findStudentByExternalRef,
  insertStudent,
  updateStudent,
} from "../db/repositories/students.js";
import {
  insertGuardian,
  findGuardianByPhone,
  updateGuardian,
  setGuardianActive,
} from "../db/repositories/guardians.js";
import {
  linkStudentGuardian,
  unlinkStudentGuardian,
  countStudentLinksForGuardian,
  listGuardiansForStudent,
} from "../db/repositories/student-guardians.js";

export interface ImportResult {
  studentsAdded: number;
  studentsUpdated: number;
  guardiansAdded: number;
  guardiansUpdated: number;
  guardiansDeactivated: number;
  rowErrors: Array<{ line: number; message: string }>;
}

export function importRoster(
  db: Database.Database,
  rows: CsvRow[],
  teacherExternalIdFilter?: string,
): ImportResult {
  const result: ImportResult = {
    studentsAdded: 0,
    studentsUpdated: 0,
    guardiansAdded: 0,
    guardiansUpdated: 0,
    guardiansDeactivated: 0,
    rowErrors: [],
  };

  if (rows.length === 0) return result;

  const filtered = teacherExternalIdFilter
    ? rows.filter((r) => r.teacherExternalId === teacherExternalIdFilter)
    : rows;

  // Group by teacher then by student
  const byTeacher = new Map<string, Map<string, CsvRow[]>>();
  for (const row of filtered) {
    if (!byTeacher.has(row.teacherExternalId)) {
      byTeacher.set(row.teacherExternalId, new Map());
    }
    const byStudent = byTeacher.get(row.teacherExternalId)!;
    if (!byStudent.has(row.studentExternalId)) {
      byStudent.set(row.studentExternalId, []);
    }
    byStudent.get(row.studentExternalId)!.push(row);
  }

  const doImport = db.transaction(() => {
    for (const [teacherExtId, students] of byTeacher) {
      const teacher = findTeacherByExternalRef(db, teacherExtId);
      if (!teacher) {
        for (const guardianRows of students.values()) {
          for (const row of guardianRows) {
            result.rowErrors.push({
              line: row.line,
              message: `Teacher not found for external_ref: ${teacherExtId}`,
            });
          }
        }
        continue;
      }

      for (const [studentExtId, guardianRows] of students) {
        const firstRow = guardianRows[0]!;

        // Upsert student by external_ref
        let student = findStudentByExternalRef(db, teacher.id, studentExtId);
        if (!student) {
          student = insertStudent(db, teacher.id, {
            name: firstRow.studentName,
            classId: firstRow.classId || null,
            externalRef: studentExtId,
          });
          result.studentsAdded++;
        } else {
          updateStudent(db, teacher.id, student.id, {
            name: firstRow.studentName,
            classId: firstRow.classId || null,
          });
          result.studentsUpdated++;
        }

        // Capture current guardian set before replacement
        const currentGuardians = listGuardiansForStudent(db, teacher.id, student.id);
        const currentGuardianIds = new Set(currentGuardians.map((g) => g.id));

        // Process new guardian set, building the set of new guardian IDs
        const newGuardianIds = new Set<string>();

        for (const row of guardianRows) {
          // Find by phone to preserve existing guardian ID (stable for dispatch history)
          let guardian = findGuardianByPhone(db, teacher.id, row.guardianPhoneE164);
          if (!guardian) {
            guardian = insertGuardian(db, teacher.id, {
              name: row.guardianName,
              phoneE164: row.guardianPhoneE164,
              role: row.guardianRole,
            });
            result.guardiansAdded++;
          } else {
            updateGuardian(db, teacher.id, guardian.id, {
              name: row.guardianName,
              role: row.guardianRole,
            });
            if (guardian.isActive === 0) {
              setGuardianActive(db, teacher.id, guardian.id, true);
            }
            result.guardiansUpdated++;
          }

          newGuardianIds.add(guardian.id);
          linkStudentGuardian(db, teacher.id, student.id, guardian.id);
        }

        // Soft-deactivate guardians removed from this student's set
        for (const guardian of currentGuardians) {
          if (!newGuardianIds.has(guardian.id)) {
            unlinkStudentGuardian(db, teacher.id, student.id, guardian.id);
            // Only deactivate if no other student links remain
            if (countStudentLinksForGuardian(db, guardian.id) === 0) {
              setGuardianActive(db, teacher.id, guardian.id, false);
              result.guardiansDeactivated++;
            }
          }
        }
      }
    }
  });

  doImport();
  return result;
}
