// Teachers name an accent the way they say it ("accent du midi", "accent du
// sud"). Gemini 2.5 Pro performs a precise, strong request ("a broad
// Marseille accent: final mute e pronounced…") but reads a vague one as
// standard French, so a light model rewrites the teacher's words into an
// explicit brief before the take.

export interface AccentBriefInput {
  apiKey: string;
  model: string;
  /** The accent as the teacher phrased it, or a preset's expansion. */
  accent: string;
  /** Remembers each phrase's brief, so a phrase always sounds the same. */
  cache?: KVNamespace;
  fetcher?: typeof fetch;
}

// Bump to rewrite every cached brief after changing the prompt below.
const BRIEF_VERSION = "1";
const CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 20_000;

const PROMPT = [
  "A language teacher asks a text-to-speech voice to speak with an accent and typed the request below, in any language and in their own words.",
  "Identify the accent they mean and rewrite it as one to three English sentences a voice actor can perform, starting with \"Speak with\": the accent's strength, precise name and region, then its most recognisable pronunciation features (vowel quality, nasal vowels, dropped or added sounds, rhythm, intonation).",
  "Generic wordings name the archetypal accent: \"accent du midi\", \"accent du sud\" and \"provençal\" mean the southern French accent of Marseille and Provence; \"accent du nord\" and \"ch'ti\" mean the northern French accent of Lille. A city or region the teacher names keeps its own accent (toulousain is Toulouse).",
  "Strength: broad, strong and unmistakable in every word, unless the teacher asks for a light or slight accent; then say it is light but clearly audible.",
  "Be phonetically accurate and never invent a feature. Reference features: southern French (Marseille, Provence) pronounces every final mute e (\"une belle-e table-e\"), ends nasal vowels in an audible ng (\"pain\" sounds like \"paing\", \"maman\" like \"mamang\"), opens o where Paris closes it (\"rose\" rhymes with \"bosse\"), times syllables evenly, has a lively sing-song melody, and keeps a uvular r, never rolled. Northern French (ch'ti): open a pushed back towards o, a flatter melody. Quebec French: t and d before i and u become ts and dz (\"tu\" is \"tsu\"), short i, u and ou are lax, long vowels are diphthongised (\"père\" like \"paère\"). Belgian French: w in words like \"huit\" (\"wit\"), long vowels kept distinct, a slower, even melody.",
  "Describe pronunciation only, never age, gender or personality.",
  'Return ONLY valid JSON: {"description":"Speak with a broad ..."}',
].join("\n");

function normalize(accent: string): string {
  return accent.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseAccentBrief(raw: string): string | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  try {
    const parsed = JSON.parse(cleaned) as { description?: unknown } | null;
    const description = typeof parsed?.description === "string" ? parsed.description.trim() : "";
    return description.length >= 20 ? description.slice(0, 600) : null;
  } catch {
    return null;
  }
}

async function requestBrief(input: AccentBriefInput): Promise<string | null> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(
    `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Accent requested: ${input.accent.trim()}` }] }],
        generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  );
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  } | null;
  const raw = body?.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  return raw ? parseAccentBrief(raw) : null;
}

// Without a usable answer the teacher's own words are kept: the take is
// never held back by the brief.
export async function briefAccent(input: AccentBriefInput): Promise<string> {
  const cacheKey = `accent-brief:v${BRIEF_VERSION}:${normalize(input.accent)}`;
  const cached = await input.cache?.get(cacheKey).catch(() => null);
  if (cached) return cached;

  let brief: string | null = null;
  for (let attempt = 0; attempt < 2 && !brief; attempt += 1) {
    brief = await requestBrief(input).catch(() => null);
  }
  if (!brief) return input.accent;

  await input.cache?.put(cacheKey, brief, { expirationTtl: CACHE_TTL_SECONDS }).catch(() => undefined);
  return brief;
}
