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

**Follow-up, now shipped**: the Supabase auth SDK is off the offline critical path. `/offline` went from 1009 kB across 14 assets to **730 kB across 12** (−28%), with the SDK verified absent from every chunk it loads in production. Offline Mode answers "who is signed in" from an IndexedDB marker written by the online app, and the Supabase-dependent shell is code-split behind a gate that never renders on `/offline*`.

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
