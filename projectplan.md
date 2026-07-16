# Project Plan — Documents: deterministic simple mode, production readiness

Previous plan (simple mode + templates + copy) is complete — see archive below and git history.

## Goal

Make the simple-document path fully deterministic and pass the production release gate. Key decision (Greg + audit, 2026-07-16): **formatting-only must become code, not AI judgement.**

Audit findings driving this plan:
- The renderer is already deterministic once it has structure + source + vocabulary + template; the remaining drift is the LLM call (temp 0.15) that classifies headings/paragraphs/lists.
- `## Heading` is preserved literally — Markdown behavior is undefined.
- The simple renderer imports Google Fonts over the network at PDF time; Poppler's Splash renderer reports invalid Type 3 font bounds (black blocks). Also a determinism + GDPR concern (project convention is self-hosted fonts).

## Todo

- [x] 1. **Local structure parser** (`worker/lib/documents/simple-structure.ts`): blank-line chunking, per-chunk grouping into heading / paragraph / bullet_list / numbered_list, deterministic title fallback, bold phrases from the vocabulary field only. Produces the same `SimpleTransformMaterial` shape the renderer already consumes.
- [x] 2. **Markdown behavior (defined)**: `#`–`######` heading markers force a heading and are stripped at render + copy; `-`/`*`/`•` and `1.`/`1)` list markers are recognized (already); inline `**bold**`/`*italic*` render as emphasis (already). Everything else is plain text.
- [x] 3. **LLM for explicit additions only**: no `customRequest` (or no recognized addition) → zero LLM calls. A recognized request ("add a word bank", "3 questions"…) → narrow additions-only LLM call returning just the added blocks; the source layout stays locally determined. Directive prompt/schema removed.
- [x] 4. **Regression fixtures**: the real production supplier-performance source + vocabulary as `worker/lib/documents/fixtures/supplier-performance.json`; `simple-structure.test.ts` asserts exact line coverage/order, heading/list classification, bold phrases, identical HTML across 3 runs, no unrequested blocks, no duplicate title, no page footer; `documents-structured-output.test.ts` asserts zero LLM calls on the default path.
- [x] 5. **Font portability**: root cause confirmed — Google css2 serves *variable* fonts, and Chromium's PDF backend writes non-default variable instances as Type 3 glyphs (Splash black blocks); locally the fonts silently fell back to Georgia/Helvetica (CDN race = nondeterministic PDFs). Fix: static latin WOFF2 instances (@fontsource) embedded as base64 data URIs via generated `fonts.generated.ts` (`npm run docs:fonts`), used by both renderers. `pdffonts` now shows CID TrueType subsets only; Splash renders all 3 templates cleanly.
- [x] 6. **Release gate (local half)**: 150/150 tests, build clean, `docs:breaks` harness 0 violations, 3 authenticated repeatability runs through the real local worker queue → byte-identical HTML (same MD5), structure equal to production ground truth, embedded fonts confirmed in served HTML. Local PDF route can't run (wrangler 4.64 local Browser Rendering returns "405 Not implemented" — pre-existing); PDF verified via the local-Chrome print pipeline instead. **Remaining: deploy (needs Greg's go) + one production generation + PDF inspection in PDFium and Cairo.**

## Review

- **Determinism**: `callLLM` in simple mode builds the material entirely in code (`buildSimpleMaterial`); the local parser reproduces the verified production supplier-performance structure exactly. Three end-to-end runs through D1 + queue + renderer produced byte-identical documents.
- **LLM scope**: only an explicitly recognized addition request triggers a single narrow call returning `{ additions: [...] }` (strict JSON schema `teachinspire_simple_additions`), filtered to the requested types. Everything else — structure, title, bold vocabulary, template — is code.
- **Fonts**: no runtime network dependency in either renderer; 16 static faces, ~342 KB base64 (worker bundle ~1.9 MB raw). Regenerate with `npm run docs:fonts` after fontsource upgrades.
- **Markdown contract** (user-visible behavior, deliberate): heading markers `#`–`######` are honored and stripped in both HTML and copied text; list markers and inline `**`/`*` emphasis honored; all other text verbatim.
- **Production verification (2026-07-16, version `695f6750`)**: authenticated supplier-fixture generation on studio.teachinspire.me completed with structure/bolding equal to ground truth and zero additions; production HTML byte-identical (same MD5) to the three local-queue runs; PDF is one quiet A4 page with only CID TrueType subsets (`pdffonts` — no Type 3), rendered cleanly by Poppler **Splash** (previously black blocks), **Cairo**, and Chrome **PDFium**. Simple generations now complete in ~1s (no LLM).

---

# Archived — Documents: "Simple document" mode + clean copy (complete)

Previous plan (Home hub UI fixes + Studio wordmark + auth rebrand) is complete — all steps checked off; see git history.

## Problem

Greg pasted a reading text into Documents, chose the **custom** output intent, asked for a single simple handout — and got a full 3-material lesson (comprehension quiz, matching, role play) anyway.

Root cause: the pipeline can *only* produce lesson bundles.

- [worker/lib/documents/system-prompt.ts:14](worker/lib/documents/system-prompt.ts) — "Return exactly 3 materials", with a hard bundle target (reading / guided practice / freer practice) baked into both RAW_CONTENT and STRUCTURED prompts.
- [worker/lib/documents/input-context.ts:212](worker/lib/documents/input-context.ts) — `custom` intent maps to "a 3-document custom bundle"; the user's custom request is a single appended line the model can't honor against the hard rules.
- [worker/lib/documents/generate.ts:174](worker/lib/documents/generate.ts) — normalization slices to 3; the retry prompt re-demands "exactly 3 materials".

## Design decision (validated with Greg, 2026-07-15)

Two explicit paths, chosen up front — the teacher stays in charge:

1. **Simple document** (new): the app formats the teacher's own content into one clean, print-ready material. It does NOT add questions, exercises, or activities unless the teacher explicitly asks in the optional request field. Inverse Rule Zero: "structure and present, don't teach."
2. **Lesson bundle** (existing): the current 3-material generator, untouched.

Plus, on every generated material regardless of path: a **"Copy as text"** button that yields clean plain text/markdown (no HTML/JSON) so teachers can take the content into Word/Docs and own it. TeachInspire principle: never a prisoner of the app.

Rejected alternatives: prompt-tweaking `custom` (fragile — the whole prompt is bundle-shaped); a 0–3 scaffolding slider (more UI, more edge cases; binary matches how teachers think).

## Todo

- [x] 1. **Worker — mode plumbing.** Add `mode: "simple" | "lesson"` (default `lesson`) through the request type, runtime validation, job payload, and LLM call.
- [x] 2. **Worker — simple-mode prompt.** New short system prompt in [system-prompt.ts](worker/lib/documents/system-prompt.ts): same block types + JSON contract, but "return exactly 1 material", content fidelity, no invented exercises/questions/activities unless the user request asks; optional light touches (title, word bank) only on request.
- [x] 3. **Worker — validation.** In [generate.ts](worker/lib/documents/generate.ts), accept 1 material in simple mode (keep exactly-3 for lesson mode); adjust normalization and retry prompts per mode. Renderer/PDF pipeline remains per-material.
- [x] 4. **UI — mode choice first.** In [src/pages/documents.tsx](src/pages/documents.tsx): a two-option choice at the top of the form ("Simple document" / "Lesson bundle") using the existing `ChoiceButtons` component. Simple mode hides the bundle intent selector and shows only: source content, optional title/level, optional request textarea. EN/FR strings; ES continues to use the project's existing EN fallback for the Documents section.
- [x] 5. **UI — "Copy as text".** Blocks→plain-text serializer in `src/lib/`, copy button on each generated material in results and preview, with success/error feedback. Works for both modes.
- [x] 6. **Tests.** Regression coverage for simple-mode prompt/count behavior, invalid modes, duplicate-title rendering, and all supported block families in the plain-text serializer.
- [x] 7. **Verify locally.** On `wrangler dev`, exercise the simple-mode request payload with a mocked response, open a completed one-material job, verify preview/copy behavior, and re-check the existing three-material result at desktop and mobile widths. No live external LLM request was made.

Blast radius: one new system prompt + a mode flag through existing seams; no schema/renderer changes. Lesson path behavior is untouched.

## Decisions (Greg, 2026-07-15)

- `custom` stays in the bundle selector (for custom bundles); "Simple document" is the new top-level path.
- Copy format: **plain text** — teachers shouldn't need to know what markdown is.

## Review

- **Worker:** `mode` defaults to `lesson`, so old clients keep the existing three-material behavior. Simple mode uses its own fidelity-first prompt and expects one `clean_handout`.
- **Output safety:** both copied text and rendered HTML suppress a repeated article title when it matches the material title. Lesson materials with a distinct article title remain unchanged.
- **UI:** the mode is the first choice, path-specific requests are cleared when switching paths, selections expose `aria-pressed`, and Copy is available in results and preview. Single-document and three-document action layouts are responsive without overflow.
- **Verification:** `npm test` (119/119), `npm run build`, and `git diff --check` pass. Browser QA passed at 1280 px and 375 px with no console/runtime errors. The only build note is the existing Vite chunk-size warning.

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

## Addendum 3 — Simple document fidelity + content-first rendering (2026-07-15)

The first production handout exposed a second problem: Simple mode used the lesson renderer, printed Markdown markers literally, invented lesson metadata, and produced a floating branded footer plus a mostly empty second page.

- The teacher's submitted source is now the immutable document body. The model returns presentation directives only: a title, exact source lines to treat as headings, exact source phrases to bold, and explicitly requested additions.
- The worker validates every heading and bold phrase against the submitted source. It filters generated additions by the request, so a bold-only request cannot add questions or exercises.
- `clean_handout` now selects a dedicated content-first renderer: white print background, title-only header, restrained headings, real lists, safe bold/italic rendering, no lesson chips, Name/Date line, cards, drop caps, duplicate headings, preset stamp, or internal material-type footer.
- PDF export sets the real document title, respects A4 CSS sizing, and uses a quiet page-number-only footer instead of normal-flow branding.
- Simple mode hides Level, Target language, focus/interaction/duration/style metadata, uses “Format document,” and offers “Adjust formatting” with the original source restored. EN/FR guide and dashboard claims now describe both Simple document and Lesson bundle accurately.
- Copy text uses the immutable source and removes inline formatting markers. Previously completed handouts without `source_text` continue through the legacy-block fallback.
- Lesson bundles retain the existing three-material schema, renderer, metadata, and actions.

Verification: 17 test files / 127 tests pass; production build passes; desktop and 375 px browser QA pass with no runtime errors. The supplier-performance fixture renders on one balanced page with the requested vocabulary bold, real section headings and list bullets, no literal `**`, and correct PDF title metadata. Production deployment remains a separate, explicit action.

## Addendum 4 — Premium teacher-owned templates (2026-07-15)

The second supplier-performance PDF proved that content fidelity alone was not enough: the text was preserved, but normal pasted line breaks collapsed into a flat page with weak hierarchy, no semantic list, unreliable vocabulary emphasis, and little classroom appeal.

- Simple mode now separates immutable teacher text, a validated structural map, and a presentation-only template. The model returns line IDs for headings, paragraphs, bullet lists, and numbered lists; the worker requires every non-empty source line exactly once and in order.
- A later section heading is no longer removed merely because it resembles the document title. Only the opening duplicate title is suppressed.
- Teachers get a dedicated “Vocabulary to highlight” field. Exact comma/newline-separated phrases are validated against the source and merged ahead of model suggestions, so explicit emphasis is deterministic.
- Three CSS-only templates ship initially: **Editorial Reader**, **Classroom Handout**, and **Compact Professional**. They change typography, spacing, palette, and density without changing, regenerating, or charging for the content.
- The template picker appears before formatting and remains available on results and preview. A validated `?template=` presentation query switches existing and new completed jobs instantly; the PDF download uses the same selected template.
- One-page clean handouts suppress pagination. Multi-page handouts retain the quiet page-number footer. There are still no automatic brand panels, lesson metadata, Name/Date fields, or irrelevant running headers.
- The Documents page was kept below 500 lines by extracting the preview, simple options, template picker, and guide styling into focused modules.

Verification: full test/build gates, desktop and 375 px browser QA, accessible radio behavior, draft persistence, instant preview URL switching, and page-by-page Poppler inspection of all three A4 supplier-performance PDFs. All three templates fit the sample on one balanced page with real hierarchy, semantic bullets, and visible exact-term emphasis. Production deployment remains a separate, explicit action.
