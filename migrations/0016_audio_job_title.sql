-- User-defined take title (rename feature). NULL = fall back to the derived
-- script excerpt in the UI, exactly as before.
ALTER TABLE audio_jobs ADD COLUMN title TEXT;
