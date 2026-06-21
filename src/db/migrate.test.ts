import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { openDb } from "./database.js";
import { runMigrations } from "./migrate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname_test = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname_test, "..", "..", "migrations");

function createTestDb() {
  return openDb(":memory:");
}

describe("runMigrations — unit", () => {
  it("applies 0001_initial.sql on a fresh :memory: database without error", () => {
    const db = createTestDb();
    expect(() => runMigrations(db, MIGRATIONS_DIR)).not.toThrow();
    db.close();
  });

  it("is idempotent — running twice does not fail or duplicate rows in schema_migrations", () => {
    const db = createTestDb();
    runMigrations(db, MIGRATIONS_DIR);
    expect(() => runMigrations(db, MIGRATIONS_DIR)).not.toThrow();

    const count = (
      db
        .prepare("SELECT COUNT(*) as cnt FROM schema_migrations")
        .get() as { cnt: number }
    ).cnt;
    expect(count).toBe(3);
    db.close();
  });

  it("records the correct version in schema_migrations", () => {
    const db = createTestDb();
    runMigrations(db, MIGRATIONS_DIR);
    const rows = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as { version: number }[];
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
    db.close();
  });
});

describe("runMigrations — integration: schema validation", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db, MIGRATIONS_DIR);
  });

  it("creates all expected domain tables", () => {
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toContain("teachers");
    expect(tables).toContain("students");
    expect(tables).toContain("guardians");
    expect(tables).toContain("student_guardians");
    expect(tables).toContain("dispatched_messages");
    expect(tables).toContain("delivery_events");
    expect(tables).toContain("acknowledgements");
    expect(tables).toContain("inbound_messages");
    expect(tables).toContain("schema_migrations");
  });

  it("creates all expected indexes", () => {
    const indexes = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(indexes).toContain("idx_students_teacher");
    expect(indexes).toContain("idx_students_external");
    expect(indexes).toContain("idx_guardians_teacher");
    expect(indexes).toContain("idx_guardians_phone");
    expect(indexes).toContain("idx_dispatched_teacher");
    expect(indexes).toContain("idx_dispatched_broadcast");
    expect(indexes).toContain("idx_dispatched_provider");
    expect(indexes).toContain("idx_delivery_msg");
    expect(indexes).toContain("idx_inbound_teacher");
    expect(indexes).toContain("idx_teachers_external");
  });

  it("sets PRAGMA user_version to the migration count after boot", () => {
    const userVersion = db.pragma("user_version", { simple: true }) as number;
    expect(userVersion).toBe(3);
  });
});
