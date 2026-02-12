-- Replace model_recommendation columns with tips
-- SQLite doesn't support DROP COLUMN before 3.35.0, but D1 does.
-- Adding tips column; old columns can be ignored (SELECT * still works).

ALTER TABLE prompts ADD COLUMN tips TEXT NOT NULL DEFAULT '[]';
