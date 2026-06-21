import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../database.js";
import { runMigrations } from "../migrate.js";
import { insertTeacher, findTeacherByPhone } from "./teachers.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type Database from "better-sqlite3";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");

describe("findTeacherByPhone", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db, MIGRATIONS_DIR);
    insertTeacher(db, {
      name: "Prof. Ana",
      evolutionInstance: "meta-abc",
      phoneE164: "+5511942219711",
    });
  });

  it("finds teacher by E.164 number with +", () => {
    const teacher = findTeacherByPhone(db, "+5511942219711");
    expect(teacher?.name).toBe("Prof. Ana");
  });

  it("finds teacher by number without + (Meta webhook format)", () => {
    const teacher = findTeacherByPhone(db, "5511942219711");
    expect(teacher?.name).toBe("Prof. Ana");
  });

  it("returns undefined for unknown number", () => {
    expect(findTeacherByPhone(db, "+5511000000000")).toBeUndefined();
  });
});
