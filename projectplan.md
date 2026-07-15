# Project Plan — Home hub UI fixes (/web-design-guidelines review)

Previous plan (Tiered Access) is complete — all steps checked off; see git history.

Scope: the post-login hub page shown in the screenshot — [src/pages/home.tsx](src/pages/home.tsx) + [src/pages/home.module.css](src/pages/home.module.css). Reviewed against Web Interface Guidelines (vercel-labs, fetched 2026-07-15).

---

## Review findings

### src/pages/home.module.css

- `home.module.css:100` — `.recentLabel` is a flex child without `min-width: 0`, so `text-overflow: ellipsis` never kicks in → long prompt titles paint past the card edge (visible in the screenshot: "24-Hour B1→B2 English Training Program…"). **The one real bug.**
- `home.module.css:171` — `.cardLink` has no `hover:` state (guideline: interactive elements need visual feedback).
- `home.module.css:17` — `.title` missing `text-wrap: balance` (heading widows).
- `home.module.css:13,27,74,97,111,…` — stale hardcoded hex fallbacks that drift from tokens.css (`#b0623c` vs `--color-terracotta-600: #bf4e36`, `#688889` and `#f1d263` aren't tokens at all). Project convention: tokens only.
- `.card`, `.cardIcon`, `.cardCta`, `.lockBadge`, `.recentRow` are all sharp squares while every other page (dashboard, library) uses `--radius-*` tokens → visual inconsistency across the app.
- Spacing/font sizes hardcoded in rem (`1.3rem 1.4rem`, `0.88rem`…) instead of `--space-*` / `--text-*` tokens.

### src/pages/home.tsx

- `home.tsx:71` — `prompt.name` rendered with no fallback; an empty name yields a blank row (dashboard.tsx:393 uses the `|| "Untitled"` pattern).
- Passing items: decorative icons have `aria-hidden` ✓, icon-only buttons n/a, headings hierarchical (h1→h2) ✓, external links `rel="noreferrer"` ✓, skeleton honors `prefers-reduced-motion` ✓, global `:focus-visible` outline applies ✓.

---

## Todo

- [x] 1. Fix title overflow: `min-width: 0` + `flex: 1` on `.recentLabel`
- [x] 2. Replace stale hex fallbacks with design tokens (no hardcoded colors)
- [x] 3. Apply `--radius-*` tokens to card, icon chip, CTA, lock badge, recent rows — align with the rest of the app
- [x] 4. Add hover state to `.cardLink`; `text-wrap: balance` on `.title` and card headings
- [x] 5. `home.tsx`: fallback label for empty prompt names
- [x] 6. Verify in browser (dev server) with before/after screenshots

Every change is CSS-local to the home page plus one one-line TSX fallback — minimal blast radius.

---

## Review

**Changed files:** `src/pages/home.module.css` (rewritten, all tokens), `src/pages/home.tsx` (one line).

- **Overflow bug fixed** — `.recentLabel` got `flex: 1; min-width: 0`, so long titles now truncate with an ellipsis inside the card instead of painting past its edge.
- **Premium pass, on-token** — cards now use `--radius-lg` + `--shadow-sm` with a subtle gold radial wash and a hover lift (`--shadow-card-hover`, translateY(-2px), disabled under `prefers-reduced-motion`); icon chips are gold-tinted squares; CTAs are pill buttons matching the shared Button component; the community card gets a navy gradient with a gold-glow corner; the lock badge is a gold pill. Header title upgraded to `--text-4xl` with Fraunces WONK/opsz settings to match the dashboard greeting.
- **Guideline fixes** — hover state on `.cardLink`, `text-wrap: balance` on headings, `text-wrap: pretty` on the subtitle, recent rows get a rounded gold-50 hover surface.
- **Tokens only** — every stale hex fallback (`#b0623c`, `#688889`, `#f1d263`…) replaced with `tokens.css` variables; spacing/type moved to `--space-*`/`--text-*`.
- **`home.tsx:71`** — empty prompt names fall back to "Untitled" (same pattern as dashboard.tsx).

**Verification:** `npm run build` ✓, `npm test` 112/112 ✓, visual check in Chrome against local wrangler dev (seeded admin) — full page screenshotted, truncation and all four card variants confirmed.

---

## Addendum — TeachInspire Studio wordmark (approved option A)

The nav showed the Promptomatik logo, wrong for the multi-module studio. Replaced with a stacked typographic wordmark and moved the Promptomatik brand into its own module.

- `shell.tsx` — `/logo.webp` image replaced by a text wordmark: "TeachInspire" (Fraunces, cream) over "STUDIO" (small caps, gold, letterspaced), `translate="no"`.
- `shell.module.css` — new `.logoName`/`.logoStudio` styles, `.logoImg` removed, mobile size adjustment.
- `dashboard.tsx` + `dashboard.module.css` — "PROMPTOMATIK" eyebrow (terracotta, same treatment as the hub's "TEACHINSPIRE STUDIO") above the prompt-library greeting.
- Existing script logo from teachinspire-docs was rejected: navy "TEACH" disappears on the navy bar, teal script clashes with the palette (mock shown to Greg).
- Verified live on wrangler dev: nav wordmark on /home, eyebrow on /prompts. Build ✓, 112/112 tests ✓. Note: stale workerd on :8787 served the old asset manifest after rebuild — kill workerd + restart wrangler dev when assets 404-fallback to index.html.

## Addendum 2 — Auth pages rebrand + production deploy (2026-07-15)

- Auth pages (login, register incl. invalid-invite state, forgot-password, reset-password): headline "Promptomatik" → "TeachInspire" with a gold `STUDIO` tag (`.studioTag`, gold-600 for light-surface contrast, `translate="no"`).
- Removed now-unused `public/logo.webp` and `public/logo.png`.
- Added `account_id` to `wrangler.jsonc` — first deploy attempt targeted a wrong Cloudflare account (wrangler OAuth had 2 unrelated accounts; it auto-provisioned an empty R2 bucket there, deleted after verification). Production lives in account `d10290b8…`; wrangler must be logged in with that identity.
- Deployed twice to production (versions `d5bb2bd3` hub/wordmark, `c0bfbe6a` auth rebrand) — studio.teachinspire.me + promptomatik.com, all queue bindings intact. Verified live: bundle hash matches local build; login page screenshotted in production.
- Gotcha (recurring): after `npm run build`, a still-running wrangler dev serves the old asset manifest and new hashed assets fall back to index.html (blank app, empty #root). Restart wrangler dev — and check for orphaned `workerd` holding :8787.
