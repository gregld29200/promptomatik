-- Template card: the reader-facing "fiche" that explains a published template.
-- JSON { need, when, why, adapt[] } written at publish time (LLM draft, admin-reviewed).
-- Replay: `ADD COLUMN` has no IF NOT EXISTS, so the db:migrate link absorbs the
-- `duplicate column name` error with `|| true`, like the other ADD COLUMN migrations.
ALTER TABLE prompts ADD COLUMN template_card TEXT;
