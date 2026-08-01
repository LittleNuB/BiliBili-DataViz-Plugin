import { RATE_LIMIT_TOKENS_PER_SEC, RATE_LIMIT_MAX_BURST } from '../../shared/constants.ts';
import { abortableDelay } from '../utils/abortable-delay.ts';

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(maxTokens = RATE_LIMIT_MAX_BURST, refillRate = RATE_LIMIT_TOKENS_PER_SEC) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
    await abortableDelay(waitMs, signal);
    this.lastRefill = Date.now();
    this.tokens = 0;
  }
}

export const apiRateLimiter = new RateLimiter();
