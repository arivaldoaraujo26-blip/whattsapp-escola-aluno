import { describe, it, expect, vi, beforeEach } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { openDb } from "../db/database.js";
import { runMigrations } from "../db/migrate.js";
import { insertTeacher } from "../db/repositories/teachers.js";
import { insertStudent } from "../db/repositories/students.js";
import { insertGuardian } from "../db/repositories/guardians.js";
import { linkStudentGuardian } from "../db/repositories/student-guardians.js";
import { listDispatchedMessagesByTeacher } from "../db/repositories/dispatched-messages.js";
import type { EvolutionClient } from "../transport/evolution-client.js";
import { DefaultBroadcastDispatcher } from "./broadcast-dispatcher.js";
import { IntervalRateLimiter, type RateLimiter } from "./rate-limiter.js";
import type Database from "better-sqlite3";
import type { Teacher, Guardian } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = join(dirname(__filename), "..", "..", "migrations");

function makeDb(): Database.Database {
  const db = openDb(":memory:");
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

const noopRateLimiter: RateLimiter = { wait: () => Promise.resolve() };

function makeEvolution(providerMessageId = "prov-bc-001"): EvolutionClient {
  return {
    sendText: vi.fn().mockResolvedValue({ providerMessageId }),
    sendInteractiveButtons: vi.fn(),
  };
}

describe("DefaultBroadcastDispatcher", () => {
  let db: Database.Database;
  let teacher: Teacher;
  let guardians: Guardian[];

  beforeEach(() => {
    db = makeDb();
    teacher = insertTeacher(db, {
      name: "Prof. Lima",
      evolutionInstance: "teacher-bc",
      phoneE164: "+5511900000099",
    });

    // 3 students in class 5A, each with one guardian
    guardians = [];
    for (let i = 1; i <= 3; i++) {
      const student = insertStudent(db, teacher.id, { name: `Aluno ${i}`, classId: "5A" });
      const guardian = insertGuardian(db, teacher.id, {
        name: `Responsável ${i}`,
        phoneE164: `+551190000000${i}`,
        role: "mae",
      });
      linkStudentGuardian(db, teacher.id, student.id, guardian.id);
      guardians.push(guardian);
    }
  });

  // ─── Fan-out creates rows sharing broadcast_group_id ──────────────────────

  it("broadcast to 3 guardians creates 3 dispatched_messages rows all sharing the same broadcast_group_id", async () => {
    const evolution = makeEvolution();
    const dispatcher = new DefaultBroadcastDispatcher(db, evolution, () => noopRateLimiter);

    const outcome = await dispatcher.broadcastDispatch(teacher.id, "5A", "Reunião na sexta");

    expect(outcome.kind).toBe("broadcast");
    if (outcome.kind !== "broadcast") throw new Error("assertion");
    expect(outcome.classId).toBe("5A");
    expect(outcome.recipients).toBe(3);
    expect(outcome.messageIds).toHaveLength(3);

    const rows = listDispatchedMessagesByTeacher(db, teacher.id);
    expect(rows).toHaveLength(3);

    const groupIds = new Set(rows.map((r) => r.broadcastGroupId));
    expect(groupIds.size).toBe(1);
    const broadcastGroupId = [...groupIds][0];
    expect(broadcastGroupId).toMatch(/^bg_[0-9a-f]{8}$/);

    // All rows share the same broadcastGroupId
    for (const row of rows) {
      expect(row.broadcastGroupId).toBe(broadcastGroupId);
      expect(row.status).toBe("sent");
    }
  });

  // ─── class_id not in teacher's roster ─────────────────────────────────────

  it("broadcast to a class_id not in the teacher's roster returns rejected", async () => {
    const evolution = makeEvolution();
    const dispatcher = new DefaultBroadcastDispatcher(db, evolution, () => noopRateLimiter);

    const outcome = await dispatcher.broadcastDispatch(teacher.id, "9Z", "Aviso");

    expect(outcome.kind).toBe("rejected");
    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);

    // Teacher receives an error message
    const sendText = evolution.sendText as ReturnType<typeof vi.fn>;
    const teacherCalls = sendText.mock.calls.filter((args) => args[1] === teacher.phoneE164);
    expect(teacherCalls).toHaveLength(1);
  });

  // ─── Empty class rejects ───────────────────────────────────────────────────

  it("broadcast to a class with 0 guardians returns rejected", async () => {
    // Add a student with no guardian in class 6C
    insertStudent(db, teacher.id, { name: "Sem responsável", classId: "6C" });

    const evolution = makeEvolution();
    const dispatcher = new DefaultBroadcastDispatcher(db, evolution, () => noopRateLimiter);

    const outcome = await dispatcher.broadcastDispatch(teacher.id, "6C", "Aviso");

    expect(outcome.kind).toBe("rejected");
    expect(listDispatchedMessagesByTeacher(db, teacher.id)).toHaveLength(0);
  });

  // ─── ADR-006 suffix appended to every broadcast message ──────────────────

  it("each broadcast message body ends with '\\n\\nResponda 1 para confirmar.'", async () => {
    const evolution = makeEvolution();
    const dispatcher = new DefaultBroadcastDispatcher(db, evolution, () => noopRateLimiter);

    await dispatcher.broadcastDispatch(teacher.id, "5A", "Reunião cancelada");

    const sendText = evolution.sendText as ReturnType<typeof vi.fn>;
    // Filter out teacher confirmation call
    const guardianCalls = sendText.mock.calls.filter(
      (args) => args[1] !== teacher.phoneE164,
    );
    expect(guardianCalls).toHaveLength(3);
    for (const call of guardianCalls) {
      expect(call[2]).toMatch(/\n\nResponda 1 para confirmar\.$/);
    }

    // Also check persisted body_text
    const rows = listDispatchedMessagesByTeacher(db, teacher.id);
    for (const row of rows) {
      expect(row.bodyText).toMatch(/\n\nResponda 1 para confirmar\.$/);
    }
  });

  // ─── Teacher receives summary confirmation ─────────────────────────────────

  it("teacher receives a summary confirmation after all sends", async () => {
    const evolution = makeEvolution();
    const dispatcher = new DefaultBroadcastDispatcher(db, evolution, () => noopRateLimiter);

    await dispatcher.broadcastDispatch(teacher.id, "5A", "Evento amanhã");

    const sendText = evolution.sendText as ReturnType<typeof vi.fn>;
    const teacherCalls = sendText.mock.calls.filter((args) => args[1] === teacher.phoneE164);
    expect(teacherCalls).toHaveLength(1);
    const msg = teacherCalls[0]![2] as string;
    expect(msg).toContain("3 responsáveis");
    expect(msg).toContain("5A");
    expect(msg).toMatch(/#bg_[0-9a-f]{8}/);
  });

  // ─── Rate limiter called once per guardian ────────────────────────────────

  it("rate limiter wait() is called once per guardian send", async () => {
    const mockLimiter: RateLimiter = { wait: vi.fn().mockResolvedValue(undefined) };
    const evolution = makeEvolution();
    const dispatcher = new DefaultBroadcastDispatcher(db, evolution, () => mockLimiter);

    await dispatcher.broadcastDispatch(teacher.id, "5A", "Aviso");

    expect(mockLimiter.wait).toHaveBeenCalledTimes(3);
  });

  // ─── Per-teacher rate limiter isolation ───────────────────────────────────

  it("two teachers with the same class_id receive independent rate limiters", async () => {
    const createdForTeacher: string[] = [];
    const teacher2 = insertTeacher(db, {
      name: "Prof. Santos",
      evolutionInstance: "teacher-bc2",
      phoneE164: "+5511900000088",
    });
    const student2 = insertStudent(db, teacher2.id, { name: "Aluno T2", classId: "5A" });
    const guardian2 = insertGuardian(db, teacher2.id, {
      name: "Resp T2",
      phoneE164: "+5511900000087",
      role: "pai",
    });
    linkStudentGuardian(db, teacher2.id, student2.id, guardian2.id);

    const evolution = makeEvolution();
    const dispatcher = new DefaultBroadcastDispatcher(db, evolution, (tid) => {
      createdForTeacher.push(tid);
      return noopRateLimiter;
    });

    await dispatcher.broadcastDispatch(teacher.id, "5A", "Aviso 1");
    await dispatcher.broadcastDispatch(teacher2.id, "5A", "Aviso 2");

    // Each teacher gets their own rate limiter (factory called once per teacher)
    expect(createdForTeacher).toContain(teacher.id);
    expect(createdForTeacher).toContain(teacher2.id);
    // Same limiter instance is reused for the same teacher on repeated calls
    const countForTeacher1 = createdForTeacher.filter((id) => id === teacher.id).length;
    expect(countForTeacher1).toBe(1);
  });

  // ─── Unknown teacher ───────────────────────────────────────────────────────

  it("unknown teacherId returns rejected without touching evolution", async () => {
    const evolution = makeEvolution();
    const dispatcher = new DefaultBroadcastDispatcher(db, evolution, () => noopRateLimiter);

    const outcome = await dispatcher.broadcastDispatch("non-existent-teacher", "5A", "Aviso");

    expect(outcome.kind).toBe("rejected");
    expect(evolution.sendText).not.toHaveBeenCalled();
  });

  // ─── Partial send failures ────────────────────────────────────────────────

  it("individual send failures mark those rows failed but still return broadcast outcome with successful ids", async () => {
    const sendText = vi
      .fn()
      .mockResolvedValueOnce({ providerMessageId: "prov-ok-1" })
      .mockRejectedValueOnce(new Error("Transport error"))
      .mockResolvedValue({ providerMessageId: "prov-ok-3" });
    const evolution: EvolutionClient = { sendText, sendInteractiveButtons: vi.fn() };
    const dispatcher = new DefaultBroadcastDispatcher(db, evolution, () => noopRateLimiter);

    const outcome = await dispatcher.broadcastDispatch(teacher.id, "5A", "Aviso");

    expect(outcome.kind).toBe("broadcast");
    if (outcome.kind !== "broadcast") throw new Error("assertion");
    expect(outcome.recipients).toBe(2);
    expect(outcome.messageIds).toHaveLength(2);

    const rows = listDispatchedMessagesByTeacher(db, teacher.id);
    const failed = rows.filter((r) => r.status === "failed");
    const sent = rows.filter((r) => r.status === "sent");
    expect(failed).toHaveLength(1);
    expect(sent).toHaveLength(2);
  });

  // ─── classId "*" broadcasts to all active guardians ──────────────────────

  it("classId '*' broadcasts to all active guardians across all classes", async () => {
    // Add a guardian in a different class
    const student4 = insertStudent(db, teacher.id, { name: "Aluno 4", classId: "3B" });
    const guardian4 = insertGuardian(db, teacher.id, {
      name: "Responsável 4",
      phoneE164: "+5511900000004",
      role: "pai",
    });
    linkStudentGuardian(db, teacher.id, student4.id, guardian4.id);

    const evolution = makeEvolution();
    const dispatcher = new DefaultBroadcastDispatcher(db, evolution, () => noopRateLimiter);

    const outcome = await dispatcher.broadcastDispatch(teacher.id, "*", "Aviso geral");

    expect(outcome.kind).toBe("broadcast");
    if (outcome.kind !== "broadcast") throw new Error("assertion");
    expect(outcome.recipients).toBe(4);
    expect(outcome.classId).toBe("*");
  });
});

// ─── IntervalRateLimiter unit tests ───────────────────────────────────────────

describe("IntervalRateLimiter", () => {
  it("first wait() returns immediately without scheduling a timer", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new IntervalRateLimiter(3000);
      let resolved = false;
      const p = limiter.wait().then(() => { resolved = true; });
      await Promise.resolve();
      await Promise.resolve();
      expect(resolved).toBe(true);
      await p;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rate limiter spaces sends 3000ms apart using fake timers", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new IntervalRateLimiter(3000);
      const timestamps: number[] = [];

      async function doThree() {
        for (let i = 0; i < 3; i++) {
          await limiter.wait();
          timestamps.push(Date.now());
        }
      }

      const p = doThree();
      await vi.runAllTimersAsync();
      await p;

      expect(timestamps).toHaveLength(3);
      expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(3000);
      expect(timestamps[2]! - timestamps[1]!).toBeGreaterThanOrEqual(3000);
    } finally {
      vi.useRealTimers();
    }
  });
});
