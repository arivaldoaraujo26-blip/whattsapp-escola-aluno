import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const DEFAULT_MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

export function runMigrations(
  db: Database.Database,
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedVersions = new Set<number>(
    (
      db.prepare("SELECT version FROM schema_migrations").all() as {
        version: number;
      }[]
    ).map((r) => r.version),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();

  const applyOne = db.transaction((sql: string, version: number) => {
    db.exec(sql);
    db
      .prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      )
      .run(version, new Date().toISOString());
  });

  for (const file of files) {
    const version = parseInt(file.split("_")[0] ?? "0", 10);
    if (appliedVersions.has(version)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    applyOne(sql, version);
  }

  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM schema_migrations")
    .get() as { cnt: number };
  db.pragma(`user_version = ${row.cnt}`);
}
