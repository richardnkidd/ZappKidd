/**
 * In-memory failure counter for password logins. Per (username, ip) and per ip.
 * Not persisted: a restart clears it, which is acceptable for a two-person app behind a private host.
 */
export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface Bucket {
  failures: number[]; // epoch ms of each failure inside the window
}

export class LoginRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly maxFailuresPerIp = 30,
  ) {}

  private keyFor(username: string, ip: string): string {
    return `u:${username.trim().toLowerCase()}|${ip}`;
  }

  private prune(bucket: Bucket, nowMs: number): void {
    bucket.failures = bucket.failures.filter((t) => nowMs - t < this.windowMs);
  }

  private retry(bucket: Bucket, nowMs: number, limit: number): RateLimitDecision {
    this.prune(bucket, nowMs);
    if (bucket.failures.length < limit) return { allowed: true, retryAfterSeconds: 0 };
    const oldest = bucket.failures[bucket.failures.length - limit] ?? nowMs;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000)) };
  }

  check(username: string, ip: string, nowMs: number): RateLimitDecision {
    const user = this.buckets.get(this.keyFor(username, ip));
    const byIp = this.buckets.get(`ip:${ip}`);
    const a = user ? this.retry(user, nowMs, this.maxFailures) : { allowed: true, retryAfterSeconds: 0 };
    const b = byIp ? this.retry(byIp, nowMs, this.maxFailuresPerIp) : { allowed: true, retryAfterSeconds: 0 };
    if (!a.allowed || !b.allowed) {
      return { allowed: false, retryAfterSeconds: Math.max(a.retryAfterSeconds, b.retryAfterSeconds) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  recordFailure(username: string, ip: string, nowMs: number): void {
    for (const key of [this.keyFor(username, ip), `ip:${ip}`]) {
      const bucket = this.buckets.get(key) ?? { failures: [] };
      this.prune(bucket, nowMs);
      bucket.failures.push(nowMs);
      this.buckets.set(key, bucket);
    }
    if (this.buckets.size > 5000) this.sweep(nowMs);
  }

  recordSuccess(username: string, ip: string): void {
    this.buckets.delete(this.keyFor(username, ip));
  }

  private sweep(nowMs: number): void {
    for (const [key, bucket] of this.buckets) {
      this.prune(bucket, nowMs);
      if (bucket.failures.length === 0) this.buckets.delete(key);
    }
  }
}
