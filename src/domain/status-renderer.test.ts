import { describe, it, expect } from "vitest";
import { renderStatus } from "./status-renderer.js";
import type { StatusQueryResult } from "./status-query.js";

function makeResult(
  lines: Array<{ guardianName: string; hasRead: boolean; hasAcknowledged: boolean }>,
): StatusQueryResult {
  return { lines };
}

describe("renderStatus", () => {
  it("✅ for read + acknowledged", () => {
    const result = makeResult([
      { guardianName: "Maria Silva", hasRead: true, hasAcknowledged: true },
    ]);
    expect(renderStatus(result)).toBe("✅ Maria Silva — lida e confirmada");
  });

  it("👀 for read without acknowledgement", () => {
    const result = makeResult([
      { guardianName: "Carlos Costa", hasRead: true, hasAcknowledged: false },
    ]);
    expect(renderStatus(result)).toBe("👀 Carlos Costa — lida, sem confirmação");
  });

  it("⏳ for not read (pending)", () => {
    const result = makeResult([
      { guardianName: "João Souza", hasRead: false, hasAcknowledged: false },
    ]);
    expect(renderStatus(result)).toBe("⏳ João Souza — pendente");
  });

  it("⏳ for DELIVERY_ACK only (hasRead=false)", () => {
    const result = makeResult([
      { guardianName: "Ana Lima", hasRead: false, hasAcknowledged: false },
    ]);
    expect(renderStatus(result)).toBe("⏳ Ana Lima — pendente");
  });

  it("renders multiple lines with correct symbols", () => {
    const result = makeResult([
      { guardianName: "Maria", hasRead: true, hasAcknowledged: true },
      { guardianName: "Carlos", hasRead: true, hasAcknowledged: false },
      { guardianName: "João", hasRead: false, hasAcknowledged: false },
    ]);
    const rendered = renderStatus(result);
    const lines = rendered.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("✅ Maria — lida e confirmada");
    expect(lines[1]).toBe("👀 Carlos — lida, sem confirmação");
    expect(lines[2]).toBe("⏳ João — pendente");
  });

  it("returns empty string for empty lines array", () => {
    expect(renderStatus(makeResult([]))).toBe("");
  });
});
