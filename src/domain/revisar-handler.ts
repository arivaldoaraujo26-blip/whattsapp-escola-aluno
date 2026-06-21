import type { LlmClient } from "../llm/llm-client.js";
import type { EvolutionClient } from "../transport/evolution-client.js";
import type { Dispatcher } from "./dispatcher.js";
import { DomainError } from "./errors.js";
import type { RevisarSessionStore } from "./revisar-session-store.js";
import type { Teacher } from "./types.js";

export const BUTTON_ORIGINAL_ID = "btn_original";
export const BUTTON_REVISADO_ID = "btn_revisado";

const FALLBACK_MESSAGE =
  "/revisar está temporariamente indisponível. Você pode enviar o texto original diretamente.";

export interface RevisarHandler {
  handle(teacher: Teacher, draft: string): Promise<void>;
  handleButtonReply(teacher: Teacher, selectedButtonId: string): Promise<void>;
}

export class DefaultRevisarHandler implements RevisarHandler {
  constructor(
    private readonly llmClient: LlmClient,
    private readonly evolutionClient: EvolutionClient,
    private readonly sessionStore: RevisarSessionStore,
    private readonly dispatcher: Dispatcher,
  ) {}

  async handle(teacher: Teacher, draft: string): Promise<void> {
    let rewritten: string;
    try {
      rewritten = await this.llmClient.rewrite(draft);
    } catch (err) {
      const isBudgetError =
        err instanceof DomainError && err.code === "llm_unavailable";
      void isBudgetError; // error type is only informational here
      await this.sendTeacherText(teacher, FALLBACK_MESSAGE);
      return;
    }

    this.sessionStore.set(teacher.id, { original: draft, rewritten });

    const body = [
      `*Original:* ${draft}`,
      "",
      `*Revisado:* ${rewritten}`,
      "",
      "Escolha qual versão enviar:",
    ].join("\n");

    try {
      await this.evolutionClient.sendInteractiveButtons(
        teacher.evolutionInstance,
        teacher.phoneE164,
        body,
        [
          { id: BUTTON_ORIGINAL_ID, label: "Enviar original" },
          { id: BUTTON_REVISADO_ID, label: "Enviar revisado" },
        ],
      );
    } catch {
      // Best-effort — button send failure does not propagate
    }
  }

  async handleButtonReply(
    teacher: Teacher,
    selectedButtonId: string,
  ): Promise<void> {
    const session = this.sessionStore.get(teacher.id);
    if (!session) return;

    this.sessionStore.delete(teacher.id);

    let chosenText: string;
    if (selectedButtonId === BUTTON_ORIGINAL_ID) {
      chosenText = session.original;
    } else if (selectedButtonId === BUTTON_REVISADO_ID) {
      chosenText = session.rewritten;
    } else {
      return;
    }

    await this.dispatcher.dispatch(teacher.id, chosenText);
  }

  private async sendTeacherText(teacher: Teacher, message: string): Promise<void> {
    try {
      await this.evolutionClient.sendText(
        teacher.evolutionInstance,
        teacher.phoneE164,
        message,
      );
    } catch {
      // Best-effort
    }
  }
}
