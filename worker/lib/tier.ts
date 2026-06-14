export const TIERS = ["free", "participant"] as const;

export type Tier = (typeof TIERS)[number];

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && TIERS.includes(value as Tier);
}

export function normalizeTier(value: unknown): Tier {
  return isTier(value) ? value : "free";
}

export async function getUserTier(db: D1Database, userId: string): Promise<Tier> {
  const row = await db.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId)
    .first<{ tier: string }>();
  return normalizeTier(row?.tier);
}
