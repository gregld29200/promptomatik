import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth } from "../lib/auth-middleware";
import type { SessionData } from "../lib/session";
import { getInterviewJobForUser } from "../lib/interview-jobs";
import type { AssembleResult, IntentAnalysis, InterviewQuestion, RefinedPrompt } from "../lib/llm/types";

type JobsEnv = { Bindings: Env; Variables: { session: SessionData } };

const jobs = new Hono<JobsEnv>();

jobs.use("/*", requireAuth);

jobs.get("/:id", async (c) => {
  const session = c.get("session");
  const job = await getInterviewJobForUser<
    IntentAnalysis | { questions: InterviewQuestion[] } | AssembleResult | RefinedPrompt
  >(
    c.env.DB,
    c.req.param("id"),
    session.userId
  );

  if (!job) {
    return c.json({ error: "Job not found." }, 404);
  }

  return c.json({ job });
});

export { jobs };
