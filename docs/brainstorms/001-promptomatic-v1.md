# Brainstorm: Promptomatik v1

**Date:** 2025-02-10
**Participants:** Greg (project owner), Claude (AI)
**Method:** Spec interview (deep dive, adaptive questioning)

---

## Problem Statement

Language teachers gain time by using AI for lesson prep but lose time crafting effective prompts. The time spent prompting can cancel out the time saved — defeating the purpose. Promptomatik eliminates this tradeoff by automating prompt quality, not lesson creation.

## Key Decisions Made

### Users & Access
- **Audience:** Language teachers and instructional designers at private institutes, teaching adult learners
- **Access model:** Invite-only (admin sends invitation links)
- **Auth:** Email + password, no Google OAuth in v1
- **Bilingual:** Full FR/EN UI and prompt output
- **Admin scope:** User management only — no analytics (lives in community platform)

### Product Positioning
- Companion app for TeachInspire Module 2
- NOT a lesson generator — it's a prompt quality tool
- Teachers still use their own LLM (Gemini, ChatGPT, Claude)
- Teachers still use their own workflow (Gladia, TTS, etc.)
- Both a productivity tool (User Mode) and a learning tool (Study Mode)

### Core UX: The Interview Flow
- Natural language input → AI extracts what's already provided → adaptive follow-ups
- Style: like Claude's ask_interviewer — clickable options, conversational, fast
- Key fork: "Do you have a source document?" → Yes (paste placeholder) / No (generate from scratch)
- Teacher profiles auto-fill defaults → interview shortens to 2-4 questions
- Goal: intent to copy-ready prompt in under 3 minutes

### Prompt Architecture
- Block-based: each block = one of the 6 techniques
- Not every prompt uses all 6 — app decides based on interview
- Blocks are editable, reorderable, removable, addable
- Same data model powers User Mode, Study Mode, and Block Editor
- Auto-save to prompt library

### Study Mode
- Same prompt, but each block labeled + annotated
- Annotations explain which technique and why it's there
- For self-paced learning AND live training demos
- Teachers can toggle freely between User Mode and Study Mode

### Model Recommendation
- App suggests which LLM model to use after generating prompt
- Based on complexity: thinking models for complex tasks, Flash for simple ones
- Start with Gemini-specific recommendations (Module 1 teaches Gemini)

### "Result Wasn't Good?" Flow
- Teacher returns after getting bad LLM output
- 2 questions: what went wrong + optional paste of output
- AI proposes revised prompt + explains changes in Study Mode

### Community Templates
- Curated by Greg initially
- Organized by job-to-be-done (not by technique)
- Always funneled through interview for customization
- Future: newsletter integration ("Prompt of the Week")

### Technical Stack
- Cloudflare Pages + D1 + KV (fresh project, no legacy)
- OpenRouter for LLM (targeting GLM 4.7/5 — cheap + powerful)
- Resend for email
- Domain: promptomatik.com

## Feature Prioritization

### v1 (Launch)
- Invite-only auth + admin dashboard
- Bilingual UI (FR/EN)
- Natural language input → AI interview
- Structured prompt generation (6 techniques)
- User Mode (clean copy-paste)
- Study Mode (labeled blocks with explanations)
- Block-based rich editor with auto-save
- Teacher profiles (saved defaults)
- Prompt library (save, name, tag, reuse)
- Community template library (curated)
- Model recommendation
- "Result wasn't good?" refinement flow

### v1.1 (Post-launch)
1. Student cards (save learner profiles, auto-inject into prompts)
2. Rate limiting (~20 prompts/user/day)
3. LLM fallback chain (OpenRouter → Gemini → error)
4. Google login
5. Export (Google Docs, PDF, Markdown)
6. Prompt versioning
7. User-submitted templates with moderation

## Open Questions (to resolve during build)
- Frontend framework: SvelteKit vs Astro vs React+Vite?
- How to handle UI language ≠ prompt language (FR teacher making EN prompts)?
- Block editor library choice (TipTap? Slate? Custom?)
- How to ensure French LLM output feels native, not translated?

## Insights & Risks

### Biggest risk
Teachers use it 3 times, save their prompts, and never come back. **Mitigation:** Teacher profiles, refinement flow, community templates, and study mode create ongoing value beyond one-shot prompt generation.

### Biggest opportunity
Student cards (v1.1) will be a killer feature. A teacher with 15+ individual students, each with saved context, will use the app daily. The interview flow can also offer to save new student info discovered during prompt building — "You mentioned this student works in pharma. Save this for next time?"

### Non-obvious insight from interview
The French language challenge is a real engineering problem. Direct translation produces awkward prompts. The system prompts need careful crafting to produce natively idiomatic French instructional language. This will require iteration and testing with real French-speaking teachers.

---

## Handoff

This brainstorm is ready for `/workflows:plan`. The spec is in `spec.md` and project context is in `CLAUDE.md`.
