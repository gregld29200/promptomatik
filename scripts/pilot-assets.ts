// Phase 7 pilot harness (PRD §10, AGENT_INSTRUCTIONS Phase 7).
// Generates the 7 pilot test assets through the REAL pipeline (jobs API +
// queue consumer) against a running dev server, downloads each final MP3
// for the listening session, and prints a metrics table covering the
// go/no-go measurements: failure rate, median generation time for the
// 2-minute Final dialogue (run 3 times), cost per generated hour, and
// estimated-vs-actual duration accuracy.
//
// Prerequisites: `npx wrangler dev --local --port 8787` running with
// GEMINI_API_KEY in .dev.vars, and the local dev admin account seeded.
//
// Usage:
//   npm run audio:pilot
//   PILOT_BASE_URL=... PILOT_EMAIL=... PILOT_PASSWORD=... npm run audio:pilot

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AudioDirection, AudioMode, AudioQuality } from "../worker/lib/audio-config";

const BASE_URL = process.env.PILOT_BASE_URL ?? "http://localhost:8787";
const EMAIL = process.env.PILOT_EMAIL ?? "greg@teachinspire.com";
const PASSWORD = process.env.PILOT_PASSWORD ?? "admin123";
const OUT_DIR = path.join(".tmp", "pilot-assets");
const POLL_INTERVAL_MS = 3_000;
const TAKE_TIMEOUT_MS = 12 * 60_000;
const TWO_MIN_DIALOGUE_RUNS = 3;

interface PilotAsset {
  slug: string;
  label: string;
  lang: "EN" | "FR";
  mode: AudioMode;
  quality: AudioQuality;
  runs: number;
  isTwoMinDialogue: boolean;
  script: string;
  direction: AudioDirection;
  voices: Record<string, string>;
}

const ASSETS: PilotAsset[] = [
  {
    slug: "a2-monologue-en",
    label: "A2 monologue (EN)",
    lang: "EN",
    mode: "monologue",
    quality: "final",
    runs: 1,
    isTwoMinDialogue: false,
    script: [
      "Hello everyone. Today I want to talk about my morning routine.",
      "I wake up at seven o'clock. First, I drink a glass of water.",
      "Then I take a shower and get dressed.",
      "For breakfast, I usually have bread with butter and a cup of tea. [pause]",
      "After breakfast, I check my bag and leave the house at eight.",
      "I take the bus to work. The trip takes twenty minutes.",
      "In the evening, I cook dinner and watch a series before bed.",
    ].join("\n"),
    direction: {
      level: "A2",
      accent: "Neutral international",
      pace: "Slow learner-friendly",
      style: "Neutral classroom",
      scene: "A friendly speaker describes their daily routine for beginner listeners.",
    },
    voices: { solo: "Sulafat" },
  },
  {
    slug: "b1-workplace-dialogue-fr",
    label: "B1 workplace dialogue (FR)",
    lang: "FR",
    mode: "dialogue",
    quality: "final",
    runs: 1,
    isTwoMinDialogue: false,
    script: [
      "Speaker 1: Bonjour Karim, tu as une minute ? Je voudrais parler de la réunion de jeudi.",
      "Speaker 2: Bien sûr. Il y a un problème avec la salle ?",
      "Speaker 1: Non, la salle est réservée. Mais le client arrive à neuf heures, et la présentation n'est pas terminée.",
      "Speaker 2: [sighs] Je sais. Il me manque encore les chiffres du dernier trimestre.",
      "Speaker 1: Je peux te les envoyer cet après-midi. Tu peux finir les diapositives demain matin ?",
      "Speaker 2: Oui, si je reçois tout avant seize heures, c'est possible.",
      "Speaker 1: Parfait. On fait une répétition mercredi à dix-sept heures ?",
      "Speaker 2: [curious] Dans la grande salle ou en visio ?",
      "Speaker 1: En visio, c'est plus simple pour tout le monde.",
      "Speaker 2: Très bien, je note. Merci pour ton aide.",
    ].join("\n"),
    direction: {
      level: "B1",
      accent: "Neutral",
      pace: "Natural classroom speed",
      style: "Business meeting",
      scene: "Deux collègues préparent une réunion client dans un bureau calme.",
    },
    voices: { "Speaker 1": "Kore", "Speaker 2": "Charon" },
  },
  {
    slug: "b2-business-2min-en",
    label: "B2 business scenario, 2-min dialogue (EN)",
    lang: "EN",
    mode: "dialogue",
    quality: "final",
    runs: TWO_MIN_DIALOGUE_RUNS,
    isTwoMinDialogue: true,
    script: [
      "Speaker 1: Thanks for making time today. I wanted to walk through the launch plan before we present it to the board next week.",
      "Speaker 2: Of course. I read the draft last night. Overall it looks solid, but I have concerns about the timeline.",
      "Speaker 1: [curious] Which part worries you the most?",
      "Speaker 2: The testing phase. Two weeks is optimistic for a product with this many integrations. If anything slips, we lose the retail window.",
      "Speaker 1: That's fair. What if we brought the security review forward and ran it in parallel with user testing?",
      "Speaker 2: That could work, but we'd need the vendor's sign-off first. They were quite strict about sequencing last time.",
      "Speaker 1: I spoke to them on Monday. They're open to it, provided we share the test environment by Friday.",
      "Speaker 2: [amazed] That's earlier than I expected. Good news, honestly.",
      "Speaker 1: There's one more thing. Marketing wants to announce the partnership at the trade fair, which means the press release needs legal approval by the end of the month.",
      "Speaker 2: [sighs] Legal is already stretched with the acquisition paperwork. I'd rather we kept the announcement flexible.",
      "Speaker 1: Agreed. Let's mark it as provisional in the deck and flag the dependency clearly.",
      "Speaker 2: Perfect. Send me the revised plan by Thursday and I'll add the budget figures.",
      "Speaker 1: Will do. And thank you, this is exactly the kind of pushback the plan needed.",
      "Speaker 2: [laughs] That's what I'm here for. See you Thursday.",
    ].join("\n"),
    direction: {
      level: "B2",
      accent: "Neutral international",
      pace: "Business meeting speed",
      style: "Business meeting",
      scene: "Two managers review a product launch plan in a meeting room.",
    },
    voices: { "Speaker 1": "Alnilam", "Speaker 2": "Despina" },
  },
  {
    slug: "en-roleplay-hotel",
    label: "EN roleplay (hotel check-in)",
    lang: "EN",
    mode: "dialogue",
    quality: "final",
    runs: 1,
    isTwoMinDialogue: false,
    script: [
      "Speaker 1: Good evening, welcome to the Riverside Hotel. How can I help you?",
      "Speaker 2: Good evening. I have a reservation under the name Dubois, for two nights.",
      "Speaker 1: Let me check. [pause] Yes, here it is. A double room with a river view.",
      "Speaker 2: Actually, I asked for a quiet room. Is the river side noisy?",
      "Speaker 1: Not at all, the bar terrace is on the street side. The river rooms are our quietest.",
      "Speaker 2: [tired] Perfect. It was a very long flight.",
      "Speaker 1: I understand. Breakfast is served from seven to ten, on the ground floor.",
      "Speaker 2: Is it possible to have a wake-up call at half past six?",
      "Speaker 1: Of course. Here is your key card, room three-oh-four, third floor.",
      "Speaker 2: Thank you very much. Good night.",
    ].join("\n"),
    direction: {
      level: "B1",
      accent: "British",
      pace: "Natural classroom speed",
      style: "Customer service",
      scene: "A traveller checks in at a hotel reception desk late in the evening.",
    },
    voices: { "Speaker 1": "Achird", "Speaker 2": "Leda" },
  },
  {
    slug: "fr-classroom-narration",
    label: "FR classroom narration",
    lang: "FR",
    mode: "monologue",
    quality: "final",
    runs: 1,
    isTwoMinDialogue: false,
    script: [
      "Ce matin-là, la gare était presque vide.",
      "Claire posa sa valise sur le quai et regarda l'horloge : six heures dix.",
      "Le train pour Lyon partait dans vingt minutes, et Paul n'était toujours pas là.",
      "[pause] Elle sortit son téléphone, hésita, puis le rangea dans sa poche.",
      "Après tout, c'était lui qui avait insisté pour ce voyage.",
      "Un haut-parleur annonça le train de Bordeaux. Des voyageurs pressés traversèrent le hall.",
      "Soudain, elle entendit une voix familière derrière elle.",
      "[amazed] Il était là, essoufflé, un bouquet de fleurs à la main.",
      "Claire sourit malgré elle. Le voyage commençait bien.",
    ].join("\n"),
    direction: {
      level: "B1",
      accent: "Neutral",
      pace: "Natural classroom speed",
      style: "Storytelling",
      scene: "Une narration calme et expressive pour une activité de compréhension orale.",
    },
    voices: { solo: "Vindemiatrix" },
  },
  {
    slug: "fr-dictation",
    label: "Dictation version (FR)",
    lang: "FR",
    mode: "monologue",
    quality: "final",
    runs: 1,
    isTwoMinDialogue: false,
    script: [
      "Chaque été, ma famille passe deux semaines au bord de la mer.",
      "Nous louons une petite maison blanche près du port.",
      "Le matin, mon père achète du pain et des fruits au marché.",
      "L'après-midi, nous nageons ou nous lisons sous le parasol.",
      "Le soir, toute la famille dîne sur la terrasse.",
      "Ces vacances simples restent mes meilleurs souvenirs.",
    ].join("\n"),
    direction: {
      level: "A2",
      accent: "Slow classroom French",
      pace: "Slow learner-friendly",
      style: "Dictation (measured, deliberate pauses after each sentence)",
      scene: "Dictée en classe : chaque phrase doit pouvoir être écrite par les apprenants.",
    },
    voices: { solo: "Schedar" },
  },
  {
    slug: "en-pair-slow",
    label: "Slow+natural pair — slow take (EN)",
    lang: "EN",
    mode: "monologue",
    quality: "final",
    runs: 1,
    isTwoMinDialogue: false,
    script: [
      "Working from home has changed the way many people organise their day.",
      "Some employees enjoy the flexibility: they can start earlier, take a proper lunch break, and avoid crowded trains.",
      "Others miss the office. They say that ideas move faster when colleagues share the same room.",
      "[pause] Companies are now trying to find a balance.",
      "Many teams meet in person two or three days a week and work remotely the rest of the time.",
      "The right answer probably depends on the job, the team, and the person.",
    ].join("\n"),
    direction: {
      level: "B1",
      accent: "Neutral international",
      pace: "Slow learner-friendly",
      style: "Neutral classroom",
      scene: "A clear explainer about remote work for intermediate listeners.",
    },
    voices: { solo: "Callirrhoe" },
  },
  {
    slug: "en-pair-natural",
    label: "Slow+natural pair — natural take (EN)",
    lang: "EN",
    mode: "monologue",
    quality: "final",
    runs: 1,
    isTwoMinDialogue: false,
    script: [
      "Working from home has changed the way many people organise their day.",
      "Some employees enjoy the flexibility: they can start earlier, take a proper lunch break, and avoid crowded trains.",
      "Others miss the office. They say that ideas move faster when colleagues share the same room.",
      "[pause] Companies are now trying to find a balance.",
      "Many teams meet in person two or three days a week and work remotely the rest of the time.",
      "The right answer probably depends on the job, the team, and the person.",
    ].join("\n"),
    direction: {
      level: "B1",
      accent: "Neutral international",
      pace: "Natural classroom speed",
      style: "Neutral classroom",
      scene: "A clear explainer about remote work for intermediate listeners.",
    },
    voices: { solo: "Callirrhoe" },
  },
];

interface TakeResult {
  asset: PilotAsset;
  run: number;
  jobId: string | null;
  status: "ready" | "failed" | "timeout" | "rejected";
  error: string | null;
  estimatedSeconds: number | null;
  actualSeconds: number | null;
  genMs: number | null;
  wallMs: number | null;
  retryCount: number | null;
  apiCostUsd: number | null;
  mp3Path: string | null;
}

let sessionCookie = "";

async function api(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

async function login(): Promise<void> {
  const response = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).catch(() => null);
  if (!response) {
    throw new Error(`Cannot reach ${BASE_URL}. Start the dev server first: npx wrangler dev --local --port 8787`);
  }
  if (!response.ok) {
    throw new Error(`Login failed (HTTP ${response.status}). Check PILOT_EMAIL / PILOT_PASSWORD.`);
  }
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Login returned no session cookie.");
  sessionCookie = setCookie.split(";")[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface JobPayload {
  job: {
    status: string;
    error: string | null;
    estimatedSeconds: number;
    actualSeconds: number | null;
    genMs: number | null;
    retryCount: number;
    apiCostUsd: number | null;
  };
}

async function runTake(asset: PilotAsset, run: number): Promise<TakeResult> {
  const result: TakeResult = {
    asset,
    run,
    jobId: null,
    status: "rejected",
    error: null,
    estimatedSeconds: null,
    actualSeconds: null,
    genMs: null,
    wallMs: null,
    retryCount: null,
    apiCostUsd: null,
    mp3Path: null,
  };

  const startedAt = Date.now();
  const createResponse = await api("/api/audio/jobs", {
    method: "POST",
    body: JSON.stringify({
      mode: asset.mode,
      quality: asset.quality,
      script: asset.script,
      direction: asset.direction,
      voices: asset.voices,
    }),
  });
  const created = await createResponse.json() as { jobId?: string; estimatedSeconds?: number; error?: string };
  if (!createResponse.ok || !created.jobId) {
    result.error = created.error ?? `Job creation failed (HTTP ${createResponse.status}).`;
    return result;
  }
  result.jobId = created.jobId;
  result.estimatedSeconds = created.estimatedSeconds ?? null;

  while (Date.now() - startedAt < TAKE_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const pollResponse = await api(`/api/audio/jobs/${created.jobId}`);
    if (!pollResponse.ok) continue;
    const { job } = await pollResponse.json() as JobPayload;

    if (job.status === "ready" || job.status === "failed") {
      result.status = job.status;
      result.error = job.error;
      result.actualSeconds = job.actualSeconds;
      result.genMs = job.genMs;
      result.retryCount = job.retryCount;
      result.apiCostUsd = job.apiCostUsd;
      result.wallMs = Date.now() - startedAt;

      if (job.status === "ready") {
        const download = await api(`/api/audio/jobs/${created.jobId}/download/final.mp3`);
        if (download.ok) {
          const fileName = asset.runs > 1 ? `${asset.slug}-run${run}.mp3` : `${asset.slug}.mp3`;
          const filePath = path.join(OUT_DIR, fileName);
          await writeFile(filePath, Buffer.from(await download.arrayBuffer()));
          result.mp3Path = filePath;
        }
      }
      return result;
    }
  }

  result.status = "timeout";
  result.error = `No terminal status after ${TAKE_TIMEOUT_MS / 60000} minutes.`;
  result.wallMs = Date.now() - startedAt;
  return result;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmtSeconds(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

function fmtRatio(actual: number | null, estimated: number | null): string {
  if (actual === null || estimated === null || estimated === 0) return "—";
  return `${(actual / estimated).toFixed(2)}x`;
}

function buildTable(takes: TakeResult[]): string {
  const lines: string[] = [];
  lines.push("| Asset | Lang | Mode | Run | Status | Est s | Actual s | Accuracy (act/est) | Wall time | ms/audio-s | Retries | Cost |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const take of takes) {
    const msPerAudioSecond = take.genMs !== null && take.actualSeconds
      ? Math.round(take.genMs / take.actualSeconds)
      : null;
    lines.push([
      take.asset.label,
      take.asset.lang,
      take.asset.mode,
      `${take.run}/${take.asset.runs}`,
      take.status,
      take.estimatedSeconds ?? "—",
      take.actualSeconds ?? "—",
      fmtRatio(take.actualSeconds, take.estimatedSeconds),
      fmtSeconds(take.wallMs),
      msPerAudioSecond ?? "—",
      take.retryCount ?? "—",
      take.apiCostUsd !== null ? `$${take.apiCostUsd.toFixed(4)}` : "—",
    ].map(String).join(" | ").replace(/^/, "| ").concat(" |"));
  }
  return lines.join("\n");
}

function buildSummary(takes: TakeResult[]): string {
  const settled = takes.filter((take) => take.status === "ready" || take.status === "failed");
  const failed = settled.filter((take) => take.status !== "ready");
  const ready = settled.filter((take) => take.status === "ready");
  const failureRate = settled.length > 0 ? failed.length / settled.length : null;

  const twoMinWallTimes = takes
    .filter((take) => take.asset.isTwoMinDialogue && take.status === "ready" && take.wallMs !== null)
    .map((take) => take.wallMs as number);
  const medianTwoMin = median(twoMinWallTimes);

  const totalCost = ready.reduce((sum, take) => sum + (take.apiCostUsd ?? 0), 0);
  const totalAudioSeconds = ready.reduce((sum, take) => sum + (take.actualSeconds ?? 0), 0);
  const costPerHour = totalAudioSeconds > 0 ? totalCost / (totalAudioSeconds / 3600) : null;

  const overEstimate = ready.filter(
    (take) => take.actualSeconds !== null
      && take.estimatedSeconds !== null
      && take.actualSeconds > take.estimatedSeconds * 2
  );

  const lines: string[] = [];
  lines.push("| Go/no-go metric | Threshold | Measured |");
  lines.push("|---|---|---|");
  lines.push(`| Failure rate after retries | < 5% | ${failureRate === null ? "no data" : `${(failureRate * 100).toFixed(1)}% (${failed.length}/${settled.length} takes)`} |`);
  lines.push(`| Real cost per generated hour (Final) | < $3.60/h (2x $1.80/h estimate) | ${costPerHour === null ? "no data" : `$${costPerHour.toFixed(2)}/h`} |`);
  lines.push(`| Median generation time, 2-min Final dialogue | < 3 min | ${medianTwoMin === null ? "no data" : `${(medianTwoMin / 1000).toFixed(1)}s over ${twoMinWallTimes.length} runs`} |`);
  lines.push(`| Quality shareable with learners | 7 pilot assets | listening session (files in ${OUT_DIR}) |`);
  lines.push("");
  lines.push(`Total API cost: $${totalCost.toFixed(4)} · total audio: ${totalAudioSeconds}s · takes with actual > 2x estimate: ${overEstimate.length}`);
  return lines.join("\n");
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await login();

  const takes: TakeResult[] = [];
  for (const asset of ASSETS) {
    for (let run = 1; run <= asset.runs; run += 1) {
      process.stdout.write(`generating ${asset.slug} (run ${run}/${asset.runs})... `);
      const take = await runTake(asset, run);
      takes.push(take);
      console.log(take.status === "ready"
        ? `ready in ${fmtSeconds(take.wallMs)} (${take.actualSeconds}s audio, $${take.apiCostUsd?.toFixed(4)})`
        : `${take.status}: ${take.error ?? "unknown"}`);
    }
  }

  const table = buildTable(takes);
  const summary = buildSummary(takes);
  const report = `# Pilot assets metrics (${new Date().toISOString()})\n\n${table}\n\n## Go/no-go summary\n\n${summary}\n`;

  const reportPath = path.join(OUT_DIR, "metrics.md");
  await writeFile(reportPath, report);

  console.log(`\n${table}\n\n${summary}\n\nreport: ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
