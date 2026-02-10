/**
 * Typed OpenRouter client.
 * POST to OpenAI-compatible endpoint with JSON mode.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.0-flash-001";
const TIMEOUT_MS = 30_000;

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

export type LLMResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };

export async function chatCompletion<T>(
  apiKey: string,
  req: ChatRequest
): Promise<LLMResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://promptomatic.com",
        "X-Title": "Promptomatic",
      },
      body: JSON.stringify({
        model: req.model ?? DEFAULT_MODEL,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.max_tokens ?? 2048,
        response_format: { type: "json_object" },
      }),
    });

    if (res.status === 429) {
      return { data: null, error: "Rate limit reached. Please wait a moment and try again." };
    }
    if (res.status >= 500) {
      return { data: null, error: "The AI service is temporarily unavailable. Please try again." };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { data: null, error: `AI request failed (${res.status}): ${body.slice(0, 200)}` };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      return { data: null, error: "Empty response from AI." };
    }

    const parsed = JSON.parse(content) as T;
    return { data: parsed, error: null };
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
}
