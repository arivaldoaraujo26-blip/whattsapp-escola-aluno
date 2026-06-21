import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";

const DEFAULT_DB_PATH = "./data/whatsapp-bot.sqlite";

export function openDb(filePath: string): Database.Database {
  if (filePath !== ":memory:") {
    const abs = resolve(filePath);
    mkdirSync(dirname(abs), { recursive: true });
    const db = new Database(abs);
    applyPragmas(db);
    return db;
  }
  const db = new Database(filePath);
  applyPragmas(db);
  return db;
}

function applyPragmas(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = openDb(process.env["DB_PATH"] ?? DEFAULT_DB_PATH);
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
