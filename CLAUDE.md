# Promptomatic

## Project Summary

Promptomatic is a bilingual (FR/EN) prompt-builder web app for language teachers. It's the companion app for TeachInspire Module 2. Teachers describe what they need in natural language, the app runs a smart adaptive interview, and outputs a structured prompt built on Anthropic's 6 prompting techniques. The prompt can be studied (Study Mode), edited (block editor), saved, and reused.

**Domain:** promptomatic.com
**Owner:** Greg (TeachInspire)
**Status:** Greenfield — building from scratch

---

## Stack

- **Frontend:** Cloudflare Pages (framework TBD — SvelteKit or Astro preferred for edge performance)
- **API:** Cloudflare Pages Functions (Workers runtime)
- **Database:** Cloudflare D1 (SQLite at edge)
- **KV:** Cloudflare KV (sessions, caching)
- **LLM:** OpenRouter API (targeting cheap powerful models: GLM 4.7/5)
- **Email:** Resend (invitations, password reset)
- **Auth:** Invite-only, email + password, session cookies in KV
- **i18n:** JSON translation files (fr.json, en.json)

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
- `/src/pages/` — Routes/pages
- `/src/components/` — Reusable UI components
- `/src/lib/` — Shared utilities, API clients
- `/src/lib/llm/` — OpenRouter integration, system prompts
- `/src/lib/db/` — D1 queries and schema
- `/src/lib/i18n/` — Translation files and helpers
- `/src/lib/auth/` — Auth utilities, session management
- `/functions/` — Cloudflare Pages Functions (API routes)

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

(This section gets updated as we build — the compound step fills it)

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
