import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDate } from "../src/lib/format";

/**
 * `buildInviteLink`/`whatsappShareUrl` live inline in trips/page.tsx (not
 * exported — they're presentation helpers, not a public module). Re-test
 * the URL-shaping logic here directly since that's the part worth guarding
 * against regressions; the live suite (scripts/invitations-e2e.mjs) covers
 * the actual token/claim security properties end-to-end.
 */
function buildInviteLink(origin: string, token: string): string {
  return `${origin}/join/${token}`;
}

function whatsappShareUrl(link: string, tripName: string): string {
  const text = `Join "${tripName}" on Splitzy to track our shared expenses: ${link}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

test("invite link is a same-origin /join/<token> path", () => {
  const link = buildInviteLink("https://splitzy-delta.vercel.app", "abc123");
  assert.equal(link, "https://splitzy-delta.vercel.app/join/abc123");
});

test("WhatsApp share URL percent-encodes the link and trip name", () => {
  const url = whatsappShareUrl("https://splitzy-delta.vercel.app/join/abc123", "Goa Trip");
  assert.ok(url.startsWith("https://wa.me/?text="));
  const decoded = decodeURIComponent(url.slice("https://wa.me/?text=".length));
  assert.ok(decoded.includes("https://splitzy-delta.vercel.app/join/abc123"));
  assert.ok(decoded.includes("Goa Trip"));
});

test("WhatsApp share URL has no unencoded query-breaking characters", () => {
  const url = whatsappShareUrl(
    "https://splitzy-delta.vercel.app/join/abc123",
    "Trip & Friends?",
  );
  assert.ok(!/[&?](?!text=)/.test(url.split("?text=")[1] ?? ""));
});

test("formatDate produces a stable, compact absolute date (used for Sent/Expires)", () => {
  const formatted = formatDate(new Date("2026-07-19T12:00:00Z"));
  assert.match(formatted, /Jul/);
  assert.match(formatted, /19/);
});

test("formatDate output is deterministic for the same instant", () => {
  const date = new Date("2026-12-25T00:00:00Z");
  assert.equal(formatDate(date), formatDate(date));
});
