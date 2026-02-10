import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth } from "../lib/auth-middleware";
import type { SessionData } from "../lib/session";

const prompts = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

prompts.use("/*", requireAuth);

interface PromptRow {
  id: string;
  user_id: string;
  name: string;
  language: string;
  tags: string;
  blocks: string;
  model_recommendation: string | null;
  model_recommendation_reason: string | null;
  source_type: string;
  is_template: number;
  template_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPrompt(row: PromptRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    language: row.language,
    tags: JSON.parse(row.tags),
    blocks: JSON.parse(row.blocks),
    model_recommendation: row.model_recommendation,
    model_recommendation_reason: row.model_recommendation_reason,
    source_type: row.source_type,
    is_template: row.is_template === 1,
    template_id: row.template_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// POST /api/prompts — Create a new prompt
prompts.post("/", async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{
    name: string;
    language?: string;
    tags?: string[];
    blocks: unknown[];
    model_recommendation?: string;
    model_recommendation_reason?: string;
    source_type?: string;
  }>();

  if (!body.blocks || !Array.isArray(body.blocks)) {
    return c.json({ error: "Blocks are required." }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  await c.env.DB.prepare(
    `INSERT INTO prompts (id, user_id, name, language, tags, blocks, model_recommendation, model_recommendation_reason, source_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      session.userId,
      body.name || "",
      body.language || session.languagePreference || "fr",
      JSON.stringify(body.tags || []),
      JSON.stringify(body.blocks),
      body.model_recommendation || null,
      body.model_recommendation_reason || null,
      body.source_type || "from_scratch",
      now,
      now
    )
    .run();

  return c.json(
    {
      prompt: {
        id,
        user_id: session.userId,
        name: body.name || "",
        language: body.language || session.languagePreference || "fr",
        tags: body.tags || [],
        blocks: body.blocks,
        model_recommendation: body.model_recommendation || null,
        model_recommendation_reason: body.model_recommendation_reason || null,
        source_type: body.source_type || "from_scratch",
        is_template: false,
        template_id: null,
        created_at: now,
        updated_at: now,
      },
    },
    201
  );
});

// GET /api/prompts — List user's prompts
prompts.get("/", async (c) => {
  const session = c.get("session");

  const result = await c.env.DB.prepare(
    "SELECT * FROM prompts WHERE user_id = ? ORDER BY updated_at DESC"
  )
    .bind(session.userId)
    .all<PromptRow>();

  return c.json({
    prompts: (result.results ?? []).map(rowToPrompt),
  });
});

// GET /api/prompts/:id — Single prompt (owned by user)
prompts.get("/:id", async (c) => {
  const session = c.get("session");
  const promptId = c.req.param("id");

  const row = await c.env.DB.prepare(
    "SELECT * FROM prompts WHERE id = ? AND user_id = ?"
  )
    .bind(promptId, session.userId)
    .first<PromptRow>();

  if (!row) {
    return c.json({ error: "Prompt not found." }, 404);
  }

  return c.json({ prompt: rowToPrompt(row) });
});

// PUT /api/prompts/:id — Partial update
prompts.put("/:id", async (c) => {
  const session = c.get("session");
  const promptId = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    tags?: string[];
    blocks?: unknown[];
  }>();

  // Verify ownership
  const existing = await c.env.DB.prepare(
    "SELECT id FROM prompts WHERE id = ? AND user_id = ?"
  )
    .bind(promptId, session.userId)
    .first<{ id: string }>();

  if (!existing) {
    return c.json({ error: "Prompt not found." }, 404);
  }

  const sets: string[] = [];
  const values: (string | null)[] = [];

  if (body.name !== undefined) {
    sets.push("name = ?");
    values.push(body.name);
  }
  if (body.tags !== undefined) {
    sets.push("tags = ?");
    values.push(JSON.stringify(body.tags));
  }
  if (body.blocks !== undefined) {
    sets.push("blocks = ?");
    values.push(JSON.stringify(body.blocks));
  }

  if (sets.length === 0) {
    return c.json({ error: "Nothing to update." }, 400);
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  sets.push("updated_at = ?");
  values.push(now);
  values.push(promptId);
  values.push(session.userId);

  await c.env.DB.prepare(
    `UPDATE prompts SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
  )
    .bind(...values)
    .run();

  // Return updated prompt
  const row = await c.env.DB.prepare(
    "SELECT * FROM prompts WHERE id = ?"
  )
    .bind(promptId)
    .first<PromptRow>();

  return c.json({ prompt: row ? rowToPrompt(row) : null });
});

// DELETE /api/prompts/:id — Hard delete
prompts.delete("/:id", async (c) => {
  const session = c.get("session");
  const promptId = c.req.param("id");

  const result = await c.env.DB.prepare(
    "DELETE FROM prompts WHERE id = ? AND user_id = ?"
  )
    .bind(promptId, session.userId)
    .run();

  if (!result.meta.changes) {
    return c.json({ error: "Prompt not found." }, 404);
  }

  return c.json({ success: true });
});

export { prompts };
