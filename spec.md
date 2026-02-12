# Promptomatik — Spec

**A bilingual prompt-builder web app for language teachers, powered by the 6 Effective Prompting Techniques.**

Promptomatik is the companion app for TeachInspire Module 2. It helps language teachers and instructional designers craft high-quality, structured prompts for LLMs — without spending more time on the prompt than they save on lesson prep. Teachers describe what they need in natural language, the app runs a smart adaptive interview, and outputs a structured prompt built on Anthropic's 6 prompting techniques. The prompt can be studied, edited, saved, and reused.

---

## Users & Personas

### Primary: Language Teacher (private institute)
- Teaches **adult learners**, mostly **1:1, mostly online**
- Students come from diverse industries (pharma, logistics, hospitality, tech, etc.)
- Needs to create **customized lessons** adapted to each student's level, goals, and industry
- Has completed **TeachInspire Module 1** — comfortable with LLMs, AI Studio, Gladia, TTS
- Entering **Module 2** — learning to craft their own prompts from scratch
- Speaks French and/or English
- May teach languages other than English (FLE teachers, Spanish teachers, etc.)

### Secondary: Instructional Designer
- Designs curricula for language institutes
- Needs to produce templates and standardized lesson formats
- Power user who will use the community library and create reusable prompts

### Admin: Greg (you)
- Manages invitations, user access
- Curates the community template library
- Uses the app live during Module 2 video recordings

### Anti-persona: The casual user
- Someone who just wants ChatGPT to "write me a lesson" — Promptomatik is not for zero-effort prompting. It's for teachers who want to understand and control what they're asking the AI to do.

---

## Core Philosophy

> **The problem:** Teachers gain time by using AI for lesson prep, but lose time crafting effective prompts. Promptomatik eliminates that tradeoff.

> **The approach:** The app doesn't automate lesson creation — it automates *prompt quality*. Teachers still use their own LLM (AI Studio, ChatGPT, Claude) and their own workflow (Gladia for transcription, TTS for audio). Promptomatik ensures the prompt they paste in is structured, complete, and optimized.

> **The pedagogical layer:** The app is both a productivity tool (User Mode) and a learning tool (Study Mode). Teachers who want to understand prompting can see exactly how each technique is applied. Teachers who just want results can skip straight to copy-paste.

---

## The 6 Prompting Techniques (Core Domain)

Every prompt Promptomatik generates is built from these building blocks, derived from Anthropic's "6 Effective Prompting Techniques" handout (the foundation document for Module 2):

1. **Provide Context** — Scope, geography, timeframe, audience, level, goals
2. **Show Examples** — What "good" looks like; sample inputs/outputs
3. **Specify Output Constraints** — Format, length, structure, language level, sections
4. **Break Complex Tasks into Steps** — Sequential instructions for the LLM
5. **Ask It to Think First** — Reasoning/reflection instructions before answering
6. **Define the AI's Role** — Persona, tone, expertise, audience awareness

Plus the meta-technique: **Ask the AI for help with prompting** — which is essentially what Promptomatik *is*.

Not every prompt uses all 6 techniques. A simple vocab list might only need Context + Constraints + Role. A complex lesson plan might use all 6. The app decides which techniques to include based on the interview.

---

## Core Flows

### Flow 1: Build a New Prompt (the primary flow)

```
Teacher lands on Dashboard
    → clicks "New Prompt"
    → Free-text input: describes what they need in natural language
        Example: "I need a B1 roleplay about ordering at a restaurant for an adult learner in hospitality"
    → AI analyzes the input, extracts what's already provided
    → Adaptive interview begins (ask_interviewer style):
        - Clickable options, not open text (where possible)
        - Only asks what's MISSING — doesn't re-ask what was already stated
        - 3-6 questions max for most prompts
        - Key fork: "Do you have a source document, or generate from scratch?"
            - If source: prompt includes a placeholder "Paste your transcript/text here"
            - If from scratch: AI needs more context about content to generate
        - Teacher profile defaults auto-fill where possible (reducing questions)
    → Structured prompt generated, built on the 6 techniques
    → Prompt displayed in User Mode (clean, ready to copy)
    → Model recommendation shown: "Best with: Gemini Pro" or "Flash is fine for this"
    → Teacher can:
        - Copy to clipboard
        - Switch to Study Mode (see labeled blocks + explanations)
        - Edit in block editor
        - Save to library (name + tags)
```

### Flow 2: Study Mode

```
Teacher opens any prompt (new or saved) in Study Mode
    → Same prompt content, but each section is:
        - Color-coded or labeled by technique (Context, Role, Constraints, etc.)
        - Annotated with a short explanation of WHY this block exists
        - Explains what the technique does and how it improves output
    → Teacher can toggle between User Mode and Study Mode
    → Edits made in either mode sync to the same prompt
```

> 💡 DECISION: Study Mode and User Mode display the same underlying block structure. Study Mode adds labels + annotations. User Mode collapses them into clean prose. The block editor is the shared editing interface.

### Flow 3: Edit a Prompt (Block Editor)

```
Teacher opens block editor (from User Mode or Study Mode)
    → Each technique is a separate editable block/card
    → Blocks can be:
        - Edited (rich text within the block)
        - Reordered (drag and drop)
        - Removed ("I don't need Examples for this one")
        - Added ("Let me add a Think First instruction")
    → Changes auto-save to the prompt library
    → The final "copy" output always reflects current block state
```

> 💡 DECISION: Block-based editing, not a single textarea. Each block = one technique. This maps Study Mode, Edit Mode, and User Mode onto the same data model.

### Flow 4: "Result Wasn't Good?" Refinement

```
Teacher used the prompt in their LLM, got mediocre results
    → Returns to Promptomatik, opens the saved prompt
    → Clicks "Result wasn't good?"
    → App asks 2 questions:
        1. "What was wrong?" (too hard / too long / too generic / off-topic / wrong level / other)
        2. "Paste 3-10 lines of the output you got" (optional but helpful)
    → AI analyzes and proposes a revised prompt
    → In Study Mode: explains what changed and why
    → Teacher can accept, tweak, or discard the revision
```

### Flow 5: Teacher Profile Setup

```
Teacher goes to Profile (or prompted on first login)
    → Sets defaults:
        - Name
        - Languages they teach
        - Typical student levels (CEFR)
        - Typical lesson duration
        - Preferred activity types (roleplay, exercises, discussion, etc.)
        - Assessment style preferences
        - Teaching context (online/in-person, 1:1/group)
    → These defaults auto-inject into the interview:
        - If profile says "B1-B2 adults, online, 1:1" → interview skips those questions
        - Interview drops from 6 questions to 2-4 most of the time
```

### Flow 6: Prompt Library

```
Dashboard → "My Prompts"
    → List of all saved prompts
    → Each prompt has: name, tags, date, language, technique blocks used
    → Search/filter by tag, level, activity type
    → Click to open in User Mode, Study Mode, or Block Editor
    → Duplicate a prompt to create a variant
```

### Flow 7: Community Template Library

```
Dashboard → "Templates"
    → Curated library of prompt templates (created by Greg)
    → Organized by job-to-be-done:
        - "60-min lesson from article"
        - "Roleplay for professional scenario"
        - "Vocab + exercises from transcript"
        - "Assessment / rubric"
        - "Needs analysis + learning plan"
    → Teacher clicks a template → funneled into interview to customize it
        - Template pre-fills many fields, interview fills the rest
    → Customized result saved to their personal library
```

> 💡 DECISION: Templates always go through the interview to customize. No blind copy-paste of templates — this ensures prompt quality and teaches the teacher how the template works.

### Flow 8: Admin (Invite Management)

```
Greg logs into admin dashboard
    → "Send Invitation" → enters email → system sends invite link
    → Invitee clicks link → creates account (email + password)
    → Greg can see: list of registered users, invitation status
    → Greg can deactivate a user
    → No analytics, no usage tracking in v1 (lives in community platform)
```

> 💡 DECISION: Admin is purely user management for v1. Training analytics live in the separate community platform.

---

## Data Model

### User
```
id: string (UUID)
email: string (unique)
name: string
password_hash: string
role: enum ["teacher", "admin"]
language_preference: enum ["fr", "en"]
profile: JSON {
    languages_taught: string[]
    typical_levels: string[] (CEFR)
    typical_duration: number (minutes)
    preferred_activities: string[]
    teaching_context: enum ["online", "in-person", "both"]
    teaching_format: enum ["1:1", "group", "both"]
    assessment_style: string
}
created_at: datetime
updated_at: datetime
```

### Invitation
```
id: string (UUID)
email: string
token: string (unique)
invited_by: string (user_id, must be admin)
status: enum ["pending", "accepted", "expired"]
created_at: datetime
expires_at: datetime
```

### Prompt
```
id: string (UUID)
user_id: string (FK → User)
name: string
language: enum ["fr", "en"]
tags: string[]
blocks: JSON [{
    technique: enum ["context", "examples", "constraints", "steps", "think_first", "role"]
    content: string
    annotation: string (Study Mode explanation)
    order: number
}]
model_recommendation: string (e.g., "Gemini Pro", "Gemini Flash")
model_recommendation_reason: string
source_type: enum ["from_scratch", "from_source"]
is_template: boolean (false for user prompts, true for community templates)
template_id: string | null (FK → Prompt, if created from a template)
created_at: datetime
updated_at: datetime
```

### Refinement (for "Result wasn't good?" flow)
```
id: string (UUID)
prompt_id: string (FK → Prompt)
issue_type: enum ["too_hard", "too_long", "too_generic", "off_topic", "wrong_level", "other"]
issue_description: string | null
sample_output: string | null (pasted LLM output)
revised_prompt_id: string (FK → Prompt, the new version)
created_at: datetime
```

> ⚠️ OPEN QUESTION: Should we version prompts (keep history of edits) or just overwrite? Versioning adds complexity but lets teachers see how their prompt evolved. Decision: overwrite for v1, consider versioning in v1.1.

---

## Technical Architecture

### Stack
- **Frontend:** Cloudflare Pages (static site, likely SvelteKit or Astro — TBD based on developer preference)
- **API:** Cloudflare Pages Functions (Workers)
- **Database:** Cloudflare D1 (SQLite at the edge)
- **Cache/Sessions:** Cloudflare KV
- **LLM Provider:** OpenRouter (primary, targeting GLM 4.7/5 and similar cheap powerful models)
- **Email:** Resend (invitations, password reset)
- **Domain:** promptomatik.com

> ⚠️ OPEN QUESTION: Frontend framework choice. SvelteKit is lightweight and fast on Cloudflare Pages. Astro with React islands is another option. Or plain React with Vite. Decision should be made based on developer comfort and block editor library availability.

### LLM Integration

The app makes 2-3 LLM calls per prompt generation session:

1. **Intent Analysis** — Parse the free-text input, extract entities (level, topic, activity type, etc.), determine what's missing
2. **Interview Questions** — Generate adaptive follow-up questions based on what's missing (with clickable options where possible)
3. **Prompt Assembly** — Generate the final structured prompt with technique blocks, annotations, and model recommendation

All calls go through OpenRouter. System prompts are in English (for optimal LLM performance) but explicitly instruct the model to produce **natively idiomatic French** (not translated-from-English) when the user's language is French.

> 💡 DECISION: Internal system prompts in English for quality. User-facing output in the user's chosen language. The French output must feel native — proper instructional French, not robotic translation.

### Auth Flow

```
Admin sends invite → email with unique token link
    → User clicks link → registration page (name, password)
    → Account created with role: "teacher"
    → Login: email + password → session token stored in KV
    → All subsequent requests authenticated via session cookie
```

No Google login in v1. No open registration. Invite-only.

> 💡 DECISION: Invite-only for v1. The user model has a `role` field ready for future tier expansion (free, pro, etc.).

---

## Bilingual Strategy

- UI is fully bilingual (FR/EN), switchable by user preference
- All labels, buttons, explanations, Study Mode annotations: both languages
- Generated prompts are in the user's chosen language
- Interview questions are in the user's chosen language
- Internal system prompts to the LLM are in English (for quality), with explicit instructions to produce natural output in the target language
- i18n approach: JSON translation files, one per language

> ⚠️ OPEN QUESTION: How to handle a teacher who teaches English but prefers a French UI? The UI language and the prompt output language might differ. Consider: UI language = user preference, prompt language = selected per prompt.

---

## Model Recommendation Engine

After generating a prompt, the app recommends which LLM model to use:

- **Complex reasoning tasks** (lesson plans with multiple steps, needs analysis) → "Use a thinking model: Gemini Pro, or enable 'thinking' in AI Studio"
- **Simple generation** (vocab lists, short exercises) → "Gemini Flash is fine for this"
- **Long source documents** (transcripts, articles) → "Use a model with a large context window"
- **Creative tasks** (roleplay scripts, dialogues) → "Higher temperature recommended"

Recommendations are generated by the LLM as part of the prompt assembly step, based on the prompt's complexity and technique blocks used.

> 💡 DECISION: Start with Gemini-specific recommendations since that's what Module 1 teaches. Add model-agnostic tips over time.

---

## Community Template Library (Seed Content)

Initial templates curated by Greg, organized by job-to-be-done:

1. **"Full lesson from article/transcript"** — For when teacher has a source document
2. **"Vocabulary + exercises"** — Extract or generate vocab with practice activities
3. **"Roleplay / dialogue"** — Professional or everyday scenarios
4. **"Assessment / rubric"** — Tests, evaluation grids, feedback phrases
5. **"Needs analysis + learning plan"** — For first sessions with new students
6. **"Simplified podcast"** — Ties back to Module 1 (simplify a source for a target level)
7. **"Grammar explanation + practice"** — Contextualized grammar for specific industries

Each template has:
- Name, description, tags
- Pre-filled blocks (some techniques pre-populated, others left for interview)
- Recommended use case

> 💡 DECISION: Templates always require customization via interview. This ensures quality and teaches the user.

Future: templates can feed into a newsletter ("Prompt of the Week") linking back to the app. Content marketing + retention loop.

---

## Error Handling

- **LLM timeout (>15s):** Show spinner with "Generating your prompt..." message. If >30s, show "This is taking longer than usual. Please wait or try again."
- **LLM failure:** Friendly message: "Our AI assistant is temporarily unavailable. Please try again in a few minutes." No technical jargon.
- **Auth errors:** Redirect to login. Expired invites show "This invitation has expired. Contact your trainer for a new one."
- **Save failures:** Auto-save with retry. If persistent, show "Changes couldn't be saved. Please check your connection."

> ⚠️ OPEN QUESTION: No LLM fallback chain in v1 (deferred). If OpenRouter is down, the app is down. Acceptable risk for a training cohort tool.

---

## Security & Privacy

- Passwords hashed with bcrypt (or Argon2 if available on Workers)
- Session tokens in HttpOnly cookies, SameSite=Strict
- All API routes authenticated (except invite acceptance and login)
- Admin routes require role: "admin"
- No PII stored beyond email and name
- Prompts are private to each user (no cross-user access except templates)
- LLM calls go through OpenRouter — review their data policy. No student data should be sent to the LLM (prompts are about lesson structure, not individual students)

> 💡 DECISION: No student data flows to the LLM in v1 (student cards deferred). When student cards are added in v1.1, student info will be injected into prompts — at that point, review privacy implications with OpenRouter's data handling.

---

## Out of Scope (v1)

- Student cards / learner profiles (v1.1)
- LLM fallback chain — OpenRouter → Gemini → error (v1.1)
- Rate limiting — prompts per user per day (v1.1)
- Google login / OAuth (v1.1)
- In-app prompt execution ("Run this prompt") (v1.1+)
- Export to Google Docs / PDF / Markdown (v1.1+)
- User-submitted community templates (v1.1+ with moderation)
- Analytics / usage tracking (lives in community platform)
- Mobile app (responsive web is sufficient)
- Prompt versioning / edit history (v1.1)
- Free tier / public access (future)

---

## v1.1 Roadmap (Post-Launch)

Prioritized by impact:

1. **Student Cards** — Save learner profiles, auto-inject into prompts. Killer feature for 1:1 teachers with 15-20 students. Interview should offer to save new student info discovered during prompt building.
2. **Rate Limiting** — ~20 prompts/user/day via Cloudflare KV. Protects costs.
3. **LLM Fallback Chain** — OpenRouter → Gemini API → graceful error. Improves reliability.
4. **Google Login** — Easier onboarding for teachers.
5. **Export** — Google Docs, PDF, Markdown/Obsidian. Teachers live in docs.
6. **Prompt Versioning** — Edit history so teachers can see how prompts evolved.
7. **User-submitted Templates** — With moderation flow for Greg.

---

## Success Criteria

The app is successful if:

1. A teacher can go from "I need a lesson about X" to a copy-ready prompt in **under 3 minutes**
2. The prompt, when pasted into Gemini/ChatGPT/Claude, produces a **noticeably better result** than what the teacher would have written freehand
3. Teachers **save and reuse** prompts (indicator: average user has 5+ saved prompts after 2 weeks)
4. Study Mode is **used during Module 2 training** — Greg can screen-share and walk through technique blocks live
5. Teachers report that the app **reduces their prep time** without sacrificing lesson quality
