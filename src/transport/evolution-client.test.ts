import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HttpEvolutionClient } from "./evolution-client.js";
import { DomainError } from "../domain/errors.js";

const BASE_URL = "http://evolution-test:8080";
const API_KEY = "test-api-key";

function makeFetchOk(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValueOnce({
    status,
    json: async () => body,
  } as Response);
}

function makeFetchError(status: number): typeof fetch {
  return vi.fn().mockResolvedValueOnce({
    status,
    json: async () => ({ error: "server error" }),
  } as Response);
}

function makeFetchNetworkError(): typeof fetch {
  return vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED"));
}

describe("HttpEvolutionClient", () => {
  beforeEach(() => {
    process.env["EVOLUTION_API_URL"] = BASE_URL;
    process.env["EVOLUTION_API_KEY"] = API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["EVOLUTION_API_URL"];
    delete process.env["EVOLUTION_API_KEY"];
  });

  describe("sendText", () => {
    it("calls POST /message/sendText/:instance with the correct body and returns providerMessageId", async () => {
      const mockFetch = makeFetchOk({ key: { id: "evo-msg-id-123" } });
      vi.stubGlobal("fetch", mockFetch);

      const client = new HttpEvolutionClient();
      const result = await client.sendText(
        "teacher-abc",
        "+5511999998888",
        "Hello guardian",
      );

      expect(result).toEqual({ providerMessageId: "evo-msg-id-123" });
      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe(`${BASE_URL}/message/sendText/teacher-abc`);
      expect(init.method).toBe("POST");

      const sentBody = JSON.parse(init.body as string) as unknown;
      expect(sentBody).toMatchObject({
        number: "+5511999998888",
        text: "Hello guardian",
      });
    });

    it("includes the apikey header on every request", async () => {
      vi.stubGlobal("fetch", makeFetchOk({ key: { id: "x" } }));
      const client = new HttpEvolutionClient();
      await client.sendText("inst", "+5511111111111", "hi");

      const [, init] = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)["apikey"]).toBe(API_KEY);
    });

    it("throws DomainError with code transport_failed on Evolution API 5xx", async () => {
      vi.stubGlobal("fetch", makeFetchError(500));
      const client = new HttpEvolutionClient();

      await expect(
        client.sendText("teacher-abc", "+5511999998888", "Hello"),
      ).rejects.toThrow(DomainError);

      await expect(
        (async () => {
          vi.stubGlobal("fetch", makeFetchError(503));
          await client.sendText("teacher-abc", "+5511999998888", "Hello");
        })(),
      ).rejects.toMatchObject({ code: "transport_failed" });
    });

    it("throws DomainError with code transport_failed on network error", async () => {
      vi.stubGlobal("fetch", makeFetchNetworkError());
      const client = new HttpEvolutionClient();

      await expect(
        client.sendText("teacher-abc", "+5511999998888", "Hello"),
      ).rejects.toMatchObject({ code: "transport_failed" });
    });
  });

  describe("sendInteractiveButtons", () => {
    it("calls POST /message/sendButtons/:instance and returns providerMessageId", async () => {
      const mockFetch = makeFetchOk({ key: { id: "btn-msg-456" } });
      vi.stubGlobal("fetch", mockFetch);

      const client = new HttpEvolutionClient();
      const result = await client.sendInteractiveButtons(
        "teacher-xyz",
        "+5511888887777",
        "Choose one",
        [
          { id: "opt1", label: "Option 1" },
          { id: "opt2", label: "Option 2" },
        ],
      );

      expect(result).toEqual({ providerMessageId: "btn-msg-456" });

      const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe(`${BASE_URL}/message/sendButtons/teacher-xyz`);

      const sentBody = JSON.parse(init.body as string) as {
        number: string;
        buttonMessage: { buttons: Array<{ buttonId: string }> };
      };
      expect(sentBody.number).toBe("+5511888887777");
      expect(sentBody.buttonMessage.buttons).toHaveLength(2);
      expect(sentBody.buttonMessage.buttons[0]?.buttonId).toBe("opt1");
    });
  });

  describe("createInstance", () => {
    it("calls POST /instance/create with instanceName", async () => {
      const mockFetch = makeFetchOk({ instance: { instanceName: "teacher-123" } });
      vi.stubGlobal("fetch", mockFetch);

      const client = new HttpEvolutionClient();
      await client.createInstance("teacher-123");

      const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe(`${BASE_URL}/instance/create`);
      expect(init.method).toBe("POST");

      const sentBody = JSON.parse(init.body as string) as { instanceName: string };
      expect(sentBody.instanceName).toBe("teacher-123");
    });

    it("throws DomainError with code transport_failed on 5xx", async () => {
      vi.stubGlobal("fetch", makeFetchError(500));
      const client = new HttpEvolutionClient();

      await expect(client.createInstance("teacher-123")).rejects.toMatchObject({
        code: "transport_failed",
      });
    });
  });

  describe("connectInstance", () => {
    it("returns qrUrl from the base64 field in the response", async () => {
      vi.stubGlobal("fetch", makeFetchOk({ base64: "data:image/png;base64,abc123" }));
      const client = new HttpEvolutionClient();
      const result = await client.connectInstance("teacher-abc");
      expect(result.qrUrl).toBe("data:image/png;base64,abc123");
    });

    it("falls back to code field when base64 is absent", async () => {
      vi.stubGlobal("fetch", makeFetchOk({ code: "PAIRING-CODE-XYZ" }));
      const client = new HttpEvolutionClient();
      const result = await client.connectInstance("teacher-abc");
      expect(result.qrUrl).toBe("PAIRING-CODE-XYZ");
    });
  });
});
