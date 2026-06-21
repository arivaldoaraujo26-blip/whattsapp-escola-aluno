import { DomainError } from "../domain/errors.js";

export interface EvolutionClient {
  sendText(
    instance: string,
    toE164: string,
    body: string,
  ): Promise<{ providerMessageId: string }>;
  sendInteractiveButtons(
    instance: string,
    toE164: string,
    body: string,
    buttons: ReadonlyArray<{ id: string; label: string }>,
  ): Promise<{ providerMessageId: string }>;
}

export class HttpEvolutionClient implements EvolutionClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.baseUrl = (process.env["EVOLUTION_API_URL"] ?? "").replace(/\/$/, "");
    this.apiKey = process.env["EVOLUTION_API_KEY"] ?? "";
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          apikey: this.apiKey,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new DomainError(
        "transport_failed",
        `Evolution API network error: ${String(err)}`,
      );
    }

    if (response.status >= 500) {
      throw new DomainError(
        "transport_failed",
        `Evolution API returned ${response.status}`,
      );
    }

    return response.json() as Promise<T>;
  }

  async createInstance(instance: string): Promise<void> {
    await this.request("POST", "/instance/create", {
      instanceName: instance,
      integration: "WHATSAPP-BAILEYS",
    });
  }

  async setWebhook(instance: string, webhookUrl: string): Promise<void> {
    await this.request("POST", `/webhook/set/${instance}`, {
      webhook: {
        enabled: true,
        url: webhookUrl,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        webhookByEvents: false,
        webhookBase64: false,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
      },
    });
  }

  async connectInstance(instance: string): Promise<{ qrUrl: string }> {
    const result = await this.request<{ code?: string; base64?: string }>(
      "GET",
      `/instance/connect/${instance}`,
    );
    return { qrUrl: result.base64 ?? result.code ?? "" };
  }

  async sendText(
    instance: string,
    toE164: string,
    body: string,
  ): Promise<{ providerMessageId: string }> {
    const result = await this.request<{ key?: { id?: string } }>(
      "POST",
      `/message/sendText/${instance}`,
      { number: toE164, text: body },
    );
    return { providerMessageId: result?.key?.id ?? "" };
  }

  async sendInteractiveButtons(
    instance: string,
    toE164: string,
    body: string,
    buttons: ReadonlyArray<{ id: string; label: string }>,
  ): Promise<{ providerMessageId: string }> {
    const result = await this.request<{ key?: { id?: string } }>(
      "POST",
      `/message/sendButtons/${instance}`,
      {
        number: toE164,
        buttonMessage: {
          text: body,
          buttons: buttons.map((b) => ({
            buttonId: b.id,
            buttonText: { displayText: b.label },
          })),
        },
      },
    );
    return { providerMessageId: result?.key?.id ?? "" };
  }
}
