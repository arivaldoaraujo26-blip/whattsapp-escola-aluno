import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../db/database.js";
import { runMigrations } from "../db/migrate.js";
import { listTeachers } from "../db/repositories/teachers.js";
import { provisionTeacher } from "./teacher-provisioner.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type Database from "better-sqlite3";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations",
);

describe("provisionTeacher", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db, MIGRATIONS_DIR);
    process.env["META_BUSINESS_NUMBER"] = "+5511940000000";
  });

  it("inserts a teacher row and returns teacherId + businessNumber", async () => {
    const result = await provisionTeacher(db, {
      name: "Prof. Silva",
      phoneE164: "+5511999991111",
    });

    expect(result.teacherId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.businessNumber).toBe("+5511940000000");

    const teachers = listTeachers(db);
    expect(teachers).toHaveLength(1);
    expect(teachers[0]?.name).toBe("Prof. Silva");
    expect(teachers[0]?.phoneE164).toBe("+5511999991111");
  });

  it("sets evolutionInstance to meta-<teacherId> as placeholder", async () => {
    const result = await provisionTeacher(db, {
      name: "Prof. Costa",
      phoneE164: "+5511999992222",
    });

    const teachers = listTeachers(db);
    expect(teachers[0]?.evolutionInstance).toBe(`meta-${result.teacherId}`);
  });

  it("stores optional externalRef", async () => {
    await provisionTeacher(db, {
      name: "Prof. A",
      phoneE164: "+5511999993333",
      externalRef: "prof-a-1",
    });

    const teachers = listTeachers(db);
    expect(teachers[0]?.externalRef).toBe("prof-a-1");
  });

  it("throws on duplicate phone_e164 (UNIQUE constraint)", async () => {
    await provisionTeacher(db, {
      name: "Prof. A",
      phoneE164: "+5511999994444",
    });

    await expect(
      provisionTeacher(db, { name: "Prof. B", phoneE164: "+5511999994444" }),
    ).rejects.toThrow();
  });

  it("throws on duplicate externalRef (UNIQUE constraint)", async () => {
    await provisionTeacher(db, {
      name: "Prof. A",
      phoneE164: "+5511999995555",
      externalRef: "ref-dup",
    });

    await expect(
      provisionTeacher(db, {
        name: "Prof. B",
        phoneE164: "+5511999996666",
        externalRef: "ref-dup",
      }),
    ).rejects.toThrow();
  });
});
