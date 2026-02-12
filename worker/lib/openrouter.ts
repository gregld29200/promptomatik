/**
 * Typed OpenRouter client.
 * POST to OpenAI-compatible endpoint with JSON mode.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "z-ai/glm-5";
const FALLBACK_MODEL = "minimax/minimax-m2.5";
// Reasoning models can take materially longer than non-reasoning chat models.
const TIMEOUT_MS = 90_000;

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

export type LLMResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };

export async function chatCompletion<T>(
  apiKey: string,
  req: ChatRequest,
  models: ChatModelsConfig = {}
): Promise<LLMResult<T>> {
  if (!apiKey || apiKey.trim().length === 0) {
    return { data: null, error: "Missing OpenRouter API key." };
  }

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

  const callModel = async (model: string): Promise<LLMResult<T>> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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

  const primaryModel = req.model ?? models.primaryModel ?? DEFAULT_MODEL;
  const fallbackModel = models.fallbackModel ?? FALLBACK_MODEL;
  const modelChain = primaryModel === fallbackModel
    ? [primaryModel]
    : [primaryModel, fallbackModel];

  for (let i = 0; i < modelChain.length; i += 1) {
    const result = await callModel(modelChain[i]);
    if (!result.error) return result;

    const shouldTryFallback =
      i === 0 &&
      modelChain.length > 1 &&
      (
        result.error === "AI request timed out. Please try again." ||
        result.error === "Empty response from AI." ||
        result.error === "AI returned malformed JSON." ||
        result.error === "AI response hit token limit before returning JSON." ||
        result.error === "The AI service is temporarily unavailable. Please try again."
      );

    if (!shouldTryFallback) {
      return result;
    }
  }

  return { data: null, error: "The AI service is temporarily unavailable. Please try again." };
}
