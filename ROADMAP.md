# Roadmap

## Phase 1 — Frontend ✅ (current)

Static-shell Next.js app: dashboard, expenses, balances, settings, add-expense placeholder; design system, dark mode, PWA scaffolding, soft delete, docs.

## Phase 2 — Supabase Integration

- Paste real credentials; verify the column contract in `src/lib/queries.ts` against the live schema
- Tighten RLS for the anon read + soft-delete paths
- Optional: Realtime subscription (`postgres_changes` on `expenses`) for live updates across the three phones
- Manual Add Expense form calling `add_equal_expense()` — covers cash spends until the Shortcut ships

## Phase 3 — Apple Shortcut

- iOS Shortcut triggered after UPI payment (share sheet / automation)
- Parses amount + merchant, asks one-tap "who was in?" question
- POSTs to the Edge Function; zero-typing goal

## Phase 4 — Edge Functions

- `add-expense` Edge Function: validates a shared secret, normalises payload, calls `add_equal_expense()`
- Idempotency (dedupe repeated Shortcut fires), basic rate limiting

## Phase 5 — Notifications

- Web Push (PWA) when a new expense lands or someone settles up
- Optional daily "trip so far" summary

## Phase 6 — AI Enhancements

- Auto-categorise + emoji from merchant strings (small model or rules-first)
- Natural-language queries ("how much did we spend on food?")
- End-of-trip summary card: highlights, biggest splurge, fair-share insights
