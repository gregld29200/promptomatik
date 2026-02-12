# Quickstart: Building Promptomatik with Compound Engineering

## Setup

1. **Create the repo:**
   ```bash
   mkdir promptomatik && cd promptomatik
   git init
   ```

2. **Copy these files into your repo:**
   - `CLAUDE.md` → root (agent reads this every session)
   - `spec.md` → root (full specification)
   - `README.md` → root
   - `.env.example` → root
   - `docs/brainstorms/001-promptomatic-v1.md` → brainstorm from our interview
   - `docs/plans/001-v1-implementation-plan.md` → high-level plan

3. **Make sure compound engineering is installed:**
   ```bash
   claude /plugin marketplace add EveryInc/every-marketplace
   claude /plugin install compound-engineering
   ```

## Build Sequence

### Step 1: Deepen the plan
```bash
claude
> /workflows:plan Set up Cloudflare Pages project with SvelteKit, D1 database schema, KV sessions, invite-only auth, and admin dashboard. See spec.md for full requirements.
```
Review the plan. Approve it.

### Step 2: Build the foundation
```bash
> /workflows:work
```
Let it run. Review the PR.

### Step 3: Plan the core feature
```bash
> /workflows:plan Build the interview engine: natural language input → OpenRouter intent analysis → adaptive follow-up questions (ask_interviewer style with clickable options) → structured prompt generation using the 6 prompting techniques. Must support bilingual FR/EN. See spec.md for flows.
```

### Step 4: Build it
```bash
> /workflows:work
```

### Step 5: Review
```bash
> /workflows:review
```

### Step 6: Compound (DON'T SKIP)
```bash
> /workflows:compound
```
This documents what worked, what didn't, and updates the system for next time.

### Repeat for each phase:
- Phase 3: User Mode + Study Mode + Block Editor
- Phase 4: Teacher Profiles + Prompt Library + Templates + Refinement
- Phase 5: Polish + Deploy

## Tips

- **Read the plan before approving.** The plan is where 80% of quality comes from.
- **Test French output early.** Don't wait until polish phase — the bilingual LLM prompts need iteration.
- **Seed templates early.** Greg needs to write 5-7 real template prompts for the community library.
- **CLAUDE.md is alive.** After every `/workflows:compound`, update CLAUDE.md with learnings.

## The 3 Questions

Before approving any AI output, ask:
1. "What was the hardest decision you made here?"
2. "What alternatives did you reject, and why?"
3. "What are you least confident about?"
