import type Database from "better-sqlite3";
import type { Teacher } from "../domain/types.js";
import type { EvolutionClient } from "../transport/evolution-client.js";
import { queryStatus } from "../domain/status-query.js";
import { renderStatus } from "../domain/status-renderer.js";

export async function handleStatusCommand(
  db: Database.Database,
  teacher: Teacher,
  evolutionClient: EvolutionClient,
  target: string,
): Promise<void> {
  const result = queryStatus(db, teacher.id, target);

  let message: string;
  if (!result || result.lines.length === 0) {
    message =
      target === "latest"
        ? "Nenhuma mensagem encontrada."
        : "Mensagem não encontrada.";
  } else {
    message = renderStatus(result);
  }

  try {
    await evolutionClient.sendText(teacher.evolutionInstance, teacher.phoneE164, message);
  } catch {
    // best-effort
  }
}
