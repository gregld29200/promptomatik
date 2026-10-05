import { Hono, type Context } from "hono";
import type { Env } from "../env";
import type { SessionData } from "../lib/session";
import { requireAuth, requireParticipant } from "../lib/auth-middleware";
import { renderMaterialHtml } from "../lib/documents/material-renderer";
import { referencedImageIds } from "../lib/documents/simple-material-renderer";
import { renderMaterialPdf } from "../lib/documents/pdf";
import {
  MAX_DOCUMENT_IMAGE_BYTES,
  getDocumentImage,
  isDocumentImageType,
  loadDocumentImages,
  sniffImageType,
  storeDocumentImage,
} from "../lib/document-images";
import { SimpleTemplateSchema, type SimpleTemplateId, type SimpleTransformMaterial, type TransformMaterial } from "../lib/documents/types";
import {
  createDocumentJob,
  deleteDocumentJobForUser,
  getDocumentJobForUser,
  listDocumentJobsForUser,
  updateDocumentPresentation,
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
  const template = resolveSimpleTemplate(c, material);
  if (template instanceof Response) return template;
  const images = material.material_type === "clean_handout"
    ? await loadDocumentImages(c.env, c.get("session").userId, referencedImageIds(material))
    : {};

  if (parsed.extension === "html") {
    return new Response(renderMaterialHtml(material, { simpleTemplate: template, images }), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  }

  if (!c.env.BROWSER) {
    return c.json({ error: "documents_pdf_unavailable" }, 503);
  }

  const html = renderMaterialHtml(material, { simpleTemplate: template, images });
  const simple = material.material_type === "clean_handout" ? material as SimpleTransformMaterial : undefined;
  const footerText = simple?.design?.footerText;
  const pdf = await renderMaterialPdf(c.env, html, {
    title: material.title,
    pageNumbers: material.material_type === "clean_handout" ? (footerText ? true : "multiple-only") : false,
    landscape: simple?.orientation === "landscape",
    footerText,
  });
  const filename = `${slugify(material.title)}-${parsed.idx + 1}.pdf`;
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

documents.patch("/jobs/:id/materials/:idx/presentation", requireParticipant, async (c) => {
  const idx = Number(c.req.param("idx"));
  if (!Number.isInteger(idx) || idx < 0 || idx > 2) return c.json({ error: "Material not found." }, 404);
  const body = await c.req.json<{ templateId?: string; design?: unknown; orientation?: string }>().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_request" }, 400);
  const result = await updateDocumentPresentation(c.env, c.req.param("id"), c.get("session").userId, idx, body);
  if (result === "invalid") return c.json({ error: "invalid_request" }, 400);
  if (!result) return c.json({ error: "Job not found." }, 404);
  return c.json({ job: result });
});

// Images a teacher places in a document: `![légende](studio:<id>)`, or a logo.
documents.post("/images", requireParticipant, async (c) => {
  const declared = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!isDocumentImageType(declared)) return c.json({ error: "image_type" }, 415);
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > MAX_DOCUMENT_IMAGE_BYTES) return c.json({ error: "image_too_large" }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) return c.json({ error: "image_type" }, 415);
  if (bytes.length > MAX_DOCUMENT_IMAGE_BYTES) return c.json({ error: "image_too_large" }, 413);
  const sniffed = sniffImageType(bytes);
  if (!sniffed) return c.json({ error: "image_type" }, 415);
  const id = await storeDocumentImage(c.env, c.get("session").userId, bytes, sniffed);
  return c.json({ id }, 201);
});

documents.get("/images/:id", requireParticipant, async (c) => {
  const object = await getDocumentImage(c.env, c.get("session").userId, c.req.param("id"));
  if (!object) return c.json({ error: "Image not found." }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

function resolveSimpleTemplate(
  c: DocumentsContext,
  material: TransformMaterial,
): SimpleTemplateId | undefined | Response {
  if (material.material_type !== "clean_handout") return undefined;
  const storedTemplate = "template_id" in material ? material.template_id : undefined;
  const requested = c.req.query("template") ?? storedTemplate ?? "editorial_reader";
  const parsed = SimpleTemplateSchema.safeParse(requested);
  if (!parsed.success) return c.json({ error: "invalid_template" }, 400);
  return parsed.data;
}

documents.get("/jobs/:id", requireParticipant, async (c) => {
  const session = c.get("session");
  const job = await getDocumentJobForUser(c.env, c.req.param("id"), session.userId);
  if (!job) {
    return c.json({ error: "Job not found." }, 404);
  }
  return c.json({ job });
});

documents.delete("/jobs/:id", requireParticipant, async (c) => {
  const session = c.get("session");
  const deleted = await deleteDocumentJobForUser(c.env, c.req.param("id"), session.userId);
  if (!deleted) {
    return c.json({ error: "Job not found." }, 404);
  }
  return c.json({ ok: true });
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
