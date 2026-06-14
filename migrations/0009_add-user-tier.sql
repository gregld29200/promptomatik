-- Tiered access: 'free' (email lead magnet) vs 'participant' (full product).
-- Orthogonal to role — an admin bypasses tier gates regardless of tier value.

ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'
  CHECK (tier IN ('free', 'participant'));

-- Backfill: all existing users were invited manually for the training.
UPDATE users SET tier = 'participant';
