import { DomainError } from "../domain/errors.js";
import type { EvolutionClient } from "./evolution-client.js";

const META_API_BASE = "https://graph.facebook.com/v20.0";

export class MetaCloudClient implements EvolutionClient {
  private readonly phoneNumberId: string;
  private readonly accessToken: string;

  constructor() {
    this.phoneNumberId = process.env["META_PHONE_NUMBER_ID"] ?? "";
    this.accessToken = process.env["META_ACCESS_TOKEN"] ?? "";
  }

  private strip(phone: string): string {
    return phone.startsWith("+") ? phone.slice(1) : phone;
  }

  private async request<T>(body: unknown): Promise<T> {
    const url = `${META_API_BASE}/${this.phoneNumberId}/messages`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new DomainError(
        "transport_failed",
        `Meta API network error: ${String(err)}`,
      );
    }
    if (response.status >= 500) {
      throw new DomainError(
        "transport_failed",
        `Meta API returned ${response.status}`,
      );
    }
    return response.json() as Promise<T>;
  }

  async sendText(
    _instance: string,
    toE164: string,
    body: string,
  ): Promise<{ providerMessageId: string }> {
    const result = await this.request<{ messages?: Array<{ id: string }> }>({
      messaging_product: "whatsapp",
      to: this.strip(toE164),
      type: "text",
      text: { body },
    });
    return { providerMessageId: result.messages?.[0]?.id ?? "" };
  }

  async sendInteractiveButtons(
    _instance: string,
    toE164: string,
    body: string,
    buttons: ReadonlyArray<{ id: string; label: string }>,
  ): Promise<{ providerMessageId: string }> {
    const result = await this.request<{ messages?: Array<{ id: string }> }>({
      messaging_product: "whatsapp",
      to: this.strip(toE164),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: {
          buttons: buttons.map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.label },
          })),
        },
      },
    });
    return { providerMessageId: result.messages?.[0]?.id ?? "" };
  }
}
