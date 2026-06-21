import {
  describe, it, expect, beforeEach, afterEach, beforeAll, afterAll,
} from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { FastifyInstance } from "fastify";
import { openDb } from "../db/database.js";
import { runMigrations } from "../db/migrate.js";
import { listTeachers } from "../db/repositories/teachers.js";
import { buildApp } from "../app.js";
import type Database from "better-sqlite3";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations",
);
const ADMIN_TOKEN = "test-admin-secret";

describe("POST /admin/teachers", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeAll(() => {
    process.env["ADMIN_TOKEN"] = ADMIN_TOKEN;
    process.env["META_BUSINESS_NUMBER"] = "+5511940000000";
  });

  afterAll(() => {
    delete process.env["ADMIN_TOKEN"];
    delete process.env["META_BUSINESS_NUMBER"];
  });

  beforeEach(async () => {
    db = openDb(":memory:");
    runMigrations(db, MIGRATIONS_DIR);
    app = buildApp({ db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("returns 201 with teacherId and businessNumber", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/teachers",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { name: "Prof. Silva", phoneE164: "+5511999991111" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ teacherId: string; businessNumber: string }>();
    expect(body.teacherId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.businessNumber).toBe("+5511940000000");
  });

  it("inserts teacher in DB", async () => {
    await app.inject({
      method: "POST",
      url: "/admin/teachers",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { name: "Prof. Ana", phoneE164: "+5511999992222" },
    });

    expect(listTeachers(db)).toHaveLength(1);
    expect(listTeachers(db)[0]?.name).toBe("Prof. Ana");
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/teachers",
      payload: { name: "X", phoneE164: "+5511000000000" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/teachers",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { phoneE164: "+5511000000000" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 409 when phone already exists", async () => {
    const payload = { name: "Prof. A", phoneE164: "+5511999993333" };
    await app.inject({
      method: "POST",
      url: "/admin/teachers",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload,
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/teachers",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { name: "Prof. B", phoneE164: "+5511999993333" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("phone number");
  });

  it("returns 409 when externalRef already exists", async () => {
    await app.inject({
      method: "POST",
      url: "/admin/teachers",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { name: "Prof. A", phoneE164: "+5511111111111", externalRef: "ref-dup" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/teachers",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { name: "Prof. B", phoneE164: "+5511222222222", externalRef: "ref-dup" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("externalRef");
  });
});
