-- Tracks the HTTP status of the last TTS provider error hit while generating
-- a segment (429 rate-limited, 5xx/524 gateway), even when a retry eventually
-- succeeded. Lets the admin dashboard surface upstream rate-limit pressure
-- before it turns into visible job failures.
ALTER TABLE audio_segments ADD COLUMN last_error_status INTEGER;
