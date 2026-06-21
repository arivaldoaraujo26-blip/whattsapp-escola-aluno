import type { FastifyPluginAsync } from "fastify";
import type Database from "better-sqlite3";
import multipart from "@fastify/multipart";
import { timingSafeEqual } from "crypto";
import { parseCsv } from "../roster/csv-parser.js";
import { importRoster } from "../roster/roster-importer.js";

interface PluginOptions {
  getDb: () => Database.Database;
}

function checkAdminToken(provided: string): boolean {
  const expected = process.env["ADMIN_TOKEN"] ?? "";
  if (!expected || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export const adminRosterPlugin: FastifyPluginAsync<PluginOptions> = async (
  app,
  opts,
) => {
  await app.register(multipart);

  app.post("/admin/roster", async (request, reply) => {
    const authHeader =
      (request.headers["authorization"] as string | undefined) ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!checkAdminToken(token)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "Missing 'roster' file part" });
    }

    const buffer = await file.toBuffer();
    const query = request.query as Record<string, string | undefined>;
    const teacherFilter = query["teacher_external_id"];

    const { rows: csvRows, errors: parseErrors } = parseCsv(buffer);
    const db = opts.getDb();
    const importResult = importRoster(db, csvRows, teacherFilter);

    return reply.code(200).send({
      studentsAdded: importResult.studentsAdded,
      studentsUpdated: importResult.studentsUpdated,
      guardiansAdded: importResult.guardiansAdded,
      guardiansUpdated: importResult.guardiansUpdated,
      guardiansDeactivated: importResult.guardiansDeactivated,
      rowErrors: [...parseErrors, ...importResult.rowErrors],
    });
  });
};
