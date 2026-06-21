export interface RateLimiter {
  wait(): Promise<void>;
}

export class IntervalRateLimiter implements RateLimiter {
  private lastSentAt = 0;

  constructor(private readonly intervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastSentAt;
    if (elapsed < this.intervalMs) {
      await new Promise<void>((r) => setTimeout(r, this.intervalMs - elapsed));
    }
    this.lastSentAt = Date.now();
  }
}
