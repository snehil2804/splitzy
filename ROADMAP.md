# Roadmap

## Phase 1 — Frontend ✅

Static-shell Next.js app: dashboard, expenses, balances, settings; design system, dark mode, PWA scaffolding, soft delete.

## Phase 2 — Supabase Integration ✅

Real credentials, RLS, Manual Add Expense form calling `add_equal_expense()`.

## Auth + Multi-Trip ✅

Google OAuth + same-screen email code sign-in; membership-scoped, fully authenticated RLS (zero `anon` access); multi-trip switcher; shareable invite links + an invitations inbox; guest members without their own login; owner/member roles; trip archive.

## Stage 3 — Financial Engine ✅

4 expense split methods (equal, exact, percentage, shares) computed by one shared Postgres function; creator-or-owner expense edit/delete permissions; full trip lifecycle (transfer ownership, leave, permanent delete); settlement recording with a minimum-transaction algorithm; an immutable, trigger-driven activity feed.

## Phase 3 — Apple Shortcut

- iOS Shortcut triggered after a UPI payment (share sheet / automation)
- Parses amount + merchant, asks one-tap "who was in?" question
- POSTs to the Edge Function; zero-typing goal

## Phase 4 — Edge Functions

- `add-expense` Edge Function: validates a shared secret, normalises payload, calls the legacy name-based `add_equal_expense()` (kept `service_role`-only specifically for this no-session path)
- Idempotency (dedupe repeated Shortcut fires), basic rate limiting

## Phase 5 — Notifications

- Web Push (PWA) when a new expense lands or someone settles up
- Optional daily "trip so far" summary

## Phase 6 — AI Enhancements

- Auto-categorise + emoji from merchant strings (small model or rules-first)
- Natural-language queries ("how much did we spend on food?")
- End-of-trip summary card: highlights, biggest splurge, fair-share insights
