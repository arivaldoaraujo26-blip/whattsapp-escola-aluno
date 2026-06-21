export interface LlmClient {
  identify(input: IdentifyRequest): Promise<IdentifyResult>;
  rewrite(draft: string): Promise<string>;
}

export interface IdentifyRequest {
  text: string;
  roster: ReadonlyArray<{
    student_id: string;
    student_name: string;
    guardians: ReadonlyArray<{ guardian_id: string; name: string; role: string }>;
  }>;
}

export interface IdentifyResult {
  intent: "single" | "class" | "ambiguous" | "unknown";
  student_id?: string;
  guardian_id?: string;
  class_id?: string;
  content?: string;
  confidence: number;
  ambiguity_candidates?: Array<{ student_id: string; guardian_id: string; label: string }>;
}
