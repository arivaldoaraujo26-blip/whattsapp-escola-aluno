import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { insertTeacher } from "../db/repositories/teachers.js";

export interface ProvisionTeacherInput {
  name: string;
  phoneE164: string;
  externalRef?: string | null;
}

export interface ProvisionTeacherResult {
  teacherId: string;
  businessNumber: string;
}

export async function provisionTeacher(
  db: Database.Database,
  input: ProvisionTeacherInput,
): Promise<ProvisionTeacherResult> {
  const teacherId = randomUUID();
  insertTeacher(db, {
    id: teacherId,
    name: input.name,
    evolutionInstance: `meta-${teacherId}`,
    phoneE164: input.phoneE164,
    externalRef: input.externalRef ?? null,
  });
  const businessNumber = process.env["META_BUSINESS_NUMBER"] ?? "";
  return { teacherId, businessNumber };
}
