import { Hono } from "hono";
import type { Env } from "../env";
import type { SessionData } from "../lib/session";
import { requireAdmin, requireAuth } from "../lib/auth-middleware";
import { renderSpikePdf } from "../lib/documents-spike";

const documents = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

documents.use("*", requireAuth);

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
