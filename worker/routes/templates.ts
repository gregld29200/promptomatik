import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth } from "../lib/auth-middleware";
import type { SessionData } from "../lib/session";

const templates = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

templates.use("/*", requireAuth);

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

interface TemplateRow extends PromptRow {
  author_name: string;
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

// GET /api/templates — List all published templates
templates.get("/", async (c) => {
  const kind = c.req.query("kind");

  let sql = `SELECT p.*, u.name AS author_name
             FROM prompts p
             JOIN users u ON u.id = p.user_id
             WHERE p.is_template = 1
               AND p.template_status = 'approved'`;
  const binds: string[] = [];

  if (kind === "official" || kind === "community") {
    sql += " AND p.template_kind = ?";
    binds.push(kind);
  }

  sql += " ORDER BY p.updated_at DESC";

  const stmt = c.env.DB.prepare(sql);
  const result = binds.length
    ? await stmt.bind(...binds).all<TemplateRow>()
    : await stmt.all<TemplateRow>();

  const items = (result.results ?? []).map((row) => ({
    ...rowToPrompt(row),
    author_name: row.author_name,
  }));

  return c.json({ templates: items });
});

// GET /api/templates/:id — Single template detail
templates.get("/:id", async (c) => {
  const templateId = c.req.param("id");

  const row = await c.env.DB.prepare(
    `SELECT p.*, u.name AS author_name
     FROM prompts p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = ? AND p.is_template = 1 AND p.template_status = 'approved'`
  )
    .bind(templateId)
    .first<TemplateRow>();

  if (!row) {
    return c.json({ error: "Template not found." }, 404);
  }

  return c.json({
    template: { ...rowToPrompt(row), author_name: row.author_name },
  });
});

// POST /api/templates/:id/use — Clone template into user's library
templates.post("/:id/use", async (c) => {
  const session = c.get("session");
  const templateId = c.req.param("id");

  const row = await c.env.DB.prepare(
    "SELECT * FROM prompts WHERE id = ? AND is_template = 1 AND template_status = 'approved'"
  )
    .bind(templateId)
    .first<PromptRow>();

  if (!row) {
    return c.json({ error: "Template not found." }, 404);
  }

  const newId = crypto.randomUUID();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  await c.env.DB.prepare(
    `INSERT INTO prompts (id, user_id, name, language, tags, blocks, tips, source_type, is_template, template_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  )
    .bind(
      newId,
      session.userId,
      row.name,
      row.language,
      row.tags,
      row.blocks,
      row.tips,
      row.source_type,
      templateId,
      now,
      now
    )
    .run();

  return c.json(
    {
      prompt: rowToPrompt({
        ...row,
        id: newId,
        user_id: session.userId,
        is_template: 0,
        template_id: templateId,
        template_kind: "official",
        template_status: "approved",
        created_at: now,
        updated_at: now,
      }),
    },
    201
  );
});

export { templates };
