# Restore attachments alongside the ready-to-use library

## Cause

Production version `3cb31714-a626-4ea6-a404-3a27d0ef3e65` (11 September,
13:27 UTC) served the exact client build from Claude's library worktree.
That worktree contained the reviewed template cards and theme filtering but
not the uncommitted document-attachment implementation in the main checkout.
GitHub main was `ea74bda` and also lacked that implementation.

## Recovery scope

Fast-forward the existing main checkout to `ea74bda`, then record the recovered
attachment implementation on top. Keep both the template-card editor and the
attachment reminder in the prompt view, and both sets of translations and
migrations. Restore the attachment routes, document context propagation,
extraction, expiry handling and hourly cleanup.

The release preserves the production model names: Sonnet 4.6 and Kimi K2.5.
The recovered interview implementation tries the configured primary first for
both tiers. Routing tests inject model names rather than depending on secrets
or machine-local model configuration.

Other pre-existing local audio, performance and model-setting edits remain in
the working directory. They are not part of this attachment recovery commit.
Build the committed tree in isolation when publishing this recovery; running
the deployment script directly in the dirty development checkout would include
those unrelated edits.

## Validation

- Isolated release tree: all 48 Vitest files, 881 tests, plus 3 existing layout
  checks pass. There is no standalone lint command. Diff whitespace checks pass.
- TypeScript and both Vite production builds pass. The pre-existing large client
  bundle warning remains; the local performance work is a separate change.
- `wrangler deploy --dry-run` passes against the generated release configuration.
- `wrangler dev --local` serves health successfully and rejects unauthenticated
  attachment creation with HTTP 401.
- `npm run test:prompts` passes against the release at 390 and 1440 pixels:
  upload/remove a file without losing the request, browse the reviewed card by
  theme, copy the template and reopen it with the attachment reminder intact.
  Browser API calls use fixtures; no real users or paid AI calls are involved.
- The same browser test fails against the previously deployed Claude build
  because the document picker is absent, demonstrating the original regression.
- The Workers integration workflow also checks real extraction, interview jobs,
  saving, card review, publication, template listing, copying and reopening with
  the attachment requirements preserved. AI responses are mocked.
- Read-only production checks confirm both attachment tables and the
  `prompts.template_card` column already exist. No production migration was run.

One existing transcription test assumes two provider credentials are configured.
The isolated test environment supplies non-secret placeholder values for
Deepgram and AssemblyAI; its provider collaborators are mocked. An initial run
without those placeholders failed that configuration-dependent test.

## Publication

Push the recovery commit to main and deploy its tested build after Greg's
publication approval. Verify the live client matches the build, the attachment
route is present, and both the hourly attachment and daily transcription
cleanup schedules are installed. The local ignored file
`.tmp/attachment-release-path` records the prepared release directory.
