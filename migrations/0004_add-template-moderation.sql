-- Add prompt library moderation fields for official/community templates
ALTER TABLE prompts
  ADD COLUMN template_kind TEXT NOT NULL DEFAULT 'official'
  CHECK (template_kind IN ('official', 'community'));

ALTER TABLE prompts
  ADD COLUMN template_status TEXT NOT NULL DEFAULT 'approved'
  CHECK (template_status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_prompts_template_kind ON prompts(template_kind);
CREATE INDEX IF NOT EXISTS idx_prompts_template_status ON prompts(template_status);
