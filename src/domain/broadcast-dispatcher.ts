import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { EvolutionClient } from "../transport/evolution-client.js";
import type { DispatchOutcome } from "./dispatcher.js";
import { IntervalRateLimiter, type RateLimiter } from "./rate-limiter.js";
import { findTeacherById } from "../db/repositories/teachers.js";
import { getGuardiansByClassId } from "../db/repositories/guardians.js";
import {
  insertDispatchedMessage,
  updateDispatchedMessageStatus,
} from "../db/repositories/dispatched-messages.js";

const BROADCAST_INTERVAL_MS = 3000;

export interface BroadcastDispatcher {
  broadcastDispatch(teacherId: string, classId: string, content: string): Promise<DispatchOutcome>;
}

export class DefaultBroadcastDispatcher implements BroadcastDispatcher {
  private readonly rateLimiters = new Map<string, RateLimiter>();

  constructor(
    private readonly db: Database.Database,
    private readonly evolutionClient: EvolutionClient,
    private readonly makeRateLimiter: (teacherId: string) => RateLimiter = () =>
      new IntervalRateLimiter(BROADCAST_INTERVAL_MS),
  ) {}

  private getRateLimiter(teacherId: string): RateLimiter {
    if (!this.rateLimiters.has(teacherId)) {
      this.rateLimiters.set(teacherId, this.makeRateLimiter(teacherId));
    }
    return this.rateLimiters.get(teacherId)!;
  }

  async broadcastDispatch(teacherId: string, classId: string, content: string): Promise<DispatchOutcome> {
    const teacher = findTeacherById(this.db, teacherId);
    if (!teacher) {
      return { kind: "rejected", reason: "Professor não encontrado." };
    }

    const guardians = getGuardiansByClassId(this.db, teacherId, classId);
    if (guardians.length === 0) {
      const reason =
        classId === "*"
          ? "Nenhum responsável encontrado."
          : `Turma ${classId} não encontrada ou sem responsáveis.`;
      void this.sendTeacherReply(teacher, reason);
      return { kind: "rejected", reason };
    }

    const broadcastGroupId = `bg_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const bodyText = `${content}\n\nResponda 1 para confirmar.`;
    const rateLimiter = this.getRateLimiter(teacherId);

    // Insert all pending rows before sending
    const rows = guardians.map((guardian) => {
      const messageId = `m_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
      insertDispatchedMessage(this.db, teacherId, {
        id: messageId,
        broadcastGroupId,
        studentId: null,
        guardianId: guardian.id,
        draftText: content,
        bodyText,
      });
      return { messageId, guardian };
    });

    const sentMessageIds: string[] = [];

    for (const { messageId, guardian } of rows) {
      await rateLimiter.wait();
      try {
        const result = await this.evolutionClient.sendText(
          teacher.evolutionInstance,
          guardian.phoneE164,
          bodyText,
        );
        updateDispatchedMessageStatus(this.db, teacherId, messageId, "sent", {
          providerMessageId: result.providerMessageId,
          sentAt: new Date().toISOString(),
        });
        sentMessageIds.push(messageId);
      } catch (err) {
        const failedReason = err instanceof Error ? err.message : String(err);
        updateDispatchedMessageStatus(this.db, teacherId, messageId, "failed", { failedReason });
      }
    }

    const classLabel = classId === "*" ? "todas as turmas" : classId;
    const summary = `Enviado para ${sentMessageIds.length} responsáveis do ${classLabel} — broadcast #${broadcastGroupId}`;
    void this.sendTeacherReply(teacher, summary);

    return {
      kind: "broadcast",
      messageIds: sentMessageIds,
      classId,
      recipients: sentMessageIds.length,
    };
  }

  private async sendTeacherReply(
    teacher: { evolutionInstance: string; phoneE164: string },
    message: string,
  ): Promise<void> {
    try {
      await this.evolutionClient.sendText(teacher.evolutionInstance, teacher.phoneE164, message);
    } catch {
      // Best-effort — teacher reply failures must not propagate
    }
  }
}
