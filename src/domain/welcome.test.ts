import { describe, it, expect, vi, beforeEach } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { openDb } from "../db/database.js";
import { runMigrations } from "../db/migrate.js";
import { insertTeacher, findTeacherById } from "../db/repositories/teachers.js";
import { insertStudent } from "../db/repositories/students.js";
import { buildWelcomeMessage, sendWelcomeIfNeeded, TOS_DISCLOSURE } from "./welcome.js";
import type Database from "better-sqlite3";
import type { Teacher } from "./types.js";
import type { EvolutionClient } from "../transport/evolution-client.js";

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = join(dirname(__filename), "..", "..", "migrations");

function makeEvolutionClient(): EvolutionClient & { sendText: ReturnType<typeof vi.fn> } {
  return {
    sendText: vi.fn().mockResolvedValue({ providerMessageId: "prov-001" }),
    sendInteractiveButtons: vi.fn(),
  };
}

describe("buildWelcomeMessage", () => {
  it("contains the student count", () => {
    const msg = buildWelcomeMessage(5);
    expect(msg).toContain("5");
  });

  it("contains the ToS disclosure phrase", () => {
    const msg = buildWelcomeMessage(0);
    expect(msg).toContain(TOS_DISCLOSURE);
  });

  it("contains the command list", () => {
    const msg = buildWelcomeMessage(3);
    expect(msg).toContain("/ajuda");
    expect(msg).toContain("/status");
    expect(msg).toContain("/revisar");
  });
});

describe("sendWelcomeIfNeeded", () => {
  let db: Database.Database;
  let teacher: Teacher;

  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db, MIGRATIONS_DIR);
    teacher = insertTeacher(db, {
      name: "Prof. Ana",
      evolutionInstance: "teacher-welcome-test",
      phoneE164: "+5511900000001",
    });
  });

  it("calls sendText when teacher has no welcome_sent_at", async () => {
    const client = makeEvolutionClient();
    await sendWelcomeIfNeeded(db, teacher, client);
    expect(client.sendText).toHaveBeenCalledOnce();
    const [instance, phone] = client.sendText.mock.calls[0] as [string, string, string];
    expect(instance).toBe(teacher.evolutionInstance);
    expect(phone).toBe(teacher.phoneE164);
  });

  it("updates welcome_sent_at in DB after sending", async () => {
    const client = makeEvolutionClient();
    await sendWelcomeIfNeeded(db, teacher, client);
    const updated = findTeacherById(db, teacher.id);
    expect(updated?.welcomeSentAt).not.toBeNull();
    expect(typeof updated?.welcomeSentAt).toBe("string");
  });

  it("does NOT call sendText when welcome_sent_at is already set", async () => {
    const client = makeEvolutionClient();
    // First call marks it sent
    await sendWelcomeIfNeeded(db, teacher, client);
    client.sendText.mockClear();

    // Reload teacher so welcomeSentAt is now set
    const updatedTeacher = findTeacherById(db, teacher.id)!;
    await sendWelcomeIfNeeded(db, updatedTeacher, client);
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it("includes the teacher's student count in the message body", async () => {
    insertStudent(db, teacher.id, { name: "João" });
    insertStudent(db, teacher.id, { name: "Maria" });

    const client = makeEvolutionClient();
    await sendWelcomeIfNeeded(db, teacher, client);

    const body = client.sendText.mock.calls[0]?.[2] as string;
    expect(body).toContain("2");
  });

  it("includes the ToS disclosure in the message body", async () => {
    const client = makeEvolutionClient();
    await sendWelcomeIfNeeded(db, teacher, client);

    const body = client.sendText.mock.calls[0]?.[2] as string;
    expect(body).toContain(TOS_DISCLOSURE);
  });

  it("does not update welcome_sent_at when sendText throws", async () => {
    const client = makeEvolutionClient();
    client.sendText.mockRejectedValue(new Error("network error"));

    await expect(sendWelcomeIfNeeded(db, teacher, client)).rejects.toThrow("network error");

    const unchanged = findTeacherById(db, teacher.id);
    expect(unchanged?.welcomeSentAt).toBeNull();
  });
});
