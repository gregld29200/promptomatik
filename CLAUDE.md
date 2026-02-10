# Promptomatic

## Project Summary

Promptomatic is a bilingual (FR/EN) prompt-builder web app for language teachers. It's the companion app for TeachInspire Module 2. Teachers describe what they need in natural language, the app runs a smart adaptive interview, and outputs a structured prompt built on Anthropic's 6 prompting techniques. The prompt can be studied (Study Mode), edited (block editor), saved, and reused.

**Domain:** promptomatic.com
**Owner:** Greg (TeachInspire)
**Status:** Greenfield — building from scratch

---

## Stack

- **Frontend:** React 19 + Vite 6 SPA on Cloudflare Workers (via `@cloudflare/vite-plugin`)
- **API:** Hono router in `worker/index.ts` (Workers runtime — NOT legacy Pages Functions)
- **Database:** Cloudflare D1 (SQLite at edge)
- **KV:** Cloudflare KV (sessions, TTL-based expiration)
- **LLM:** OpenRouter API (targeting cheap powerful models: GLM 4.7/5)
- **Email:** Resend (invitations, password reset)
- **Auth:** Invite-only, email + password, bcryptjs, session cookies in KV
- **i18n:** JSON translation files (fr.json, en.json), lightweight `t()` helper
- **Fonts:** Fraunces (display) + DM Sans (body) via @fontsource-variable (self-hosted)
- **UI Components:** Hand-built design system + ReactBits (copy-paste animations)

---

## Core Domain: The 6 Prompting Techniques

Every prompt this app generates is built from these blocks (from Anthropic's handout):

1. **Context** — Scope, audience, level, goals, timeframe
2. **Examples** — What "good" looks like
3. **Constraints** — Output format, length, structure, level
4. **Steps** — Break complex tasks into sequential instructions
5. **Think First** — Ask AI to reason before answering
6. **Role** — Define persona, tone, expertise

Not every prompt uses all 6. The app decides which to include based on the interview.

---

## Architecture Patterns

### Prompt Data Model
Prompts are stored as an array of **blocks**, each mapped to a technique:
```json
{
  "blocks": [
    {
      "technique": "role",
      "content": "You are an experienced FLE teacher...",
      "annotation": "Defining the AI's role helps shape its approach to fit your specific needs.",
      "order": 1
    }
  ]
}
```
This block model powers User Mode (collapsed prose), Study Mode (labeled + annotated), and the Block Editor (reorderable cards).

### LLM Call Pattern
Each prompt generation session = 2-3 LLM calls via OpenRouter:
1. Intent Analysis (parse free-text, extract entities)
2. Interview Questions (adaptive follow-ups)
3. Prompt Assembly (structured blocks + annotations + model recommendation)

System prompts are English internally. Output language matches user preference. French output MUST be natively idiomatic — not translated English.

### Auth Pattern
Invite-only: Admin sends invite → token link → user registers → session cookie via KV.

---

## Conventions

### Code Style
- TypeScript everywhere (frontend + Workers)
- Strict mode, no `any` types
- Prefer small, focused functions
- Error messages: friendly, no technical jargon, bilingual

### File Organization
- `/src/pages/` — Route page components
- `/src/components/ui/` — Design system primitives (Button, Input, Card, Badge, Spinner)
- `/src/components/layout/` — Shell, Nav, layout wrappers
- `/src/lib/` — Shared utilities, API clients
- `/src/lib/llm/` — OpenRouter integration, system prompts
- `/src/lib/db/` — D1 queries and schema
- `/src/lib/i18n/` — Translation files (fr.json, en.json) and `t()` helper
- `/src/lib/auth/` — Frontend auth utilities
- `/src/styles/` — Design tokens (tokens.css) and global styles (global.css)
- `/src/reactbits/` — Copied ReactBits animation components
- `/worker/` — Hono API backend (replaces legacy `/functions/`)
- `/worker/routes/` — API route modules (auth.ts, health.ts)
- `/worker/lib/` — Backend utilities (session.ts, password.ts, auth-middleware.ts)
- `/migrations/` — D1 SQL migration files

### Naming
- Files: kebab-case (`prompt-editor.tsx`, `interview-engine.ts`)
- Components: PascalCase (`PromptEditor`, `StudyModeBlock`)
- DB tables: snake_case (`user_prompts`, `invite_tokens`)
- API routes: REST-style (`/api/prompts`, `/api/invitations`)

### Bilingual
- All user-facing strings go through i18n — never hardcode text
- Translation keys: dot-notation (`dashboard.new_prompt`, `interview.question.level`)
- Default language: French (primary audience)

---

## Preferences

- Keep the UI clean and minimal — teachers are not developers
- Prioritize speed: the interview should feel fast, not like a form
- Block editor should feel like Notion, not like a code editor
- Study Mode annotations should be concise — 1-2 sentences max per block
- Copy-to-clipboard must work perfectly on mobile (many teachers prep on phone)
- Auto-save everything — teachers should never lose work
- Error messages should be warm and helpful, never technical

---

## Known Patterns & Learnings

### Architecture (Phase 1)
- **Workers + Vite Plugin, NOT Pages Functions:** Cloudflare deprecated the `/functions/` directory approach. Use `@cloudflare/vite-plugin` with `worker/index.ts` as the single backend entry point. Hono handles API routing.
- **wrangler.jsonc config:** Use `"not_found_handling": "single-page-application"` and `"run_worker_first": ["/api/*"]` for SPA routing. Do NOT create a `404.html` — it overrides the SPA fallback.
- **D1 SQLite quirks:** No BOOLEAN (use INTEGER 0/1), no ENUM (use TEXT + CHECK), no UUID type (use TEXT + `crypto.randomUUID()`), no ARRAY (use TEXT with JSON).
- **KV sessions:** Eventually consistent (~60s propagation). Session reads typically hit the same edge that wrote them, so this is fine for auth. TTL minimum is 60 seconds.
- **bcryptjs on Workers:** Use `bcryptjs` (pure JS), not `bcrypt` (native). 10 rounds is safe for Workers CPU limits.
- **Self-hosted fonts:** Use `@fontsource-variable` packages, not Google Fonts CDN. Eliminates third-party DNS + GDPR concerns.

### Design System
- **Sharp rectangular buttons** (radius-none) — TeachInspire brand identity
- **Color palette:** Navy (primary/text), Cream (backgrounds), Terracotta (accents), Gold (CTAs)
- **Typography:** Fraunces Variable (display/headings), DM Sans Variable (body/UI)
- **Technique colors** mapped in CSS custom properties for Study Mode badges
- **CSS Modules** for component styling, CSS custom properties for design tokens

---

## Out of Scope (v1)

- Student cards / learner profiles → v1.1
- LLM fallback chain → v1.1
- Rate limiting → v1.1
- Google OAuth → v1.1
- In-app prompt execution → v1.1+
- Export (Docs/PDF/Markdown) → v1.1+
- User-submitted templates → v1.1+
- Prompt versioning → v1.1

---

## Reference Documents

- `spec.md` — Full project specification
- `docs/plans/` — Implementation plans
- `docs/brainstorms/` — Brainstorm outputs
- `docs/solutions/` — Compound learnings
- Anthropic's "6 Effective Prompting Techniques" PDF — the pedagogical foundation
