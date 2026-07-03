-- Records which TTS model actually produced each segment. A single job can now
-- mix models when the fallback chain kicks in (e.g. Pro segment 1, then 2.5
-- Flash segment 2 after a rate limit), so per-segment cost must be summed with
-- each block's real model price rather than one price for the whole job.
ALTER TABLE audio_segments ADD COLUMN model_used TEXT;
