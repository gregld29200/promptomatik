import { Hono, type Context } from "hono";
import type { Env } from "../env";
import type { SessionData } from "../lib/session";
import { requireAuth, requireParticipant } from "../lib/auth-middleware";
import { renderMaterialHtml } from "../lib/documents/material-renderer";
import { renderMaterialPdf } from "../lib/documents/pdf";
import {
  createDocumentJob,
  getDocumentJobForUser,
  listDocumentJobsForUser,
  validateDocumentRequest,
  type DocumentRequest,
} from "../lib/document-jobs";

type DocumentsContext = Context<{ Bindings: Env; Variables: { session: SessionData } }>;

const documents = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

documents.use("*", requireAuth);

documents.post("/transform", requireParticipant, async (c) => {
  const session = c.get("session");
  const body = await c.req.json<DocumentRequest>().catch(() => null);
  if (!body || typeof body.content !== "string") {
    return c.json({ error: "invalid_request" }, 400);
  }

  const validationError = validateDocumentRequest(body);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  const jobId = await createDocumentJob(c.env, session.userId, body);
  return c.json({ jobId }, 202);
});

documents.get("/jobs", requireParticipant, async (c) => {
  const session = c.get("session");
  const jobs = await listDocumentJobsForUser(c.env, session.userId);
  return c.json({ jobs });
});

documents.get("/jobs/:id/materials/:file", requireParticipant, async (c) => {
  const parsed = parseMaterialFile(c.req.param("file"));
  if (!parsed) {
    return c.json({ error: "Material not found." }, 404);
  }

  const material = await getCompletedMaterial(c, c.req.param("id"), parsed.idx);
  if (material instanceof Response) return material;

  if (parsed.extension === "html") {
    return new Response(renderMaterialHtml(material), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  }

  if (!c.env.BROWSER) {
    return c.json({ error: "documents_pdf_unavailable" }, 503);
  }

  const html = renderMaterialHtml(material);
  const pdf = await renderMaterialPdf(c.env, html, {
    title: material.title,
    pageNumbers: material.material_type === "clean_handout",
  });
  const filename = `${slugify(material.title)}-${parsed.idx + 1}.pdf`;
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

documents.get("/jobs/:id", requireParticipant, async (c) => {
  const session = c.get("session");
  const job = await getDocumentJobForUser(c.env, c.req.param("id"), session.userId);
  if (!job) {
    return c.json({ error: "Job not found." }, 404);
  }
  return c.json({ job });
});

async function getCompletedMaterial(
  c: DocumentsContext,
  jobId: string,
  idx: number
) {
  const session = c.get("session");
  const job = await getDocumentJobForUser(c.env, jobId, session.userId);
  if (!job) {
    return c.json({ error: "Job not found." }, 404);
  }

  if (!Number.isInteger(idx) || idx < 0 || idx > 2) {
    return c.json({ error: "Material not found." }, 404);
  }

  if (job.status !== "completed" || !job.result) {
    return c.json({ error: "job_not_ready" }, 409);
  }

  const material = job.result.materials[idx];
  if (!material) {
    return c.json({ error: "Material not found." }, 404);
  }

  return material;
}

function parseMaterialFile(file: string): { idx: number; extension: "html" | "pdf" } | null {
  const match = file.match(/^([0-9]+)\.(html|pdf)$/);
  if (!match) return null;
  return { idx: Number(match[1]), extension: match[2] as "html" | "pdf" };
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "document";
}

export { documents };
