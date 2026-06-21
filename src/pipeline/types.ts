export type ParsedCommand =
  | { kind: "ajuda" }
  | { kind: "status"; target: string }
  | { kind: "revisar"; draft: string }
  | { kind: "broadcast"; classId: string; content: string }
  | { kind: "dispatch"; text: string }
  | { kind: "unknown" };
