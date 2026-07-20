# Roadmap

## Phase 1 — Frontend ✅

Static-shell Next.js app: dashboard, expenses, balances, settings; design system, dark mode, PWA scaffolding, soft delete.

## Phase 2 — Supabase Integration ✅

Real credentials, RLS, Manual Add Expense form calling `add_equal_expense()`.

## Auth + Multi-Trip ✅

Google OAuth + same-screen email code sign-in; membership-scoped, fully authenticated RLS (zero `anon` access); multi-trip switcher; shareable invite links + an invitations inbox; guest members without their own login; owner/member roles; trip archive.

## Stage 3 — Financial Engine ✅

4 expense split methods (equal, exact, percentage, shares) computed by one shared Postgres function; creator-or-owner expense edit/delete permissions; full trip lifecycle (transfer ownership, leave, permanent delete); settlement recording with a minimum-transaction algorithm; an immutable, trigger-driven activity feed.

## Stage 4 — Premium Desktop UX ✅

Responsive shell with a persistent desktop sidebar (the bottom tab bar became mobile-only), global keyboard focus rings, shared dialog accessibility (ESC, scroll-lock, focus trap/restore), desktop-centred modals, hover states throughout, and a flush native-feeling mobile nav with pinch-zoom disabled.

## Offline Expense Queue ✅

Capture expenses with no connectivity and sync them when it returns. Dedicated Offline Mode (never the live app on stale data), an IndexedDB queue scoped per authenticated user, a service-worker app shell that precaches its own JS so it actually hydrates offline, and a secure sync endpoint with database-enforced idempotency. Foreground sync only — Background Sync is deliberately unused, since it isn't dependable on iOS.

**Possible follow-up**: evict the Supabase auth SDK (~256 kB) from the offline critical path. It's the largest remaining win for offline load speed, but it requires restructuring how the root layout loads on every route, so it was left as a deliberate decision rather than slipped in.

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
