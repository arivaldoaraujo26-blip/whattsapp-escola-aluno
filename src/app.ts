import type Database from "better-sqlite3";
import Fastify from "fastify";
import { getDb } from "./db/database.js";
import { runMigrations } from "./db/migrate.js";
import { adminRosterPlugin } from "./routes/admin-roster.js";
import { adminTeachersPlugin } from "./routes/admin-teachers.js";
import { webhookEvolutionPlugin } from "./routes/webhook-evolution.js";
import { webhookMetaPlugin } from "./routes/webhook-meta.js";
import type { EvolutionClient } from "./transport/evolution-client.js";
import { MetaCloudClient } from "./transport/meta-cloud-client.js";
import type { Dispatcher } from "./domain/dispatcher.js";
import { SingleDispatcher } from "./domain/dispatcher.js";
import type { BroadcastDispatcher } from "./domain/broadcast-dispatcher.js";
import { DefaultBroadcastDispatcher } from "./domain/broadcast-dispatcher.js";
import type { LlmClient } from "./llm/llm-client.js";
import { GeminiLlmClient } from "./llm/gemini-llm-client.js";
import { DefaultRevisarHandler } from "./domain/revisar-handler.js";
import { RevisarSessionStore } from "./domain/revisar-session-store.js";

export function buildApp(opts?: {
  db?: Database.Database;
  evolutionClient?: EvolutionClient;
  dispatcher?: Dispatcher;
  broadcastDispatcher?: BroadcastDispatcher;
  llmClient?: LlmClient;
  onInboundMessage?: (teacherId: string, messageId: string) => void | Promise<void>;
  onConnectionUpdate?: (teacherId: string, state: "open" | "close" | "connecting") => void | Promise<void>;
}) {
  const evolutionClient = opts?.evolutionClient ?? new MetaCloudClient();
  const llmClient = opts?.llmClient ?? new GeminiLlmClient();

  const app = Fastify({
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url,
            request_id: req.id,
          };
        },
      },
      base: {
        event_type: "http",
      },
    },
  });

  // db and dispatchers are initialized in onReady, guaranteed before any request handler runs
  let db!: Database.Database;
  let dispatcher!: Dispatcher;
  let broadcastDispatcher!: BroadcastDispatcher;

  app.addHook("onReady", async () => {
    db = opts?.db ?? getDb();
    runMigrations(db);
    dispatcher = opts?.dispatcher ?? new SingleDispatcher(db, llmClient, evolutionClient);
    broadcastDispatcher = opts?.broadcastDispatcher ?? new DefaultBroadcastDispatcher(db, evolutionClient);
  });

  app.get("/healthz", async () => {
    return { ok: true, db: "ok", evolution: "ok" };
  });

  app.register(adminRosterPlugin, { getDb: () => db });
  app.register(adminTeachersPlugin, {
    getDb: () => db,
  });

  const revisarHandler = new DefaultRevisarHandler(
    llmClient,
    evolutionClient,
    new RevisarSessionStore(),
    { dispatch: (...args) => dispatcher.dispatch(...args) },
  );

  app.register(webhookEvolutionPlugin, {
    getDb: () => db,
    evolutionClient,
    dispatcher: { dispatch: (...args) => dispatcher.dispatch(...args) },
    broadcastDispatcher: { broadcastDispatch: (...args) => broadcastDispatcher.broadcastDispatch(...args) },
    revisarHandler,
    onInboundMessage: opts?.onInboundMessage,
    onConnectionUpdate: opts?.onConnectionUpdate,
  });

  app.register(webhookMetaPlugin, {
    getDb: () => db,
    evolutionClient,
    dispatcher: { dispatch: (...args) => dispatcher.dispatch(...args) },
    broadcastDispatcher: { broadcastDispatch: (...args) => broadcastDispatcher.broadcastDispatch(...args) },
    revisarHandler,
  });

  return app;
}
