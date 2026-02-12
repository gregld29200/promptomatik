# Promptomatik

> Craft better prompts in minutes, not hours.

Bilingual (FR/EN) prompt-builder for language teachers, companion app for [TeachInspire](https://teachinspire.me) Module 2.

## Stack

- React 19 + Vite 7
- Cloudflare Workers (SPA assets + Hono API in `worker/`)
- D1 (SQL) + KV (sessions)
- OpenRouter (LLM)
- Resend (email invitations/password reset)

## Local Setup

```bash
npm install
cp .env.example .dev.vars
# fill OPENROUTER_API_KEY, RESEND_API_KEY, APP_SECRET, APP_URL
# optional: OPENROUTER_MODEL, OPENROUTER_FALLBACK_MODEL
npm run db:migrate
npm run dev
```

## Deploy Setup (Cloudflare + Resend)

1. Set Cloudflare account context:
```bash
export CLOUDFLARE_ACCOUNT_ID=<your_account_id>
```
2. Create or reuse resources:
```bash
npx wrangler d1 create promptomatik-db
npx wrangler kv namespace create SESSIONS
npx wrangler kv namespace create SESSIONS --preview
```
3. Paste D1/KV IDs into `wrangler.jsonc`.
4. Set production secrets:
```bash
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put APP_SECRET
```
Optional model vars in `wrangler.jsonc`:
```jsonc
"vars": {
  "APP_URL": "https://promptomatik.com",
  "OPENROUTER_MODEL": "z-ai/glm-5",
  "OPENROUTER_FALLBACK_MODEL": "minimax/minimax-m2.5"
}
```
5. Verify Resend domain `promptomatik.com` and sender `noreply@promptomatik.com`.
6. Deploy:
```bash
npm run deploy
```

## Custom Domain

- Canonical app URL: `https://promptomatik.com`
- Worker `vars.APP_URL` in `wrangler.jsonc` is set to this value.
- In Cloudflare dashboard, attach `promptomatik.com` to the Worker and keep the DNS record proxied.

## License

Private - TeachInspire (c) 2026
