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
  tips: string | null;
  source_type: string;
  is_template: number;
  template_id: string | null;
  template_kind: string;
  template_status: string;
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
    tips: row.tips ? JSON.parse(row.tips) : [],
    source_type: row.source_type,
    is_template: row.is_template === 1,
    template_id: row.template_id,
    template_kind: row.template_kind,
    template_status: row.template_status,
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
    tips?: string[];
    source_type?: string;
  }>();

  if (!body.blocks || !Array.isArray(body.blocks)) {
    return c.json({ error: "Blocks are required." }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  await c.env.DB.prepare(
    `INSERT INTO prompts (id, user_id, name, language, tags, blocks, tips, source_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      session.userId,
      body.name || "",
      body.language || session.languagePreference || "fr",
      JSON.stringify(body.tags || []),
      JSON.stringify(body.blocks),
      JSON.stringify(body.tips || []),
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
        tips: body.tips || [],
        source_type: body.source_type || "from_scratch",
        is_template: false,
        template_id: null,
        template_kind: "official",
        template_status: "approved",
        created_at: now,
        updated_at: now,
      },
    },
    201
  );
});

// GET /api/prompts — List user's prompts (optional ?q= search)
prompts.get("/", async (c) => {
  const session = c.get("session");
  const q = c.req.query("q");

  let result;
  if (q) {
    const pattern = `%${q}%`;
    result = await c.env.DB.prepare(
      "SELECT * FROM prompts WHERE user_id = ? AND (name LIKE ? OR tags LIKE ?) ORDER BY updated_at DESC"
    )
      .bind(session.userId, pattern, pattern)
      .all<PromptRow>();
  } else {
    result = await c.env.DB.prepare(
      "SELECT * FROM prompts WHERE user_id = ? ORDER BY updated_at DESC"
    )
      .bind(session.userId)
      .all<PromptRow>();
  }

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
    tips?: string[];
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
  if (body.tips !== undefined) {
    sets.push("tips = ?");
    values.push(JSON.stringify(body.tips));
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

// POST /api/prompts/:id/submit-template — Submit prompt for community review
prompts.post("/:id/submit-template", async (c) => {
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

  if (row.is_template === 1) {
    return c.json({ error: "Template is already published." }, 409);
  }

  if (row.template_status === "pending") {
    return c.json({ error: "Prompt is already pending review." }, 409);
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  await c.env.DB.prepare(
    `UPDATE prompts
     SET template_kind = 'community',
         template_status = 'pending',
         is_template = 0,
         updated_at = ?
     WHERE id = ? AND user_id = ?`
  )
    .bind(now, promptId, session.userId)
    .run();

  const updated = await c.env.DB.prepare(
    "SELECT * FROM prompts WHERE id = ? AND user_id = ?"
  )
    .bind(promptId, session.userId)
    .first<PromptRow>();

  return c.json({ prompt: updated ? rowToPrompt(updated) : null });
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

// POST /api/prompts/:id/duplicate — Duplicate a prompt
prompts.post("/:id/duplicate", async (c) => {
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

  const newId = crypto.randomUUID();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const newName = `${row.name} (copy)`;

  await c.env.DB.prepare(
    `INSERT INTO prompts (id, user_id, name, language, tags, blocks, tips, source_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      newId,
      session.userId,
      newName,
      row.language,
      row.tags,
      row.blocks,
      row.tips,
      row.source_type,
      now,
      now
    )
    .run();

  return c.json(
    {
      prompt: rowToPrompt({
        ...row,
        id: newId,
        name: newName,
        is_template: 0,
        template_id: null,
        template_kind: "official",
        template_status: "approved",
        created_at: now,
        updated_at: now,
      }),
    },
    201
  );
});

export { prompts };
