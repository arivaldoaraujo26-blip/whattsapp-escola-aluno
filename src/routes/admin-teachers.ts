import type { FastifyPluginAsync } from "fastify";
import type Database from "better-sqlite3";
import { timingSafeEqual } from "crypto";
import { provisionTeacher } from "../domain/teacher-provisioner.js";

interface PluginOptions {
  getDb: () => Database.Database;
}

function checkAdminToken(provided: string): boolean {
  const expected = process.env["ADMIN_TOKEN"] ?? "";
  if (!expected || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export const adminTeachersPlugin: FastifyPluginAsync<PluginOptions> = async (
  app,
  opts,
) => {
  app.post("/admin/teachers", async (request, reply) => {
    const authHeader =
      (request.headers["authorization"] as string | undefined) ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!checkAdminToken(token)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const body = request.body as
      | { name?: string; phoneE164?: string; externalRef?: string }
      | null
      | undefined;

    if (!body?.name || !body?.phoneE164) {
      return reply.code(400).send({ error: "name and phoneE164 are required" });
    }

    const db = opts.getDb();

    try {
      const result = await provisionTeacher(db, {
        name: body.name,
        phoneE164: body.phoneE164,
        externalRef: body.externalRef ?? null,
      });
      return reply.code(201).send(result);
    } catch (err) {
      request.log.error({ err }, "Teacher provisioning failed");
      const code = (err as { code?: string }).code;
      const msg = (err as { message?: string }).message ?? "";
      if (code === "SQLITE_CONSTRAINT_UNIQUE") {
        if (msg.includes("phone_e164")) {
          return reply.code(409).send({ error: "A teacher with this phone number already exists" });
        }
        return reply.code(409).send({ error: "A teacher with this externalRef already exists" });
      }
      return reply.code(500).send({ error: "Failed to provision teacher" });
    }
  });
};
