# Plan: Promptomatic v1 — Implementation

**Status:** Ready for `/workflows:plan` deepening
**Source:** `docs/brainstorms/001-promptomatic-v1.md` + `spec.md`
**Date:** 2025-02-10

---

## Phase 1: Foundation (Days 1-2)

### 1.1 Project Scaffold
- [ ] Initialize Cloudflare Pages project
- [ ] Choose and configure frontend framework (SvelteKit recommended)
- [ ] Set up D1 database with initial schema
- [ ] Set up KV namespace for sessions
- [ ] Configure Resend for transactional email
- [ ] Set up i18n with fr.json and en.json base files
- [ ] Deploy skeleton to promptomatic.com

### 1.2 Auth & Invitations
- [ ] D1 tables: users, invitations
- [ ] Admin: send invitation endpoint (`POST /api/invitations`)
- [ ] Invitation email via Resend (with unique token link)
- [ ] Registration page (from invite link): name, password
- [ ] Login page: email + password
- [ ] Session management via KV (HttpOnly cookie)
- [ ] Auth middleware for API routes
- [ ] Admin role check middleware

### 1.3 Admin Dashboard
- [ ] Admin-only page
- [ ] Send invitation form (email input)
- [ ] List of users (name, email, status, created_at)
- [ ] List of pending invitations
- [ ] Deactivate user action

---

## Phase 2: Core Loop (Days 3-5)

### 2.1 Interview Engine
- [ ] OpenRouter integration (`/src/lib/llm/openrouter.ts`)
- [ ] System prompt for intent analysis (English, outputs structured JSON)
- [ ] System prompt for interview question generation
- [ ] Intent analysis: parse free-text → extract entities (level, topic, activity, source/no-source)
- [ ] Adaptive question generation: only ask what's missing
- [ ] Question format: clickable options (ask_interviewer style) where possible
- [ ] Source fork: "Do you have a source?" → Yes/No path
- [ ] Teacher profile integration: auto-fill known defaults, skip those questions
- [ ] Interview state management (multi-turn conversation)

### 2.2 Prompt Generation
- [ ] System prompt for prompt assembly (6 techniques, bilingual)
- [ ] Generate structured blocks: technique + content + annotation + order
- [ ] Model recommendation logic (complexity → model suggestion)
- [ ] French language quality: system prompt instructs native idiomatic French
- [ ] D1 table: prompts (with JSON blocks column)
- [ ] Save prompt endpoint (`POST /api/prompts`)

### 2.3 Dashboard
- [ ] "New Prompt" button → interview flow
- [ ] "My Prompts" → prompt library
- [ ] "Templates" → community library
- [ ] Bilingual UI toggle

---

## Phase 3: Views & Editor (Days 6-8)

### 3.1 User Mode
- [ ] Display prompt as clean, copy-ready prose
- [ ] Collapse blocks into flowing text
- [ ] Copy-to-clipboard button (must work on mobile)
- [ ] Model recommendation display
- [ ] Toggle to Study Mode

### 3.2 Study Mode
- [ ] Same prompt, blocks labeled by technique
- [ ] Color-coding or visual indicator per technique
- [ ] Annotation overlay: 1-2 sentence explanation per block
- [ ] Technique legend/key
- [ ] Toggle to User Mode

### 3.3 Block Editor
- [ ] Each technique = editable card
- [ ] Rich text editing within blocks
- [ ] Reorder blocks (drag and drop)
- [ ] Remove block
- [ ] Add block (choose technique)
- [ ] Auto-save on edit (debounced)
- [ ] Sync to prompt library

---

## Phase 4: Features (Days 9-11)

### 4.1 Teacher Profile
- [ ] Profile page / first-login setup flow
- [ ] Fields: languages taught, typical levels, duration, activities, context, format
- [ ] Save to user record (JSON profile field in D1)
- [ ] Integration with interview engine (auto-fill defaults)

### 4.2 Prompt Library
- [ ] List view: name, tags, date, language, techniques used
- [ ] Search by text
- [ ] Filter by tag, level, activity type
- [ ] Open in User Mode / Study Mode / Editor
- [ ] Duplicate prompt
- [ ] Delete prompt
- [ ] Name and tag editing

### 4.3 Community Templates
- [ ] Seed 5-7 templates (Greg creates content)
- [ ] Template list view, organized by job-to-be-done
- [ ] Click template → enter interview flow (pre-filled)
- [ ] Customized result saved to personal library
- [ ] Admin: create/edit/delete templates

### 4.4 Refinement Flow
- [ ] "Result wasn't good?" button on saved prompts
- [ ] 2-question flow: issue type + optional output paste
- [ ] LLM call to analyze and revise prompt
- [ ] Show revised prompt with Study Mode diff (what changed + why)
- [ ] Accept / tweak / discard

---

## Phase 5: Polish & Launch (Days 12-14)

### 5.1 Bilingual Polish
- [ ] Complete fr.json and en.json translations
- [ ] Test all flows in both languages
- [ ] Test French prompt output quality with real scenarios
- [ ] Fix any awkward translations

### 5.2 Mobile & Responsiveness
- [ ] Test all views on mobile
- [ ] Copy-to-clipboard on mobile browsers
- [ ] Interview flow on small screens (clickable options must be thumb-friendly)
- [ ] Block editor on tablet (drag and drop fallback)

### 5.3 Error States
- [ ] LLM timeout handling (spinner → retry message)
- [ ] LLM failure handling (friendly error)
- [ ] Network errors (auto-retry saves)
- [ ] Expired invite link page
- [ ] Empty states (no prompts yet, no templates match filter)

### 5.4 Deploy & Launch
- [ ] Final deploy to promptomatic.com
- [ ] Admin: send first batch of invitations
- [ ] Greg: seed community templates
- [ ] Greg: record Module 2 videos using live app
- [ ] Smoke test with 2-3 real teachers

---

## Dependencies & Blockers

| Dependency | Owner | Status |
|---|---|---|
| promptomatic.com DNS → Cloudflare | Greg | Pending |
| Cloudflare account with D1 + KV | Greg | Pending |
| OpenRouter API key + credits | Greg | Pending |
| Resend account + domain verification | Greg | Pending |
| Seed template content (5-7 templates) | Greg | Pending |
| Module 2 video recording | Greg | After app launch |

---

## Notes for `/workflows:plan`

This plan is a high-level outline. Run `/workflows:plan` on each phase to get deeper implementation details with file-level specificity. Start with Phase 1 (foundation) since everything else depends on it.

Recommended sequence:
```
/workflows:plan Set up Cloudflare Pages project with D1, KV, auth, and invite system
/workflows:plan Build the interview engine with OpenRouter integration
/workflows:plan Create User Mode, Study Mode, and block editor views
```
