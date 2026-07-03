import { Hono } from "hono";
import type { Env } from "../env";
import type { SessionData } from "../lib/session";
import { requireAdmin, requireAuth, requireParticipant } from "../lib/auth-middleware";
import { renderSpikePdf } from "../lib/documents-spike";
import {
  createDocumentJob,
  getDocumentJobForUser,
  validateDocumentRequest,
  type DocumentRequest,
} from "../lib/document-jobs";

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

documents.get("/jobs/:id", requireParticipant, async (c) => {
  const session = c.get("session");
  const job = await getDocumentJobForUser(c.env, c.req.param("id"), session.userId);
  if (!job) {
    return c.json({ error: "Job not found." }, 404);
  }
  return c.json({ job });
});

// D0 spike - removed once the real Documents renderer ships (D3).
documents.post("/spike-pdf", requireAdmin, async (c) => {
  const pdf = await renderSpikePdf(c.env);
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="spike-d0.pdf"',
    },
  });
});

export { documents };
