/**
 * Tiny in-memory token-bucket-ish rate limiter.
 *
 * Caveats:
 *  - Per-process memory only. If you're on Netlify with multiple lambda
 *    instances, each gets its own bucket — protection is best-effort.
 *  - For production-grade limiting, switch to Upstash Ratelimit or a
 *    similar Redis-backed library. For now this prevents trivial scripted
 *    spam/booking-flooding from a single client.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Periodically prune to avoid unbounded memory.
const PRUNE_EVERY_MS = 5 * 60 * 1000;
let lastPrune = Date.now();
function maybePrune() {
  const now = Date.now();
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  for (const [k, b] of buckets) {
    if (b.resetAt < now) buckets.delete(k);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  maybePrune();
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, remaining: limit - bucket.count, retryAfterSec: 0 };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}
