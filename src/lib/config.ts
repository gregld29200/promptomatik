/**
 * Where the upgrade gate sends free-tier users. Swap for the dedicated
 * training landing page when it exists — one-line change, UTM params let
 * the funnel measure lead-magnet → training conversion.
 */
export const UPGRADE_CTA_URL =
  "https://www.teachinspire.me?utm_source=promptomatik&utm_medium=upgrade_gate&utm_campaign=free_tier";

/** Mirror of the backend free-tier library cap — display only. */
export const FREE_LIBRARY_LIMIT = 3;

/**
 * The private training space (participants only). Never branded by its
 * hosting provider in the UI — always "espace formation".
 */
export const COMMUNITY_URL = "https://community.teachinspire.me";
