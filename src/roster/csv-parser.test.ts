import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv-parser.js";

const HEADER =
  "teacher_external_id,student_external_id,student_name,class_id,guardian_name,guardian_role,guardian_phone_e164";

function makeRow(overrides: Partial<Record<string, string>> = {}): string {
  const defaults: Record<string, string> = {
    teacher_external_id: "prof_silva",
    student_external_id: "2026_5a_001",
    student_name: "João Silva",
    class_id: "5A",
    guardian_name: "Maria Silva",
    guardian_role: "mae",
    guardian_phone_e164: "+5511999998888",
  };
  const row = { ...defaults, ...overrides };
  return [
    row["teacher_external_id"],
    row["student_external_id"],
    row["student_name"],
    row["class_id"],
    row["guardian_name"],
    row["guardian_role"],
    row["guardian_phone_e164"],
  ].join(",");
}

describe("parseCsv", () => {
  it("parses a valid CSV with two students and multiple guardians without errors", () => {
    const csv = [
      HEADER,
      makeRow({ student_external_id: "s001", guardian_name: "Maria", guardian_phone_e164: "+5511999998888" }),
      makeRow({ student_external_id: "s001", guardian_name: "Carlos", guardian_phone_e164: "+5511988887777", guardian_role: "pai" }),
      makeRow({ student_external_id: "s002", guardian_name: "Ana", guardian_phone_e164: "+5511977776666" }),
    ].join("\n");

    const { rows, errors } = parseCsv(Buffer.from(csv));
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.studentExternalId).toBe("s001");
    expect(rows[1]?.guardianName).toBe("Carlos");
    expect(rows[2]?.studentExternalId).toBe("s002");
  });

  it("returns an error with the correct line number when guardian_phone_e164 column is missing from header", () => {
    const badHeader = "teacher_external_id,student_external_id,student_name,class_id,guardian_name,guardian_role";
    const csv = [badHeader, makeRow()].join("\n");

    const { rows, errors } = parseCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(1);
    expect(errors[0]?.message).toContain("guardian_phone_e164");
  });

  it("returns a validation error with the correct line number for a malformed E.164 phone number", () => {
    const csv = [
      HEADER,
      makeRow({ guardian_phone_e164: "5511999998888" }), // missing leading +
    ].join("\n");

    const { rows, errors } = parseCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(2);
    expect(errors[0]?.message).toContain("5511999998888");
    expect(errors[0]?.message).toContain("2"); // line number mentioned
  });

  it("rejects phone number with letters as invalid E.164", () => {
    const csv = [HEADER, makeRow({ guardian_phone_e164: "+551199999AAAA" })].join("\n");
    const { errors } = parseCsv(csv);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(2);
  });

  it("rejects phone number that is too short to be E.164", () => {
    const csv = [HEADER, makeRow({ guardian_phone_e164: "+123456" })].join("\n");
    const { errors } = parseCsv(csv);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(2);
  });

  it("accepts valid E.164 numbers with different country codes", () => {
    const csv = [
      HEADER,
      makeRow({ guardian_phone_e164: "+14155550123" }), // US
      makeRow({ student_external_id: "s002", guardian_phone_e164: "+5511999998888" }), // BR
      makeRow({ student_external_id: "s003", guardian_phone_e164: "+4407911123456" }), // UK
    ].join("\n");
    const { rows, errors } = parseCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(3);
  });

  it("returns an error for each row with a missing required field", () => {
    const csv = [
      HEADER,
      makeRow({ guardian_phone_e164: "" }), // missing phone — line 2
      makeRow({ guardian_name: "" }),        // missing name — line 3
    ].join("\n");

    const { rows, errors } = parseCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors[0]?.line).toBe(2);
    expect(errors[0]?.message).toContain("guardian_phone_e164");
    expect(errors[1]?.line).toBe(3);
    expect(errors[1]?.message).toContain("guardian_name");
  });

  it("returns an error indicating the file is empty when CSV has only a header row", () => {
    const csv = HEADER;
    const { rows, errors } = parseCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/no data rows/i);
  });

  it("returns an error when CSV is completely empty", () => {
    const { rows, errors } = parseCsv("");
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(1);
    expect(errors[0]?.message).toMatch(/empty/i);
  });

  it("skips blank lines between data rows", () => {
    const csv = [HEADER, "", makeRow(), "", makeRow({ student_external_id: "s002" }), ""].join("\n");
    const { rows, errors } = parseCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
  });

  it("handles CRLF line endings", () => {
    const csv = [HEADER, makeRow()].join("\r\n");
    const { rows, errors } = parseCsv(Buffer.from(csv));
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it("handles duplicate student_external_id rows within the same upload without error", () => {
    // The parser does not deduplicate — each row is independently valid
    const csv = [
      HEADER,
      makeRow({ guardian_name: "Maria", guardian_phone_e164: "+5511999998888" }),
      makeRow({ guardian_name: "Carlos", guardian_phone_e164: "+5511988887777", guardian_role: "pai" }),
    ].join("\n");
    const { rows, errors } = parseCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    // Both rows share the same student_external_id — importer handles DB dedup
    expect(rows[0]?.studentExternalId).toBe(rows[1]?.studentExternalId);
  });

  it("reports missing teacher_external_id with the correct line number", () => {
    const csv = [HEADER, makeRow({ teacher_external_id: "" })].join("\n");
    const { errors } = parseCsv(csv);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(2);
    expect(errors[0]?.message).toContain("teacher_external_id");
  });

  it("reports multiple missing columns in the header at line 1", () => {
    const csv = "id,name\nval1,val2";
    const { errors } = parseCsv(csv);
    expect(errors.length).toBeGreaterThan(1);
    errors.forEach((e) => expect(e.line).toBe(1));
  });

  it("includes line number in the row object", () => {
    const csv = [HEADER, makeRow(), makeRow({ student_external_id: "s002" })].join("\n");
    const { rows } = parseCsv(csv);
    expect(rows[0]?.line).toBe(2);
    expect(rows[1]?.line).toBe(3);
  });
});
