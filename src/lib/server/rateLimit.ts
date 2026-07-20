/**
 * Simple in-memory sliding-window rate limiter for the Places proxy
 * routes. Per-process only — Vercel serverless functions don't share
 * memory across instances/regions, so this is a practical speed bump
 * against accidental request storms (e.g. a runaway retry loop), not a
 * hard guarantee against determined abuse. The routes are already
 * session-gated (only signed-in app members can call them at all), which
 * is the primary protection; Google's own per-key quota is the backstop.
 */

const WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 500;

const buckets = new Map<string, number[]>();

export function isRateLimited(key: string, maxRequestsPerMinute: number): boolean {
  const now = Date.now();
  // Cheap safeguard against unbounded growth on a long-lived instance —
  // never expected to matter for this app's actual traffic.
  if (buckets.size > MAX_TRACKED_KEYS) buckets.clear();

  const timestamps = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (timestamps.length >= maxRequestsPerMinute) {
    buckets.set(key, timestamps);
    return true;
  }
  timestamps.push(now);
  buckets.set(key, timestamps);
  return false;
}
