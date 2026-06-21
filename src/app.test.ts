import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

describe("buildApp", () => {
  it("returns a valid Fastify instance without throwing", async () => {
    const app = buildApp();
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
    await app.close();
  });
});

describe("GET /healthz", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns HTTP 200 with { ok: true, db: 'ok', evolution: 'ok' }", async () => {
    const resp = await app.inject({ method: "GET", url: "/healthz" });
    expect(resp.statusCode).toBe(200);
    expect(resp.json()).toEqual({ ok: true, db: "ok", evolution: "ok" });
  });

  it("returns HTTP 404 for unknown routes", async () => {
    const resp = await app.inject({ method: "GET", url: "/unknown-route" });
    expect(resp.statusCode).toBe(404);
  });
});

describe("Integration: server starts and responds", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await app.close();
  });

  it("binds to a port and responds to GET /healthz with the expected JSON body", async () => {
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("unexpected server address type");
    }
    const resp = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    expect(resp.status).toBe(200);
    const body = await resp.json() as unknown;
    expect(body).toEqual({ ok: true, db: "ok", evolution: "ok" });
  });
});
