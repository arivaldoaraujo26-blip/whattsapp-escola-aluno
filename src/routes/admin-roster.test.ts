import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { FastifyInstance } from "fastify";
import { openDb } from "../db/database.js";
import { runMigrations } from "../db/migrate.js";
import { insertTeacher } from "../db/repositories/teachers.js";
import { listStudentsByTeacher } from "../db/repositories/students.js";
import { listGuardiansByTeacher } from "../db/repositories/guardians.js";
import { listGuardiansForStudent } from "../db/repositories/student-guardians.js";
import { findStudentByExternalRef } from "../db/repositories/students.js";
import { buildApp } from "../app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname_test = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname_test, "..", "..", "migrations");

const ADMIN_TOKEN = "test-admin-token-secret";
const HEADER =
  "teacher_external_id,student_external_id,student_name,class_id,guardian_name,guardian_role,guardian_phone_e164";

function makeMultipartBody(
  csvContent: string,
  boundary: string,
  fieldname = "roster",
): Buffer {
  return Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldname}"; filename="roster.csv"\r\n` +
      `Content-Type: text/csv\r\n` +
      `\r\n` +
      csvContent +
      `\r\n` +
      `--${boundary}--\r\n`,
  );
}

function multipartHeaders(boundary: string, authToken: string) {
  return {
    authorization: `Bearer ${authToken}`,
    "content-type": `multipart/form-data; boundary=${boundary}`,
  };
}

describe("POST /admin/roster", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof openDb>;
  let teacherId: string;
  const boundary = "----TestBoundary123456";

  beforeAll(() => {
    process.env["ADMIN_TOKEN"] = ADMIN_TOKEN;
  });

  afterAll(() => {
    delete process.env["ADMIN_TOKEN"];
  });

  beforeEach(async () => {
    db = openDb(":memory:");
    runMigrations(db, MIGRATIONS_DIR);

    const teacher = insertTeacher(db, {
      name: "Prof. Silva",
      evolutionInstance: "inst-silva",
      phoneE164: "+5511999990001",
      externalRef: "prof_silva",
    });
    teacherId = teacher.id;

    app = buildApp({ db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("returns HTTP 401 when Authorization header is missing", async () => {
    const csv = [HEADER, "prof_silva,s001,João,5A,Maria,mae,+5511999998888"].join("\n");
    const body = makeMultipartBody(csv, boundary);

    const resp = await app.inject({
      method: "POST",
      url: "/admin/roster",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(resp.statusCode).toBe(401);
    expect(resp.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns HTTP 401 for an invalid admin token", async () => {
    const csv = [HEADER, "prof_silva,s001,João,5A,Maria,mae,+5511999998888"].join("\n");
    const body = makeMultipartBody(csv, boundary);

    const resp = await app.inject({
      method: "POST",
      url: "/admin/roster",
      headers: multipartHeaders(boundary, "wrong-token"),
      payload: body,
    });

    expect(resp.statusCode).toBe(401);
  });

  it("uploads a 3-student CSV and creates students and guardians in the DB", async () => {
    const csv = [
      HEADER,
      "prof_silva,s001,João Silva,5A,Maria Silva,mae,+5511999998880",
      "prof_silva,s001,João Silva,5A,Carlos Silva,pai,+5511988887770",
      "prof_silva,s002,Ana Lima,5A,Patricia Lima,mae,+5511977776660",
      "prof_silva,s003,Pedro Costa,5B,Lucia Costa,mae,+5511966665550",
    ].join("\n");

    const body = makeMultipartBody(csv, boundary);
    const resp = await app.inject({
      method: "POST",
      url: "/admin/roster",
      headers: multipartHeaders(boundary, ADMIN_TOKEN),
      payload: body,
    });

    expect(resp.statusCode).toBe(200);
    const json = resp.json() as {
      studentsAdded: number;
      guardiansAdded: number;
      rowErrors: unknown[];
    };
    expect(json.studentsAdded).toBe(3);
    expect(json.guardiansAdded).toBe(4);
    expect(json.rowErrors).toHaveLength(0);

    const students = listStudentsByTeacher(db, teacherId);
    expect(students).toHaveLength(3);

    const guardians = listGuardiansByTeacher(db, teacherId);
    expect(guardians).toHaveLength(4);
    expect(guardians.every((g) => g.isActive === 1)).toBe(true);
  });

  it("re-upload with changed guardian phone updates the record and deactivates the old guardian", async () => {
    // First upload: João has guardian Maria with old phone
    const csv1 = [
      HEADER,
      "prof_silva,s001,João Silva,5A,Maria Silva,mae,+5511999998880",
    ].join("\n");
    await app.inject({
      method: "POST",
      url: "/admin/roster",
      headers: multipartHeaders(boundary, ADMIN_TOKEN),
      payload: makeMultipartBody(csv1, boundary),
    });

    // Verify initial state
    const student = findStudentByExternalRef(db, teacherId, "s001");
    expect(student).toBeDefined();
    const guardiansBefore = listGuardiansForStudent(db, teacherId, student!.id);
    expect(guardiansBefore).toHaveLength(1);
    expect(guardiansBefore[0]?.phoneE164).toBe("+5511999998880");
    const oldGuardianId = guardiansBefore[0]!.id;

    // Second upload: Maria's phone changed (different phone = different guardian record)
    // Old guardian gets deactivated; new one added
    const csv2 = [
      HEADER,
      "prof_silva,s001,João Silva,5A,Maria Silva,mae,+5511999998881",
    ].join("\n");
    const resp2 = await app.inject({
      method: "POST",
      url: "/admin/roster",
      headers: multipartHeaders(boundary, ADMIN_TOKEN),
      payload: makeMultipartBody(csv2, boundary),
    });

    expect(resp2.statusCode).toBe(200);
    const json2 = resp2.json() as {
      studentsUpdated: number;
      guardiansAdded: number;
      guardiansDeactivated: number;
    };
    expect(json2.studentsUpdated).toBe(1);
    expect(json2.guardiansAdded).toBe(1);
    expect(json2.guardiansDeactivated).toBe(1);

    // New guardian is active and linked
    const guardiansAfter = listGuardiansForStudent(db, teacherId, student!.id);
    expect(guardiansAfter).toHaveLength(1);
    expect(guardiansAfter[0]?.phoneE164).toBe("+5511999998881");
    expect(guardiansAfter[0]?.isActive).toBe(1);

    // Old guardian still exists in DB (for dispatch history) but is deactivated
    const allGuardians = listGuardiansByTeacher(db, teacherId);
    const oldGuardian = allGuardians.find((g) => g.id === oldGuardianId);
    expect(oldGuardian).toBeDefined();
    expect(oldGuardian?.isActive).toBe(0);
  });

  it("re-upload with same guardian updates the guardian name/role in-place preserving the ID", async () => {
    const csv1 = [
      HEADER,
      "prof_silva,s001,João Silva,5A,Maria Silva,mae,+5511999998880",
    ].join("\n");
    await app.inject({
      method: "POST",
      url: "/admin/roster",
      headers: multipartHeaders(boundary, ADMIN_TOKEN),
      payload: makeMultipartBody(csv1, boundary),
    });

    const student = findStudentByExternalRef(db, teacherId, "s001");
    const guardiansBefore = listGuardiansForStudent(db, teacherId, student!.id);
    const originalId = guardiansBefore[0]!.id;

    // Re-upload with name change but same phone
    const csv2 = [
      HEADER,
      "prof_silva,s001,João Silva,5A,Maria S. Updated,responsavel,+5511999998880",
    ].join("\n");
    const resp = await app.inject({
      method: "POST",
      url: "/admin/roster",
      headers: multipartHeaders(boundary, ADMIN_TOKEN),
      payload: makeMultipartBody(csv2, boundary),
    });

    expect(resp.statusCode).toBe(200);
    const json = resp.json() as { studentsUpdated: number; guardiansUpdated: number };
    expect(json.studentsUpdated).toBe(1);
    expect(json.guardiansUpdated).toBe(1);

    const guardiansAfter = listGuardiansForStudent(db, teacherId, student!.id);
    expect(guardiansAfter[0]?.id).toBe(originalId); // same ID preserved
    expect(guardiansAfter[0]?.name).toBe("Maria S. Updated");
    expect(guardiansAfter[0]?.role).toBe("responsavel");
  });

  it("returns rowErrors for CSV parse failures without aborting valid rows", async () => {
    const csv = [
      HEADER,
      "prof_silva,s001,João Silva,5A,Maria Silva,mae,not-e164", // bad phone — line 2
      "prof_silva,s002,Ana Lima,5A,Patricia Lima,mae,+5511977776660", // valid — line 3
    ].join("\n");

    const body = makeMultipartBody(csv, boundary);
    const resp = await app.inject({
      method: "POST",
      url: "/admin/roster",
      headers: multipartHeaders(boundary, ADMIN_TOKEN),
      payload: body,
    });

    expect(resp.statusCode).toBe(200);
    const json = resp.json() as {
      studentsAdded: number;
      rowErrors: Array<{ line: number; message: string }>;
    };
    expect(json.studentsAdded).toBe(1); // only the valid row
    expect(json.rowErrors).toHaveLength(1);
    expect(json.rowErrors[0]?.line).toBe(2);
  });

  it("returns rowErrors when teacher_external_id is not found in the DB", async () => {
    const csv = [
      HEADER,
      "unknown_teacher,s001,João Silva,5A,Maria Silva,mae,+5511999998880",
    ].join("\n");

    const resp = await app.inject({
      method: "POST",
      url: "/admin/roster",
      headers: multipartHeaders(boundary, ADMIN_TOKEN),
      payload: makeMultipartBody(csv, boundary),
    });

    expect(resp.statusCode).toBe(200);
    const json = resp.json() as {
      studentsAdded: number;
      rowErrors: Array<{ line: number; message: string }>;
    };
    expect(json.studentsAdded).toBe(0);
    expect(json.rowErrors).toHaveLength(1);
    expect(json.rowErrors[0]?.message).toContain("unknown_teacher");
  });

  it("filters by teacher_external_id query param when provided", async () => {
    // Insert a second teacher
    insertTeacher(db, {
      name: "Prof. Costa",
      evolutionInstance: "inst-costa",
      phoneE164: "+5511999990002",
      externalRef: "prof_costa",
    });

    const csv = [
      HEADER,
      "prof_silva,s001,João Silva,5A,Maria Silva,mae,+5511999998880",
      "prof_costa,s001,Ana Lima,5A,Patricia Lima,mae,+5511977776660",
    ].join("\n");

    const resp = await app.inject({
      method: "POST",
      url: "/admin/roster?teacher_external_id=prof_silva",
      headers: multipartHeaders(boundary, ADMIN_TOKEN),
      payload: makeMultipartBody(csv, boundary),
    });

    expect(resp.statusCode).toBe(200);
    const json = resp.json() as { studentsAdded: number };
    expect(json.studentsAdded).toBe(1); // only prof_silva's student processed
  });

  it("returns 200 with empty counts and a rowError for header-only CSV", async () => {
    const csv = HEADER;
    const resp = await app.inject({
      method: "POST",
      url: "/admin/roster",
      headers: multipartHeaders(boundary, ADMIN_TOKEN),
      payload: makeMultipartBody(csv, boundary),
    });

    expect(resp.statusCode).toBe(200);
    const json = resp.json() as {
      studentsAdded: number;
      rowErrors: Array<{ message: string }>;
    };
    expect(json.studentsAdded).toBe(0);
    expect(json.rowErrors.length).toBeGreaterThan(0);
    expect(json.rowErrors[0]?.message).toMatch(/no data rows/i);
  });
});
