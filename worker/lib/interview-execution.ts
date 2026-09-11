import type { Env } from '../env';
import { readContext } from './attachments/context';
import { documentMessages, finalizeAttachments } from './attachments/prompts';
import { intentAnalysisPrompt, interviewQuestionsPrompt, promptAssemblyPrompt, promptRefinementPrompt } from './llm/prompts';
import type { AssembleResult, AssembledPrompt, IntentAnalysis, InterviewQuestion, RefinedPrompt } from './llm/types';
import { chatCompletion, type LLMCallMeta } from './openrouter';
import { normalizeQuestions } from './interview-normalization';
import type { TeacherProfile } from '../routes/profile';
import { normalizeLanguage } from './language';
import { normalizeTier, type Tier } from './tier';
import type { AnalyzeJobRequest, QuestionsJobRequest, AssembleJobRequest, RefineJobRequest } from './interview-jobs';

const ANALYZE_JOB_TIMEOUTS = {
  attemptTimeoutMs: 35_000,
  totalTimeoutMs: 90_000,
  modelAttempts: 1,
} as const;

const QUESTIONS_JOB_TIMEOUTS = {
  attemptTimeoutMs: 35_000,
  totalTimeoutMs: 90_000,
  modelAttempts: 1,
} as const;

const ASSEMBLE_JOB_TIMEOUTS = {
  attemptTimeoutMs: 120_000,
  totalTimeoutMs: 360_000,
  modelAttempts: 2,
} as const;

const REFINE_JOB_TIMEOUTS = {
  attemptTimeoutMs: 120_000,
  totalTimeoutMs: 360_000,
  modelAttempts: 2,
} as const;

interface JobExecutionResult<T> {
  result: T | null;
  error: string | null;
  llmMeta?: LLMCallMeta;
}

function normalizeModelName(name?: string): string | undefined {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

// Jobs enqueued before the tiering deploy have no tier in the payload —
// they were all created by invited (participant) users.
function isParticipantJob(tier?: Tier): boolean {
  return tier === undefined || normalizeTier(tier) === "participant";
}

// Model priority is the same for every tier; profile access remains tier-aware.
function llmModels(env: Env): { primaryModel?: string; fallbackModel?: string } {
  return {
    primaryModel: normalizeModelName(env.OPENROUTER_MODEL),
    fallbackModel: normalizeModelName(env.OPENROUTER_FALLBACK_MODEL),
  };
}

async function fetchProfile(db: D1Database, userId: string): Promise<TeacherProfile | undefined> {
  const row = await db.prepare("SELECT profile FROM users WHERE id = ?")
    .bind(userId)
    .first<{ profile: string }>();

  if (!row) return undefined;

  const parsed = JSON.parse(row.profile) as TeacherProfile;
  return parsed.setup_completed ? parsed : undefined;
}

export async function processAnalyzeJob(
  env: Env,
  jobId: string,
  userId: string,
  payload: AnalyzeJobRequest
): Promise<JobExecutionResult<IntentAnalysis>> {
  const documents = await readContext(env.DB, userId, payload.document_context_id);
  const lang = normalizeLanguage(payload.language);
  // Profile context is a participant feature — never injected for free-tier jobs.
  const profile = isParticipantJob(payload.tier)
    ? await fetchProfile(env.DB, userId)
    : undefined;
  const models = llmModels(env);

  const completion = await chatCompletion<IntentAnalysis>(
    env.OPENROUTER_API_KEY,
    {
      messages: documentMessages(intentAnalysisPrompt(lang, profile), payload.text.trim(), documents),
      temperature: 0.3,
    },
    models,
    {
      ...ANALYZE_JOB_TIMEOUTS,
      redactErrors: true,
      logContext: {
        operation: "interview.analyze",
        jobId,
        jobKind: "analyze",
      },
    }
  );

  if (completion.error) {
    return { result: null, error: completion.error, llmMeta: completion.meta };
  }

  if (!completion.data) {
    return { result: null, error: "Empty response from AI.", llmMeta: completion.meta };
  }

  return { result: completion.data, error: null, llmMeta: completion.meta };
}

export async function processQuestionsJob(
  env: Env,
  jobId: string,
  userId: string,
  payload: QuestionsJobRequest
): Promise<JobExecutionResult<{ questions: InterviewQuestion[] }>> {
  const documents = await readContext(env.DB, userId, payload.document_context_id);
  const lang = normalizeLanguage(payload.language);
  // Profile context is a participant feature — never injected for free-tier jobs.
  const profile = isParticipantJob(payload.tier)
    ? await fetchProfile(env.DB, userId)
    : undefined;
  const models = llmModels(env);

  const userMessage = `Original teacher request: ${payload.original_text ?? ""}

Here is the intent analysis:
${JSON.stringify(payload.intent, null, 2)}

Missing fields to ask about: ${payload.intent.missing_fields.join(", ")}

Generate questions ONLY for the missing fields listed above.`;

  const completion = await chatCompletion<{ questions: InterviewQuestion[] }>(
    env.OPENROUTER_API_KEY,
    {
      messages: documentMessages(interviewQuestionsPrompt(lang, profile), userMessage, documents),
      temperature: 0.6,
    },
    models,
    {
      ...QUESTIONS_JOB_TIMEOUTS,
      redactErrors: true,
      logContext: {
        operation: "interview.questions",
        jobId,
        jobKind: "questions",
      },
    }
  );

  if (completion.error) {
    return { result: null, error: completion.error, llmMeta: completion.meta };
  }

  if (!completion.data) {
    return { result: null, error: "Empty response from AI.", llmMeta: completion.meta };
  }

  return {
    result: { questions: normalizeQuestions(completion.data.questions) },
    error: null,
    llmMeta: completion.meta,
  };
}

export async function processAssembleJob(
  env: Env,
  jobId: string,
  userId: string,
  payload: AssembleJobRequest
): Promise<JobExecutionResult<AssembleResult>> {
  const documents = await readContext(env.DB, userId, payload.document_context_id);
  const lang = normalizeLanguage(payload.language);
  // Profile context is a participant feature — never injected for free-tier jobs.
  const profile = isParticipantJob(payload.tier)
    ? await fetchProfile(env.DB, userId)
    : undefined;
  const models = llmModels(env);

  const userMessage = `Original teacher request:
"${payload.original_text}"

Intent analysis:
${JSON.stringify(payload.intent, null, 2)}

Teacher's answers to follow-up questions:
${JSON.stringify(payload.answers ?? {}, null, 2)}

Assemble a complete, ready-to-use teaching prompt using the appropriate techniques.`;

  const completion = await chatCompletion<AssembleResult>(
    env.OPENROUTER_API_KEY,
    {
      messages: documentMessages(promptAssemblyPrompt(lang, profile, documents.length > 0), userMessage, documents),
      temperature: 0.5,
      max_tokens: 4096,
    },
    models,
    {
      ...ASSEMBLE_JOB_TIMEOUTS,
      redactErrors: true,
      logContext: {
        operation: "interview.assemble",
        jobId,
        jobKind: "assemble",
      },
    }
  );

  if (completion.error) {
    return { result: null, error: completion.error, llmMeta: completion.meta };
  }

  const data = completion.data;
  if (!data) {
    return { result: null, error: "Empty response from AI.", llmMeta: completion.meta };
  }

  if (data.kind === "ask_user") {
    return {
      result: { ...data, questions: normalizeQuestions(data.questions) },
      error: null,
      llmMeta: completion.meta,
    };
  }

  if (data.kind === "prompt") {
    return { result: { ...data, prompt: finalizeAttachments(data.prompt, documents, lang) }, error: null, llmMeta: completion.meta };
  }

  return {
    result: { kind: "prompt", prompt: finalizeAttachments(data as AssembledPrompt, documents, lang) },
    error: null,
    llmMeta: completion.meta,
  };
}

export async function processRefineJob(
  env: Env,
  jobId: string,
  userId: string,
  payload: RefineJobRequest
): Promise<JobExecutionResult<RefinedPrompt>> {
  const lang = normalizeLanguage(payload.language);

  const row = await env.DB.prepare(
    "SELECT blocks FROM prompts WHERE id = ? AND user_id = ?"
  )
    .bind(payload.promptId, userId)
    .first<{ blocks: string }>();

  if (!row) {
    return { result: null, error: "Prompt not found." };
  }

  const currentBlocks = JSON.parse(row.blocks) as AssembledPrompt["blocks"];
  const hasRequirements = currentBlocks.some(block => block.attachment_requirements);
  const profile = isParticipantJob(payload.tier)
    ? await fetchProfile(env.DB, userId)
    : undefined;
  const models = llmModels(env);

  const userMessage = `Current prompt blocks:
${JSON.stringify(currentBlocks, null, 2)}

Issue type: ${payload.issueType}
${payload.issueDescription ? `Issue description: ${payload.issueDescription}` : ""}
${payload.outputSample ? `AI output sample:\n${payload.outputSample}` : ""}

Revise the prompt to fix this issue. Only change what needs changing.`;

  const completion = await chatCompletion<RefinedPrompt>(
    env.OPENROUTER_API_KEY,
    {
      messages: [
        { role: "system", content: promptRefinementPrompt(lang, profile) + (hasRequirements ? `
The prompt includes document requirements. For each output block include attachment_requirements: boolean.
Keep the document-requirements block and its true flag; update its wording if needed to reflect the revised task.
Do not claim documents were transferred to the destination AI. The user can remove requirements manually in Edit Mode.
` : "") },
        { role: "user", content: userMessage },
      ],
      temperature: 0.4,
      max_tokens: 4096,
    },
    models,
    {
      ...REFINE_JOB_TIMEOUTS,
      redactErrors: true,
      logContext: {
        operation: "interview.refine",
        jobId,
        jobKind: "refine",
      },
    }
  );

  if (completion.error) {
    return { result: null, error: completion.error, llmMeta: completion.meta };
  }

  if (!completion.data) {
    return { result: null, error: "Empty response from AI.", llmMeta: completion.meta };
  }

  if (hasRequirements && !completion.data.blocks.some(block => block.attachment_requirements && block.content.trim())) {
    return { result: null, error: "AI omitted document requirements. Please try again.", llmMeta: completion.meta };
  }
  return { result: completion.data, error: null, llmMeta: completion.meta };
}
