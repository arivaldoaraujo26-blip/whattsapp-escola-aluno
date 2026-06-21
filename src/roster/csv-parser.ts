export interface CsvRow {
  line: number;
  teacherExternalId: string;
  studentExternalId: string;
  studentName: string;
  classId: string;
  guardianName: string;
  guardianRole: string;
  guardianPhoneE164: string;
}

export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  rows: CsvRow[];
  errors: ParseError[];
}

const REQUIRED_COLUMNS = [
  "teacher_external_id",
  "student_external_id",
  "student_name",
  "class_id",
  "guardian_name",
  "guardian_role",
  "guardian_phone_e164",
] as const;

// E.164: + followed by 7–15 digits, first digit non-zero
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export function parseCsv(input: Buffer | string): ParseResult {
  const text = typeof input === "string" ? input : input.toString("utf-8");
  const lines = text.split(/\r?\n/);
  const rows: CsvRow[] = [];
  const errors: ParseError[] = [];

  const headerRaw = lines[0]?.trim();
  if (!headerRaw) {
    errors.push({ line: 1, message: "CSV file is empty or missing header" });
    return { rows, errors };
  }

  const headers = headerRaw.split(",").map((h) => h.trim());

  for (const col of REQUIRED_COLUMNS) {
    if (!headers.includes(col)) {
      errors.push({ line: 1, message: `Missing required column: ${col}` });
    }
  }
  if (errors.length > 0) return { rows, errors };

  const colIndex: Record<string, number> = {};
  for (const col of REQUIRED_COLUMNS) {
    colIndex[col] = headers.indexOf(col);
  }

  let hasDataRows = false;

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]?.trim();
    if (!raw) continue;
    hasDataRows = true;

    const lineNum = i + 1;
    const cells = raw.split(",");

    const get = (col: string): string => {
      const idx = colIndex[col];
      if (idx === undefined || idx < 0) return "";
      return (cells[idx] ?? "").trim();
    };

    const teacherExternalId = get("teacher_external_id");
    const studentExternalId = get("student_external_id");
    const studentName = get("student_name");
    const classId = get("class_id");
    const guardianName = get("guardian_name");
    const guardianRole = get("guardian_role");
    const guardianPhoneE164 = get("guardian_phone_e164");

    let rowHasError = false;

    if (!teacherExternalId) {
      errors.push({ line: lineNum, message: "teacher_external_id is required" });
      rowHasError = true;
    }
    if (!studentExternalId) {
      errors.push({ line: lineNum, message: "student_external_id is required" });
      rowHasError = true;
    }
    if (!studentName) {
      errors.push({ line: lineNum, message: "student_name is required" });
      rowHasError = true;
    }
    if (!guardianName) {
      errors.push({ line: lineNum, message: "guardian_name is required" });
      rowHasError = true;
    }
    if (!guardianRole) {
      errors.push({ line: lineNum, message: "guardian_role is required" });
      rowHasError = true;
    }
    if (!guardianPhoneE164) {
      errors.push({ line: lineNum, message: "guardian_phone_e164 is required" });
      rowHasError = true;
    } else if (!E164_REGEX.test(guardianPhoneE164)) {
      errors.push({
        line: lineNum,
        message: `guardian_phone_e164 "${guardianPhoneE164}" is not a valid E.164 number at line ${lineNum}`,
      });
      rowHasError = true;
    }

    if (!rowHasError) {
      rows.push({
        line: lineNum,
        teacherExternalId,
        studentExternalId,
        studentName,
        classId,
        guardianName,
        guardianRole,
        guardianPhoneE164,
      });
    }
  }

  if (!hasDataRows) {
    errors.push({ line: 2, message: "CSV has no data rows" });
  }

  return { rows, errors };
}
