import type { StatusQueryResult } from "./status-query.js";

export function renderStatus(result: StatusQueryResult): string {
  return result.lines
    .map((line) => {
      if (line.hasRead && line.hasAcknowledged) {
        return `✅ ${line.guardianName} — lida e confirmada`;
      } else if (line.hasRead) {
        return `👀 ${line.guardianName} — lida, sem confirmação`;
      } else {
        return `⏳ ${line.guardianName} — pendente`;
      }
    })
    .join("\n");
}
