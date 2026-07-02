# Promptomatik

> Craft better teaching prompts in minutes, not hours.

Promptomatik is a bilingual (FR/EN) prompt-builder for language teachers. It is the companion app for [TeachInspire](https://teachinspire.me) Module 2.

At a high level:
1. A teacher describes what they need in normal language.
2. Promptomatik runs a short, adaptive interview (only a few high-impact questions).
3. The app assembles a structured prompt built from Anthropic's "6 Effective Prompting Techniques".
4. The teacher copy-pastes the final prompt into their LLM of choice (ChatGPT, Claude, Gemini, AI Studio, etc.).

Domain: `promptomatik.com`

## What It's Not

Promptomatik does not generate lesson materials directly. It generates the *prompt* that helps your own LLM produce better lesson materials, faster, with more control and repeatability.

## What You Get

Every generated prompt is stored as **blocks** (one per technique). That unlocks three ways to use the same prompt:
- **User Mode**: clean, ready-to-paste prompt text.
- **Study Mode**: the same prompt, but labeled and annotated so teachers learn *why* each technique helps.
- **Edit Mode**: block editor to reorder, tweak, add/remove techniques without rewriting everything.

Promptomatik also saves:
- **Tags** (for search/filter)
- **Tips** (practical "how to use this prompt" guidance)
- **Source type**: from scratch vs from source document

## The 6 Techniques (The Core Domain)

Promptomatik assembles prompts using these building blocks:
- Role
- Context
- Examples
- Constraints
- Steps
- Think First

Not every prompt uses all 6. Simple tasks use fewer; complex tasks use more.

## Product Tour (What Exists Today)

Frontend routes:
- `/dashboard`: prompt library (search + tag filters)
- `/new`: new prompt interview (free-text -> follow-up questions -> assembled prompt -> save)
- `/prompt/:id`: prompt view (User/Study/Edit), copy, duplicate, delete, refine
- `/templates`: published templates (official + community) that clone into your library
- `/templates/:id`: template detail (User/Study)
- `/profile`: teacher defaults used to reduce interview questions
- `/admin`: invitations, user management, template publishing/moderation (admin-only)
- `/login`, `/register?token=...`, `/forgot-password`, `/reset-password?token=...`

Backend endpoints (Cloudflare Worker, Hono):
- Interview engine: `POST /api/interview/analyze`, `POST /api/interview/questions`, `POST /api/interview/assemble`, `POST /api/interview/refine`
- Prompt library: `GET/POST /api/prompts`, `GET/PUT/DELETE /api/prompts/:id`, `POST /api/prompts/:id/duplicate`, `POST /api/prompts/:id/submit-template`
- Templates: `GET /api/templates`, `GET /api/templates/:id`, `POST /api/templates/:id/use`
- Profile: `GET/PUT /api/profile`
- Admin: invites/users/template moderation under `/api/admin/*`

## Demo Script (5 Minutes)

1. Dashboard: show the prompt library, tags, and search.
2. New prompt: type a realistic request (level + context + activity).
3. Interview: answer 2-4 follow-up questions (note "only what's missing").
4. Result:
   - Show **User Mode** (ready to paste)
   - Toggle **Study Mode** (color-coded techniques + short annotations)
   - Toggle **Edit Mode** (reorder blocks, tighten constraints)
5. Save to library, add a tag, duplicate the prompt.
6. Optional: "Result wasn't good?" refinement flow (issue type + sample output -> improved blocks + change log).
7. Templates: open a template, click "Use" to clone it into your library.

## Stack / Architecture

- React 19 + Vite 7 SPA
- Cloudflare Workers (serves SPA assets and `/api/*` via Hono in `worker/`)
- D1 (SQLite) for users, prompts, templates, invitations, password resets
- KV for sessions (cookie `promptomatik_session`, TTL 7 days)
- OpenRouter for LLM calls (configured via `OPENROUTER_MODEL` + fallback)
- Gemini API for Audio Studio TTS
- Resend for invitation + password reset emails

## Local Development

Prereqs:
- Node.js + npm
- Cloudflare Wrangler (`npx wrangler ...` is used by scripts)

Setup:
```bash
npm install
cp .env.example .dev.vars
# fill: OPENROUTER_API_KEY, GEMINI_API_KEY, RESEND_API_KEY, APP_SECRET
# set:  APP_URL (optional for local, used in email links; defaults to request origin)
# optional: OPENROUTER_MODEL, OPENROUTER_FALLBACK_MODEL

npm run db:migrate
npm run dev
```

Useful scripts:
```bash
npm run dev
npm run build
npm run preview
npm run db:migrate
npm run seed
npm run deploy
```

## Deploy (Cloudflare + Resend)

1. Create or reuse Cloudflare resources:
```bash
npx wrangler d1 create promptomatik-db
npx wrangler kv namespace create SESSIONS
npx wrangler kv namespace create SESSIONS --preview
```

2. Paste the resulting D1/KV IDs into `wrangler.jsonc`.

3. Set production secrets:
```bash
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put APP_SECRET
```

4. Verify Resend domain `promptomatik.com` and sender `noreply@promptomatik.com`.

5. Deploy:
```bash
npm run deploy
```

## Custom Domain

- Canonical app URL: `https://promptomatik.com`
- Set Worker `vars.APP_URL` in `wrangler.jsonc` to match.
- In Cloudflare, attach `promptomatik.com` to the Worker and keep the DNS record proxied.

## Reference Docs

- `spec.md`: full product spec and flows
- `docs/`: brainstorms, plans, solutions

## License

Private - TeachInspire (c) 2026
