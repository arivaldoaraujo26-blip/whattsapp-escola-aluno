import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LlmClient } from "../llm/llm-client.js";
import type { EvolutionClient } from "../transport/evolution-client.js";
import type { Dispatcher, DispatchOutcome } from "./dispatcher.js";
import { DomainError } from "./errors.js";
import {
  DefaultRevisarHandler,
  BUTTON_ORIGINAL_ID,
  BUTTON_REVISADO_ID,
} from "./revisar-handler.js";
import { RevisarSessionStore } from "./revisar-session-store.js";
import type { Teacher } from "./types.js";

const TEACHER: Teacher = {
  id: "teacher-001",
  name: "Prof. Silva",
  evolutionInstance: "teacher-abc",
  phoneE164: "+5511999990000",
  externalRef: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  welcomeSentAt: null,
};

const DRAFT = "Aviso: reunião adiada";
const REWRITTEN = "Prezada família, a reunião foi adiada. Aguardamos confirmação.";

function makeLlmClient(rewritten = REWRITTEN): LlmClient {
  return {
    identify: vi.fn(),
    rewrite: vi.fn().mockResolvedValue(rewritten),
  };
}

function makeEvolutionClient(): EvolutionClient {
  return {
    sendText: vi.fn().mockResolvedValue({ providerMessageId: "prov-001" }),
    sendInteractiveButtons: vi.fn().mockResolvedValue({ providerMessageId: "prov-002" }),
  };
}

function makeDispatcher(outcome: DispatchOutcome = { kind: "sent", messageId: "m_001", guardianLabel: "Maria (mãe do João)" }): Dispatcher {
  return {
    dispatch: vi.fn().mockResolvedValue(outcome),
  };
}

function makeHandler(
  llm: LlmClient,
  evolution: EvolutionClient,
  store: RevisarSessionStore,
  dispatcher: Dispatcher,
): DefaultRevisarHandler {
  return new DefaultRevisarHandler(llm, evolution, store, dispatcher);
}

describe("DefaultRevisarHandler.handle", () => {
  let store: RevisarSessionStore;

  beforeEach(() => {
    store = new RevisarSessionStore();
  });

  it("calls LlmClient.rewrite with only the draft text — no roster fields present", async () => {
    const llm = makeLlmClient();
    const evolution = makeEvolutionClient();
    const dispatcher = makeDispatcher();
    const handler = makeHandler(llm, evolution, store, dispatcher);

    await handler.handle(TEACHER, DRAFT);

    expect(llm.rewrite).toHaveBeenCalledOnce();
    expect(llm.rewrite).toHaveBeenCalledWith(DRAFT);
    // Verify no second argument (no roster)
    const call = (llm.rewrite as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call).toHaveLength(1);
    expect(llm.identify).not.toHaveBeenCalled();
  });

  it("sends an interactive-buttons message with exactly two buttons labeled correctly", async () => {
    const llm = makeLlmClient();
    const evolution = makeEvolutionClient();
    const dispatcher = makeDispatcher();
    const handler = makeHandler(llm, evolution, store, dispatcher);

    await handler.handle(TEACHER, DRAFT);

    const sendButtons = evolution.sendInteractiveButtons as ReturnType<typeof vi.fn>;
    expect(sendButtons).toHaveBeenCalledOnce();

    const [instance, toE164, , buttons] = sendButtons.mock.calls[0]!;
    expect(instance).toBe(TEACHER.evolutionInstance);
    expect(toE164).toBe(TEACHER.phoneE164);
    expect(buttons).toHaveLength(2);
    expect((buttons as Array<{ id: string; label: string }>)[0]).toEqual({
      id: BUTTON_ORIGINAL_ID,
      label: "Enviar original",
    });
    expect((buttons as Array<{ id: string; label: string }>)[1]).toEqual({
      id: BUTTON_REVISADO_ID,
      label: "Enviar revisado",
    });
  });

  it("stores the session in the session store after a successful rewrite", async () => {
    const llm = makeLlmClient();
    const evolution = makeEvolutionClient();
    const dispatcher = makeDispatcher();
    const handler = makeHandler(llm, evolution, store, dispatcher);

    await handler.handle(TEACHER, DRAFT);

    const session = store.get(TEACHER.id);
    expect(session).toBeDefined();
    expect(session!.original).toBe(DRAFT);
    expect(session!.rewritten).toBe(REWRITTEN);
  });

  it("when LlmClient.rewrite throws DomainError(llm_unavailable) sends Portuguese fallback message without throwing", async () => {
    const llm: LlmClient = {
      identify: vi.fn(),
      rewrite: vi.fn().mockRejectedValue(
        new DomainError("llm_unavailable", "Gemini down"),
      ),
    };
    const evolution = makeEvolutionClient();
    const dispatcher = makeDispatcher();
    const handler = makeHandler(llm, evolution, store, dispatcher);

    await expect(handler.handle(TEACHER, DRAFT)).resolves.toBeUndefined();

    const sendText = evolution.sendText as ReturnType<typeof vi.fn>;
    expect(sendText).toHaveBeenCalledOnce();
    const msg = sendText.mock.calls[0]![2] as string;
    expect(msg).toBe(
      "/revisar está temporariamente indisponível. Você pode enviar o texto original diretamente.",
    );

    // No buttons were sent
    expect(evolution.sendInteractiveButtons).not.toHaveBeenCalled();
    // Session is not stored
    expect(store.get(TEACHER.id)).toBeUndefined();
  });

  it("when LlmClient.rewrite throws a non-DomainError also sends the fallback message", async () => {
    const llm: LlmClient = {
      identify: vi.fn(),
      rewrite: vi.fn().mockRejectedValue(new Error("network timeout")),
    };
    const evolution = makeEvolutionClient();
    const dispatcher = makeDispatcher();
    const handler = makeHandler(llm, evolution, store, dispatcher);

    await expect(handler.handle(TEACHER, DRAFT)).resolves.toBeUndefined();

    const sendText = evolution.sendText as ReturnType<typeof vi.fn>;
    expect(sendText).toHaveBeenCalledOnce();
    expect(sendText.mock.calls[0]![2]).toContain("/revisar está temporariamente indisponível");
    expect(evolution.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  it("does not dispatch the message automatically after sending buttons", async () => {
    const llm = makeLlmClient();
    const evolution = makeEvolutionClient();
    const dispatcher = makeDispatcher();
    const handler = makeHandler(llm, evolution, store, dispatcher);

    await handler.handle(TEACHER, DRAFT);

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
});

describe("DefaultRevisarHandler.handleButtonReply", () => {
  let store: RevisarSessionStore;

  beforeEach(() => {
    store = new RevisarSessionStore();
    store.set(TEACHER.id, { original: DRAFT, rewritten: REWRITTEN });
  });

  it("Enviar original dispatches the original draft text unmodified", async () => {
    const llm = makeLlmClient();
    const evolution = makeEvolutionClient();
    const dispatcher = makeDispatcher();
    const handler = makeHandler(llm, evolution, store, dispatcher);

    await handler.handleButtonReply(TEACHER, BUTTON_ORIGINAL_ID);

    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(TEACHER.id, DRAFT);
  });

  it("Enviar revisado dispatches the LLM-rewritten text", async () => {
    const llm = makeLlmClient();
    const evolution = makeEvolutionClient();
    const dispatcher = makeDispatcher();
    const handler = makeHandler(llm, evolution, store, dispatcher);

    await handler.handleButtonReply(TEACHER, BUTTON_REVISADO_ID);

    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(TEACHER.id, REWRITTEN);
  });

  it("clears the session from the store after button reply", async () => {
    const llm = makeLlmClient();
    const evolution = makeEvolutionClient();
    const dispatcher = makeDispatcher();
    const handler = makeHandler(llm, evolution, store, dispatcher);

    await handler.handleButtonReply(TEACHER, BUTTON_ORIGINAL_ID);

    expect(store.get(TEACHER.id)).toBeUndefined();
  });

  it("unknown button ID does not dispatch but does clear the session", async () => {
    const llm = makeLlmClient();
    const evolution = makeEvolutionClient();
    const dispatcher = makeDispatcher();
    const handler = makeHandler(llm, evolution, store, dispatcher);

    await handler.handleButtonReply(TEACHER, "btn_unknown");

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    // Session IS cleared (delete-then-return pattern)
    expect(store.get(TEACHER.id)).toBeUndefined();
  });

  it("no pending session — returns without dispatching", async () => {
    store.delete(TEACHER.id); // remove pre-set session
    const llm = makeLlmClient();
    const evolution = makeEvolutionClient();
    const dispatcher = makeDispatcher();
    const handler = makeHandler(llm, evolution, store, dispatcher);

    await handler.handleButtonReply(TEACHER, BUTTON_ORIGINAL_ID);

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
});
