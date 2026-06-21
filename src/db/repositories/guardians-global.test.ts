import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../database.js";
import { runMigrations } from "../migrate.js";
import { insertTeacher } from "./teachers.js";
import { insertGuardian, findGuardiansByPhoneGlobal } from "./guardians.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type Database from "better-sqlite3";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");

describe("findGuardiansByPhoneGlobal", () => {
  let db: Database.Database;
  let teacherId: string;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db, MIGRATIONS_DIR);
    const teacher = insertTeacher(db, {
      name: "Prof. Ana",
      evolutionInstance: "meta-abc",
      phoneE164: "+5511942219711",
    });
    teacherId = teacher.id;
    insertGuardian(db, teacherId, {
      name: "Maria Silva",
      phoneE164: "+5511987654321",
      role: "mae",
    });
  });

  it("finds guardian with + prefix", () => {
    const results = findGuardiansByPhoneGlobal(db, "+5511987654321");
    expect(results).toHaveLength(1);
    expect(results[0]?.guardian.name).toBe("Maria Silva");
    expect(results[0]?.teacherId).toBe(teacherId);
  });

  it("finds guardian without + prefix (Meta webhook format)", () => {
    const results = findGuardiansByPhoneGlobal(db, "5511987654321");
    expect(results).toHaveLength(1);
    expect(results[0]?.guardian.name).toBe("Maria Silva");
  });

  it("returns empty array for unknown number", () => {
    expect(findGuardiansByPhoneGlobal(db, "+5511000000000")).toHaveLength(0);
  });

  it("returns all guardians when same phone is registered under multiple teachers", () => {
    const teacher2 = insertTeacher(db, {
      name: "Prof. Carlos",
      evolutionInstance: "meta-xyz",
      phoneE164: "+5511933334444",
    });
    insertGuardian(db, teacher2.id, {
      name: "Maria Silva",
      phoneE164: "+5511987654321",
      role: "mae",
    });

    const results = findGuardiansByPhoneGlobal(db, "+5511987654321");
    expect(results).toHaveLength(2);
    const teacherIds = results.map((r) => r.teacherId);
    expect(teacherIds).toContain(teacherId);
    expect(teacherIds).toContain(teacher2.id);
  });
});
