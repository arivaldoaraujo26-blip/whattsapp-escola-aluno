import type Database from "better-sqlite3";
import type { Teacher } from "./types.js";
import type { EvolutionClient } from "../transport/evolution-client.js";
import { listStudentsByTeacher } from "../db/repositories/students.js";
import { markWelcomeSent } from "../db/repositories/teachers.js";
import { HELP_TEXT } from "../pipeline/command-parser.js";

export const TOS_DISCLOSURE =
  "⚠️ Atenção: esta integração usa sua conta pessoal do WhatsApp por meio de uma biblioteca não oficial. Seu número pode ser bloqueado sem aviso prévio. Ao usar este assistente, você assume esse risco.";

export function buildWelcomeMessage(studentCount: number): string {
  return [
    "✅ Seu assistente está conectado!",
    "",
    `Você tem *${studentCount}* aluno(s) cadastrado(s).`,
    "",
    HELP_TEXT,
    "",
    TOS_DISCLOSURE,
  ].join("\n");
}

export async function sendWelcomeIfNeeded(
  db: Database.Database,
  teacher: Teacher,
  evolutionClient: EvolutionClient,
): Promise<void> {
  if (teacher.welcomeSentAt !== null) return;

  const students = listStudentsByTeacher(db, teacher.id);
  const body = buildWelcomeMessage(students.length);

  await evolutionClient.sendText(teacher.evolutionInstance, teacher.phoneE164, body);
  markWelcomeSent(db, teacher.id);
}
