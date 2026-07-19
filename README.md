# Splitzy 💸

A premium, mobile-first trip expense tracker for three friends — **Snehil, Shruti & Anshul**.

Splitzy makes logging and reading trip expenses nearly effortless. Today the web app displays and manages expenses; soon an Apple Shortcut will log them automatically right after UPI payments.

## Stack

| Layer     | Choice                                        |
| --------- | --------------------------------------------- |
| Framework | Next.js 16 (App Router, Turbopack)            |
| Language  | TypeScript                                    |
| Styling   | Tailwind CSS v4 (CSS-first tokens)            |
| Data      | Supabase (existing project — frontend only)   |
| Hosting   | Vercel                                        |

No other runtime dependencies. Every route prerenders as a static shell, so the app opens instantly; data streams in client-side from Supabase.

## Quick start

```bash
npm install
cp .env.local.example .env.local   # paste your Supabase URL + anon key
npm run dev
```

See [SETUP.md](./SETUP.md) for the full walkthrough (including the database schema the frontend expects).

## Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) — how the app is put together and why
- [UI_GUIDELINES.md](./UI_GUIDELINES.md) — design system, tokens, motion rules
- [SETUP.md](./SETUP.md) — environment & Supabase configuration
- [PROJECT_STATUS.md](./PROJECT_STATUS.md) — live checklist
- [ROADMAP.md](./ROADMAP.md) — phases 1–6 (frontend → AI enhancements)
- [CHANGELOG.md](./CHANGELOG.md) — what changed, when
