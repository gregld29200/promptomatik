/**
 * Typed LLM client.
 * POST to an OpenAI-compatible endpoint with JSON mode.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const FALLBACK_MODEL = "moonshotai/kimi-k2.5";
// Keep total request time bounded and fail over quickly when a model stalls.
const DEFAULT_ATTEMPT_TIMEOUT_MS = 15_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL_ATTEMPTS = 1;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface ChatModelsConfig {
  primaryModel?: string;
  fallbackModel?: string;
}

interface ChatExecutionConfig {
  attemptTimeoutMs?: number;
  totalTimeoutMs?: number;
  modelAttempts?: number;
  logContext?: {
    operation?: string;
    jobId?: string;
    jobKind?: string;
  };
}

export interface LLMCallMeta {
  provider: "openrouter";
  model: string | null;
  usedFallbackModel: boolean;
  attempts: number;
  totalDurationMs: number;
}

export type LLMResult<T> =
  | { data: T; error: null; meta: LLMCallMeta }
  | { data: null; error: string; meta: LLMCallMeta };

type RawLLMResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };

export async function chatCompletion<T>(
  apiKey: string,
  req: ChatRequest,
  models: ChatModelsConfig = {},
  execution: ChatExecutionConfig = {}
): Promise<LLMResult<T>> {
  const requestStartedAt = Date.now();
  const primaryModel = req.model ?? models.primaryModel ?? DEFAULT_MODEL;
  const fallbackModel = models.fallbackModel ?? FALLBACK_MODEL;
  const attemptTimeoutMs = execution.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const totalTimeoutMs = execution.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const modelAttempts = execution.modelAttempts ?? DEFAULT_MODEL_ATTEMPTS;
  const modelChain = primaryModel === fallbackModel
    ? [primaryModel]
    : [primaryModel, fallbackModel];
  const startedAt = Date.now();
  let attemptsUsed = 0;

  const resultMeta = (model: string | null, usedFallbackModel: boolean): LLMCallMeta => ({
    provider: "openrouter",
    model,
    usedFallbackModel,
    attempts: attemptsUsed,
    totalDurationMs: Date.now() - requestStartedAt,
  });

  if (!apiKey || apiKey.trim().length === 0) {
    return {
      data: null,
      error: "Missing LLM API key.",
      meta: resultMeta(null, false),
    };
  }

  const logEvent = (event: string, details: Record<string, unknown>) => {
    console.info(event, {
      provider: "openrouter",
      operation: execution.logContext?.operation ?? "chatCompletion",
      jobId: execution.logContext?.jobId,
      jobKind: execution.logContext?.jobKind,
      ...details,
    });
  };

  const parseJsonObject = (raw: string): T => {
    const trimmed = raw.trim();

    // Strip ```json ... ``` fences if the model includes them.
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const unfenced = fenced ? fenced[1].trim() : trimmed;

    try {
      return JSON.parse(unfenced) as T;
    } catch {
      // Try to extract the first JSON object from a larger response.
      const start = unfenced.indexOf("{");
      const end = unfenced.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(unfenced.slice(start, end + 1)) as T;
      }
      throw new SyntaxError("Malformed JSON");
    }
  };

  const shouldRetryWithoutResponseFormat = (status: number, bodyText: string): boolean => {
    if (status !== 400 && status !== 422) return false;
    const b = bodyText.toLowerCase();
    return b.includes("response_format") || b.includes("json_object") || b.includes("json schema") || b.includes("json_schema");
  };

  const parseHttpStatusFromError = (error: string): number | null => {
    const match = error.match(/AI request failed \((\d{3})\):/);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const isRetryableError = (error: string): boolean => {
    if (
      error === "AI request timed out. Please try again." ||
      error === "Empty response from AI." ||
      error === "AI returned malformed JSON." ||
      error === "AI response hit token limit before returning JSON." ||
      error === "The AI service is temporarily unavailable. Please try again." ||
      error === "Rate limit reached. Please wait a moment and try again." ||
      error === "Unexpected error communicating with AI."
    ) {
      return true;
    }

    const status = parseHttpStatusFromError(error);
    if (status === null) return false;
    return [408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524].includes(status);
  };

  const isModelAvailabilityError = (error: string): boolean => {
    const normalized = error.toLowerCase();
    if (!normalized.includes("model")) return false;

    return (
      normalized.includes("not available") ||
      normalized.includes("not found") ||
      normalized.includes("unknown model") ||
      normalized.includes("unsupported model") ||
      normalized.includes("no providers") ||
      normalized.includes("no endpoints")
    );
  };

  const callModel = async (model: string, timeoutMs: number): Promise<RawLLMResult<T>> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const baseBody = {
        model,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.max_tokens ?? 2048,
      };

      const doFetch = (body: unknown) =>
        fetch(OPENROUTER_URL, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": "https://promptomatik.com",
            "X-Title": "Promptomatik",
          },
          body: JSON.stringify(body),
        });

      // Prefer strict JSON mode when supported, but gracefully fall back when models reject it.
      let res = await doFetch({ ...baseBody, response_format: { type: "json_object" } });

      if (res.status === 429) {
        return { data: null, error: "Rate limit reached. Please wait a moment and try again." };
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");

        if (shouldRetryWithoutResponseFormat(res.status, body)) {
          res = await doFetch(baseBody);
        } else if (res.status >= 500) {
          return { data: null, error: "The AI service is temporarily unavailable. Please try again." };
        } else {
          return { data: null, error: `AI request failed (${res.status}): ${body.slice(0, 200)}` };
        }
      }

      if (res.status >= 500) {
        return { data: null, error: "The AI service is temporarily unavailable. Please try again." };
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { data: null, error: `AI request failed (${res.status}): ${body.slice(0, 200)}` };
      }

      const json = (await res.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        if (json.choices?.[0]?.finish_reason === "length") {
          return { data: null, error: "AI response hit token limit before returning JSON." };
        }
        return { data: null, error: "Empty response from AI." };
      }

      return { data: parseJsonObject(content), error: null };
    } catch (err) {
      if (err instanceof SyntaxError) {
        return { data: null, error: "AI returned malformed JSON." };
      }
      if ((err as Error).name === "AbortError") {
        return { data: null, error: "AI request timed out. Please try again." };
      }
      return { data: null, error: "Unexpected error communicating with AI." };
    } finally {
      clearTimeout(timer);
    }
  };

  for (let i = 0; i < modelChain.length; i += 1) {
    for (let attempt = 0; attempt < modelAttempts; attempt += 1) {
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = totalTimeoutMs - elapsedMs;
      if (remainingMs <= 1_000) {
        logEvent("llm_timeout_budget_exhausted", {
          totalDurationMs: Date.now() - requestStartedAt,
          primaryModel,
          fallbackModel,
          modelAttempts,
        });
        return {
          data: null,
          error: "AI request timed out. Please try again.",
          meta: resultMeta(modelChain[i], i > 0),
        };
      }

      const effectiveAttemptTimeoutMs = Math.min(attemptTimeoutMs, remainingMs);
      const attemptStartedAt = Date.now();
      attemptsUsed += 1;
      const result = await callModel(modelChain[i], effectiveAttemptTimeoutMs);
      logEvent("llm_attempt_completed", {
        model: modelChain[i],
        attempt: attempt + 1,
        usedFallbackModel: i > 0,
        success: !result.error,
        durationMs: Date.now() - attemptStartedAt,
        attemptTimeoutMs: effectiveAttemptTimeoutMs,
        error: result.error ? result.error.slice(0, 160) : null,
      });
      if (!result.error) {
        return {
          ...result,
          meta: resultMeta(modelChain[i], i > 0),
        };
      }

      const isLastModelAttempt = attempt === modelAttempts - 1;
      const hasFallbackModel = i === 0 && modelChain.length > 1;

      if (!isLastModelAttempt && isRetryableError(result.error)) {
        // Brief backoff for transient provider/network issues before retrying same model.
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        continue;
      }

      if (hasFallbackModel && (isRetryableError(result.error) || isModelAvailabilityError(result.error))) {
        logEvent("llm_fallback_switch", {
          fromModel: modelChain[i],
          toModel: modelChain[i + 1],
          error: result.error.slice(0, 160),
          totalDurationMs: Date.now() - requestStartedAt,
        });
        break;
      }

      logEvent("llm_failed", {
        model: modelChain[i],
        totalDurationMs: Date.now() - requestStartedAt,
        error: result.error.slice(0, 160),
      });
      return {
        ...result,
        meta: resultMeta(modelChain[i], i > 0),
      };
    }
  }

  logEvent("llm_unavailable", {
    primaryModel,
    fallbackModel,
    totalDurationMs: Date.now() - requestStartedAt,
  });
  return {
    data: null,
    error: "The AI service is temporarily unavailable. Please try again.",
    meta: resultMeta(fallbackModel, primaryModel === fallbackModel ? false : true),
  };
}
