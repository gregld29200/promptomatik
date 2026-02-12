import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth } from "../lib/auth-middleware";
import type { SessionData } from "../lib/session";

export interface TeacherProfile {
  languages_taught: string[];
  typical_levels: string[];
  typical_audience: string[];
  typical_duration: string;
  teaching_context: string;
  setup_completed: boolean;
  onboarding_completed: boolean;
  onboarding_version: number;
  profile_onboarding_completed: boolean;
  profile_onboarding_version: number;
}

const EMPTY_PROFILE: TeacherProfile = {
  languages_taught: [],
  typical_levels: [],
  typical_audience: [],
  typical_duration: "",
  teaching_context: "",
  setup_completed: false,
  onboarding_completed: false,
  onboarding_version: 0,
  profile_onboarding_completed: false,
  profile_onboarding_version: 0,
};

type ProfileEnv = { Bindings: Env; Variables: { session: SessionData } };

const profile = new Hono<ProfileEnv>();

profile.use("/*", requireAuth);

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  return [];
}

function normalizeProfile(raw: unknown): TeacherProfile {
  const parsed = (raw && typeof raw === "object" ? raw : {}) as Partial<TeacherProfile> & {
    typical_audience?: string[] | string;
  };

  return {
    ...EMPTY_PROFILE,
    ...parsed,
    languages_taught: normalizeStringArray(parsed.languages_taught),
    typical_levels: normalizeStringArray(parsed.typical_levels),
    typical_audience: normalizeStringArray(parsed.typical_audience),
    typical_duration: typeof parsed.typical_duration === "string" ? parsed.typical_duration : "",
    teaching_context: typeof parsed.teaching_context === "string" ? parsed.teaching_context : "",
  };
}

// GET /api/profile — Fetch current user's profile
profile.get("/", async (c) => {
  const session = c.get("session");

  const row = await c.env.DB.prepare("SELECT profile FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ profile: string }>();

  if (!row) {
    return c.json({ error: "User not found" }, 404);
  }

  const parsed = normalizeProfile(JSON.parse(row.profile));
  return c.json({ profile: parsed });
});

// PUT /api/profile — Update profile (merge, not replace)
profile.put("/", async (c) => {
  const session = c.get("session");
  const input = await c.req.json<Partial<TeacherProfile> & { typical_audience?: string[] | string }>();

  // Fetch existing profile
  const row = await c.env.DB.prepare("SELECT profile FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ profile: string }>();

  if (!row) {
    return c.json({ error: "User not found" }, 404);
  }

  const existing = normalizeProfile(JSON.parse(row.profile));

  // Merge — only overwrite fields that are present in input
  const merged: TeacherProfile = {
    languages_taught:
      input.languages_taught !== undefined
        ? normalizeStringArray(input.languages_taught)
        : existing.languages_taught,
    typical_levels:
      input.typical_levels !== undefined
        ? normalizeStringArray(input.typical_levels)
        : existing.typical_levels,
    typical_audience:
      input.typical_audience !== undefined
        ? normalizeStringArray(input.typical_audience)
        : existing.typical_audience,
    typical_duration: input.typical_duration ?? existing.typical_duration,
    teaching_context: input.teaching_context ?? existing.teaching_context,
    setup_completed: input.setup_completed ?? existing.setup_completed,
    onboarding_completed: input.onboarding_completed ?? existing.onboarding_completed,
    onboarding_version: input.onboarding_version ?? existing.onboarding_version,
    profile_onboarding_completed:
      input.profile_onboarding_completed ?? existing.profile_onboarding_completed,
    profile_onboarding_version:
      input.profile_onboarding_version ?? existing.profile_onboarding_version,
  };

  await c.env.DB.prepare(
    "UPDATE users SET profile = ?, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(JSON.stringify(merged), session.userId)
    .run();

  return c.json({ profile: merged });
});

export { profile };
