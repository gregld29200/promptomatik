# Promptomatic

> Craft perfect prompts in minutes, not hours.

A bilingual (FR/EN) prompt-builder for language teachers, powered by the 6 Effective Prompting Techniques. Companion app for [TeachInspire](https://teachinspire.me) Module 2.

## What it does

1. **Describe** what you need in natural language
2. **Refine** through a smart adaptive interview (3-6 questions)
3. **Get** a structured prompt built on proven techniques
4. **Study** how each part works (Study Mode) or just **copy** and go (User Mode)
5. **Save** and reuse your best prompts

## Stack

- Cloudflare Pages + D1 + KV
- OpenRouter (LLM)
- Resend (email)
- Bilingual: FR / EN

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Fill in: OPENROUTER_API_KEY, RESEND_API_KEY, D1 bindings

# Dev server
npm run dev

# Deploy
npm run deploy
```

## Project Structure

```
promptomatic/
├── CLAUDE.md              # Agent instructions & project context
├── spec.md                # Full project specification
├── docs/
│   ├── brainstorms/       # Discovery & ideation
│   ├── plans/             # Implementation plans
│   └── solutions/         # Compound learnings
├── todos/                 # Tracked work items
├── src/                   # Application source
└── functions/             # Cloudflare Pages Functions (API)
```

## Compound Engineering

This project uses the [compound engineering](https://every.to/guides/compound-engineering) workflow:

```
/workflows:plan    → Plan a feature
/workflows:work    → Implement the plan
/workflows:review  → Multi-agent code review
/workflows:compound → Document learnings
```

## License

Private — TeachInspire © 2025
