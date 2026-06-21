import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaCloudClient } from "./meta-cloud-client.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  process.env["META_ACCESS_TOKEN"] = "test-token";
  process.env["META_PHONE_NUMBER_ID"] = "123456789";
  mockFetch.mockResolvedValue({
    status: 200,
    json: async () => ({ messages: [{ id: "wamid.abc123" }] }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["META_ACCESS_TOKEN"];
  delete process.env["META_PHONE_NUMBER_ID"];
});

describe("MetaCloudClient", () => {
  describe("sendText", () => {
    it("calls Meta Graph API with correct body and returns providerMessageId", async () => {
      const client = new MetaCloudClient();
      const result = await client.sendText("ignored-instance", "+5511999990001", "Olá!");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://graph.facebook.com/v20.0/123456789/messages");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toMatchObject({
        messaging_product: "whatsapp",
        to: "5511999990001",
        type: "text",
        text: { body: "Olá!" },
      });
      expect(result.providerMessageId).toBe("wamid.abc123");
    });

    it("strips the leading + from phone number", async () => {
      const client = new MetaCloudClient();
      await client.sendText("", "+5511942219711", "msg");
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.to).toBe("5511942219711");
    });

    it("accepts phone without + and does not double-strip", async () => {
      const client = new MetaCloudClient();
      await client.sendText("", "5511999990001", "msg");
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.to).toBe("5511999990001");
    });

    it("throws DomainError on 5xx response", async () => {
      mockFetch.mockResolvedValue({ status: 503, json: async () => ({}) });
      const client = new MetaCloudClient();
      await expect(client.sendText("", "+5511999990001", "msg")).rejects.toMatchObject({
        code: "transport_failed",
      });
    });

    it("throws DomainError on network error", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      const client = new MetaCloudClient();
      await expect(client.sendText("", "+5511999990001", "msg")).rejects.toMatchObject({
        code: "transport_failed",
      });
    });

    it("returns empty providerMessageId when response has no messages array", async () => {
      mockFetch.mockResolvedValue({ status: 200, json: async () => ({}) });
      const client = new MetaCloudClient();
      const result = await client.sendText("", "+5511999990001", "msg");
      expect(result.providerMessageId).toBe("");
    });
  });

  describe("sendInteractiveButtons", () => {
    it("sends an interactive button message with correct structure", async () => {
      const client = new MetaCloudClient();
      const buttons = [
        { id: "btn_original", label: "Enviar original" },
        { id: "btn_revisado", label: "Enviar revisado" },
      ] as const;

      const result = await client.sendInteractiveButtons(
        "ignored",
        "+5511999990001",
        "Escolha uma opção:",
        buttons,
      );

      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.type).toBe("interactive");
      expect(body.interactive.type).toBe("button");
      expect(body.interactive.body.text).toBe("Escolha uma opção:");
      expect(body.interactive.action.buttons).toEqual([
        { type: "reply", reply: { id: "btn_original", title: "Enviar original" } },
        { type: "reply", reply: { id: "btn_revisado", title: "Enviar revisado" } },
      ]);
      expect(result.providerMessageId).toBe("wamid.abc123");
    });
  });
});
