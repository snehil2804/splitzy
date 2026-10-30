Link to access: https://splitzy-delta.vercel.app/login

# Splitzy 💸

A premium, mobile-first trip expense tracker — authenticated, multi-trip, and built to split fairly no matter how a group divides costs (equal, exact amounts, percentages, or shares).

Splitzy makes logging and reading trip expenses nearly effortless: sign in, create or join a trip, add an expense, and balances update instantly. Today the web app handles the full financial lifecycle end-to-end; soon an Apple Shortcut will log expenses automatically right after UPI payments.

## Stack

| Layer     | Choice                                        |
| --------- | ---------------------------------------------- |
| Framework | Next.js 16 (App Router, Turbopack)            |
| Language  | TypeScript                                    |
| Styling   | Tailwind CSS v4 (CSS-first tokens)            |
| Auth      | Supabase Auth (magic-link/email-code + Google)|
| Data      | Supabase (Postgres, RLS, this repo owns migrations) |
| Hosting   | Vercel                                        |

Single runtime dependency (`@supabase/supabase-js` + `@supabase/ssr`). Every page route prerenders as a static shell, so the app opens instantly; data streams in client-side from Supabase, scoped by row-level security to whatever trips the signed-in account belongs to.

## Features

- **Auth**: Google OAuth or a same-screen email code, no passwords
- **Multi-trip**: create/switch/archive trips, invite people by shareable link or from their inbox, guest members without their own login
- **Expenses**: 4 split methods (equal, exact amounts, percentage, shares), edit/delete restricted to the person who added it or the trip owner
- **Balances & settlements**: live "you owe / you're owed" balances, a minimum-transaction settlement suggestion, and a one-tap "mark as paid" action
- **Trip lifecycle**: transfer ownership, leave a trip, permanently delete a trip (owner-only)
- **Activity feed**: an immutable log of everything that happened on a trip
- **Offline capture**: no signal on the mountain? Log expenses anyway — they queue on the device and sync themselves when the connection returns, with database-enforced idempotency so a retry can never duplicate an expense

## Quick start

```bash
npm install
cp .env.local.example .env.local   # paste your Supabase URL + publishable key + secret key
npm run dev
```

See [SETUP.md](./SETUP.md) for the full walkthrough (including the database schema the frontend expects).

## Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) — how the app is put together and why
- [UI_GUIDELINES.md](./UI_GUIDELINES.md) — design system, tokens, motion rules
- [SETUP.md](./SETUP.md) — environment & Supabase configuration
- [PROJECT_STATUS.md](./PROJECT_STATUS.md) — live checklist
- [ROADMAP.md](./ROADMAP.md) — what shipped and what's next (Shortcut → Edge Function → notifications → AI)
- [CHANGELOG.md](./CHANGELOG.md) — what changed, when
