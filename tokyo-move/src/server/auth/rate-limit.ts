/**
 * In-memory limiter for password logins.
 *
 * The decision is made BEFORE the (slow) password check and in one synchronous step: an attempt is counted as soon as
 * it is admitted ("in flight") and only forgiven if it succeeds. Many concurrent guesses therefore cannot all slip
 * past a check that only sees completed failures. Three buckets:
 *   - per username + address (5 per window),
 *   - per username from anywhere (10 per window),
 *   - per address (30 per window).
 * Not persisted: a restart clears it, which is acceptable for a two-person app behind a private host.
 */
export interface Admission {
  allowed: boolean;
  retryAfterSeconds: number;
  /** Present when allowed; pass to fail() or succeed() exactly once. */
  ticket: Ticket | null;
}

interface Bucket {
  failures: number[]; // epoch ms of each failure inside the window
  inflight: number;
}

export interface Ticket {
  keys: string[];
  username: string;
  ip: string;
  settled: boolean;
}

export class LoginRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(
    private readonly perUserIp = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly perIp = 30,
    private readonly perUser = 10,
  ) {}

  private keysFor(username: string, ip: string): { key: string; limit: number }[] {
    const u = username.trim().toLowerCase();
    return [
      { key: `ui:${u}|${ip}`, limit: this.perUserIp },
      { key: `u:${u}`, limit: this.perUser },
      { key: `ip:${ip}`, limit: this.perIp },
    ];
  }

  private bucket(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { failures: [], inflight: 0 };
      this.buckets.set(key, b);
    }
    return b;
  }

  private prune(b: Bucket, nowMs: number): void {
    b.failures = b.failures.filter((t) => nowMs - t < this.windowMs);
  }

  /** Admit or refuse one attempt, synchronously. */
  admit(username: string, ip: string, nowMs: number): Admission {
    const keys = this.keysFor(username, ip);
    let retry = 0;
    for (const { key, limit } of keys) {
      const b = this.buckets.get(key);
      if (!b) continue;
      this.prune(b, nowMs);
      if (b.failures.length + b.inflight >= limit) {
        // When the cause is in-flight attempts there is no failure to age out yet: ask for a short retry.
        const oldest = b.failures.length >= limit ? (b.failures[b.failures.length - limit] ?? nowMs) : nowMs;
        const wait = b.failures.length >= limit ? Math.ceil((oldest + this.windowMs - nowMs) / 1000) : 5;
        retry = Math.max(retry, wait, 1);
      }
    }
    if (retry > 0) return { allowed: false, retryAfterSeconds: retry, ticket: null };
    for (const { key } of keys) this.bucket(key).inflight += 1;
    return { allowed: true, retryAfterSeconds: 0, ticket: { keys: keys.map((k) => k.key), username, ip, settled: false } };
  }

  /** The attempt used a wrong password (or unknown user): it now counts as a failure. */
  fail(ticket: Ticket, nowMs: number): void {
    if (ticket.settled) return;
    ticket.settled = true;
    for (const key of ticket.keys) {
      const b = this.bucket(key);
      b.inflight = Math.max(0, b.inflight - 1);
      this.prune(b, nowMs);
      b.failures.push(nowMs);
    }
    if (this.buckets.size > 5000) this.sweep(nowMs);
  }

  /** The attempt succeeded: forgive this username (from this address and overall), but not the address bucket. */
  succeed(ticket: Ticket): void {
    if (ticket.settled) return;
    ticket.settled = true;
    for (const key of ticket.keys) {
      const b = this.bucket(key);
      b.inflight = Math.max(0, b.inflight - 1);
      if (!key.startsWith('ip:')) b.failures = [];
    }
  }

  private sweep(nowMs: number): void {
    for (const [key, bucket] of this.buckets) {
      this.prune(bucket, nowMs);
      if (bucket.failures.length === 0 && bucket.inflight === 0) this.buckets.delete(key);
    }
  }
}
