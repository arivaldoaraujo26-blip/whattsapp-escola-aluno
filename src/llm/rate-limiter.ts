import { DomainError } from "../domain/errors.js";

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillTime: number;
  private readonly maxTokens: number;
  private readonly refillRatePerMs: number;

  constructor(rpm: number) {
    this.maxTokens = rpm;
    this.tokens = rpm;
    this.lastRefillTime = Date.now();
    this.refillRatePerMs = rpm / 60_000;
  }

  consume(): void {
    this.refill();
    if (this.tokens < 1) {
      throw new DomainError("llm_unavailable", "LLM rate limit exceeded");
    }
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerMs);
    this.lastRefillTime = now;
  }
}
