import { describe, it, expect } from "vitest";
import { parseCommand } from "./command-parser.js";

describe("parseCommand", () => {
  // ─── /ajuda ─────────────────────────────────────────────────────────────

  it("/ajuda (exact) classifies as { kind: 'ajuda' }", () => {
    expect(parseCommand("/ajuda")).toEqual({ kind: "ajuda" });
  });

  it("/AJUDA (uppercase) classifies as { kind: 'ajuda' }", () => {
    expect(parseCommand("/AJUDA")).toEqual({ kind: "ajuda" });
  });

  // ─── /status ────────────────────────────────────────────────────────────

  it("/status alone classifies as { kind: 'status', target: 'latest' }", () => {
    expect(parseCommand("/status")).toEqual({ kind: "status", target: "latest" });
  });

  it("/status último classifies as { kind: 'status', target: 'latest' }", () => {
    expect(parseCommand("/status último")).toEqual({
      kind: "status",
      target: "latest",
    });
  });

  it("/status m_abc123 classifies as { kind: 'status', target: 'm_abc123' }", () => {
    expect(parseCommand("/status m_abc123")).toEqual({
      kind: "status",
      target: "m_abc123",
    });
  });

  // ─── /revisar ───────────────────────────────────────────────────────────

  it("/revisar <text> classifies as { kind: 'revisar', draft: text }", () => {
    expect(parseCommand("/revisar Olá mãe, o João...")).toEqual({
      kind: "revisar",
      draft: "Olá mãe, o João...",
    });
  });

  // ─── broadcast ──────────────────────────────────────────────────────────

  it("'Para todos os pais do 5A: amanhã é facultativo' classifies as broadcast with classId 5A", () => {
    expect(
      parseCommand("Para todos os pais do 5A: amanhã é facultativo"),
    ).toEqual({
      kind: "broadcast",
      classId: "5A",
      content: "amanhã é facultativo",
    });
  });

  it("'Para o 5a:' (lowercase) classifies as broadcast", () => {
    const result = parseCommand("Para o 5a:");
    expect(result.kind).toBe("broadcast");
    if (result.kind === "broadcast") {
      expect(result.classId).toBe("5A");
    }
  });

  it("'Para todos: aviso geral' classifies as broadcast with classId '*'", () => {
    expect(parseCommand("Para todos: aviso geral")).toEqual({
      kind: "broadcast",
      classId: "*",
      content: "aviso geral",
    });
  });

  // ─── dispatch ───────────────────────────────────────────────────────────

  it("free-form text classifies as { kind: 'dispatch', text: ... }", () => {
    const text = "Avisar a mãe do João que a reunião foi adiada";
    expect(parseCommand(text)).toEqual({ kind: "dispatch", text });
  });

  it("empty string classifies as { kind: 'dispatch', text: '' }", () => {
    expect(parseCommand("")).toEqual({ kind: "dispatch", text: "" });
  });

  // ─── unknown ────────────────────────────────────────────────────────────

  it("/desconhecido (unknown slash command) classifies as { kind: 'unknown' }", () => {
    expect(parseCommand("/desconhecido")).toEqual({ kind: "unknown" });
  });
});
