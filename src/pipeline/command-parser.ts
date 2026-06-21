import type { ParsedCommand } from "./types.js";

export const HELP_TEXT = [
  "Comandos disponíveis:",
  "/ajuda — exibe este texto",
  "/status — status do último envio",
  "/status <id> — status de um envio específico",
  "/revisar <texto> — reescreve um texto com IA",
  "Para o <turma>: <mensagem> — avisa uma turma",
  "Para todos: <mensagem> — avisa todas as turmas",
  "(qualquer outro texto) — envia mensagem a um responsável",
].join("\n");

function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();
  const normLower = normalizeForMatch(trimmed);

  if (trimmed.startsWith("/")) {
    if (normLower === "/ajuda") return { kind: "ajuda" };

    if (normLower === "/status" || normLower === "/status ultimo") {
      return { kind: "status", target: "latest" };
    }

    if (normLower.startsWith("/status ")) {
      const target = trimmed.slice("/status ".length).trim();
      return { kind: "status", target };
    }

    if (normLower.startsWith("/revisar ")) {
      const draft = trimmed.slice("/revisar ".length);
      return { kind: "revisar", draft };
    }

    return { kind: "unknown" };
  }

  // Broadcast: split on first colon to separate prefix from content
  const colonIdx = trimmed.indexOf(":");
  const prefix = colonIdx >= 0 ? trimmed.slice(0, colonIdx) : trimmed;
  const content = colonIdx >= 0 ? trimmed.slice(colonIdx + 1).trim() : "";
  const normPrefix = normalizeForMatch(prefix);

  // "Para o <classId>[: content]"
  const paraOMatch = /^para o\s+(\S+)$/.exec(normPrefix);
  if (paraOMatch) {
    return { kind: "broadcast", classId: paraOMatch[1]!.toUpperCase(), content };
  }

  // "Para todos ... do <classId>[: content]"
  const paraTodosDoMatch = /^para todos\b.*?\bdo\s+(\S+)$/.exec(normPrefix);
  if (paraTodosDoMatch) {
    return {
      kind: "broadcast",
      classId: paraTodosDoMatch[1]!.toUpperCase(),
      content,
    };
  }

  // "Para todos[: content]" — broadcast to all classes
  if (/^para todos\b/.test(normPrefix)) {
    return { kind: "broadcast", classId: "*", content };
  }

  return { kind: "dispatch", text: trimmed };
}
