// Live check of the Audio Studio TTS chain: Gemini 3.8 Flash TTS through
// OpenRouter for a monologue and a dialogue, then the 2.5 Pro fallback on the
// Gemini API. Writes one WAV per test to listen to, and prints durations.
//
//   OPENROUTER_API_KEY=… GEMINI_API_KEY=… npx tsx scripts/tts-openrouter-probe.ts
//
// Keys are read from the shell or from .dev.vars. Without GEMINI_API_KEY the
// fallback test is skipped. Each test costs a few cents at most.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../worker/env";
import {
  PCM_BYTES_PER_SECOND,
  audioCostUsd,
  audioTokensPerSecond,
  getTtsModelConfig,
  priceForModel,
  type AudioDirection,
} from "../worker/lib/audio-config";
import { concatPcmWithSilence, wavFromPcm } from "../worker/lib/audio-assembly";
import { estimateAudioSeconds, splitScriptIntoBlocks } from "../worker/lib/audio-script";
import { speechStyle } from "../worker/lib/audio-direction";
import { generateBlock, pcmFromAudioBytes } from "../worker/lib/tts-provider";

const MONOLOGUE = [
  "Bonjour à tous ! Aujourd'hui, nous allons parler de nos loisirs. [pause]",
  "Moi, le week-end, j'adore faire du vélo au bord de la Loire. [laughs]",
  "Et vous, qu'est-ce que vous aimez faire le samedi matin ?",
].join(" ");

const DIALOGUE = [
  "Speaker 1: Salut Camille ! Ça fait longtemps, dis donc.",
  "Speaker 2: [excited] Léo ! Oh là là, je ne m'attendais pas à te voir ici !",
  "Speaker 1: Je viens tous les matins, c'est mon petit rituel. Tu prends un café ?",
  "Speaker 2: Volontiers. [laughs] Mais c'est moi qui invite, cette fois.",
  "Speaker 1: [whispers] D'accord, mais ne le dis à personne.",
].join("\n");

const MONOLOGUE_DIRECTION: AudioDirection = {
  level: "A2",
  accent: "Slow classroom French",
  pace: "Slow learner-friendly",
  style: "Warm and encouraging",
};

const DIALOGUE_DIRECTION: AudioDirection = {
  level: "B1",
  accent: "Parisian",
  pace: "Natural classroom speed",
  style: "Informal conversation",
  scene: "Deux amis se retrouvent par hasard dans un café parisien, le matin.",
};

const DIALOGUE_VOICES = { "Speaker 1": "Puck", "Speaker 2": "Kore" };

interface ProbeOutcome {
  name: string;
  status: "OK" | "FAIL" | "INFO";
  detail: string;
}

async function loadEnv(): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  const file = await readFile(".dev.vars", "utf8").catch(() => "");
  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    vars[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  const shell = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
  return { ...vars, ...shell };
}

// Spoken directions or labels would make the audio far longer than the
// transcript warrants, so a duration well off the estimate is suspicious.
function durationVerdict(script: string, seconds: number): string {
  const expected = estimateAudioSeconds(script);
  const ratio = seconds / Math.max(1, expected);
  const flag = ratio > 2.2 ? " — TOO LONG: directions or labels may have been read aloud"
    : ratio < 0.4 ? " — TOO SHORT: text may be missing"
    : "";
  return `${seconds.toFixed(1)} s (script estimate ~${expected} s)${flag}`;
}

async function synthesize(
  name: string,
  file: string,
  outDir: string,
  run: () => Promise<{ pcm: Uint8Array; retryCount: number; model: string }>,
  script: string,
  pricePer1MTokens: number
): Promise<ProbeOutcome> {
  const startedAt = Date.now();
  try {
    const result = await run();
    const seconds = result.pcm.byteLength / PCM_BYTES_PER_SECOND;
    const target = path.join(outDir, file);
    await writeFile(target, wavFromPcm(result.pcm));
    const verdict = durationVerdict(script, seconds);
    return {
      name,
      status: verdict.includes("TOO ") ? "FAIL" : "OK",
      detail: [
        `model ${result.model}`,
        `audio ${verdict}`,
        `took ${((Date.now() - startedAt) / 1000).toFixed(1)} s, retries ${result.retryCount}`,
        `≈ $${audioCostUsd(seconds, pricePer1MTokens, audioTokensPerSecond(result.model)).toFixed(4)}`,
        `listen: ${target}`,
      ].join("\n    "),
    };
  } catch (error) {
    return { name, status: "FAIL", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function generateTake(
  apiKey: string,
  model: string,
  mode: "monologue" | "dialogue",
  script: string,
  direction: AudioDirection,
  voices: Record<string, string>
) {
  const parts: Uint8Array[] = [];
  let retryCount = 0;
  for (const block of splitScriptIntoBlocks(script, mode)) {
    const result = await generateBlock({ apiKey, model, mode, script: block.text, direction, voices });
    parts.push(result.pcm);
    retryCount += result.retryCount;
  }
  return { pcm: concatPcmWithSilence(parts), retryCount, model };
}

// Experiment only: does OpenRouter forward a Gemini multi-speaker config so a
// whole dialogue fits in one request? The studio does not depend on it.
async function singleRequestDialogue(apiKey: string, model: string, outDir: string): Promise<ProbeOutcome> {
  const speakers = Object.entries(DIALOGUE_VOICES);
  const variants: Array<{ label: string; voice?: string; options: Record<string, unknown> }> = [
    {
      label: "speech_config (snake_case), no voice",
      options: {
        speech_config: {
          multi_speaker_voice_config: {
            speaker_voice_configs: speakers.map(([speaker, voice]) => ({
              speaker,
              voice_config: { prebuilt_voice_config: { voice_name: voice } },
            })),
          },
        },
      },
    },
    {
      label: "speechConfig (camelCase), voice Puck",
      voice: "Puck",
      options: {
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: speakers.map(([speaker, voice]) => ({
              speaker,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
            })),
          },
        },
      },
    },
  ];
  const transcript = DIALOGUE.replace(/\s*\[[^\]]*]\s*/g, " ");
  const style = speechStyle({ direction: DIALOGUE_DIRECTION, mode: "dialogue", speaker: "Speaker 1" });
  const lines: string[] = [];

  for (const [index, variant] of variants.entries()) {
    const options = { speech_metadata: { style }, ...variant.options };
    const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: transcript,
        ...(variant.voice ? { voice: variant.voice } : {}),
        response_format: "pcm",
        provider: { options: { "google-ai-studio": options, "google-vertex": options } },
      }),
    });
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!response.ok || !contentType.startsWith("audio/")) {
      lines.push(`${variant.label}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
      continue;
    }
    const pcm = pcmFromAudioBytes(new Uint8Array(await response.arrayBuffer()));
    const target = path.join(outDir, `3-dialogue-3.8-one-request-${index + 1}.wav`);
    await writeFile(target, wavFromPcm(pcm));
    lines.push(
      `${variant.label}: audio ${durationVerdict(DIALOGUE, pcm.byteLength / PCM_BYTES_PER_SECOND)}`
        + ` — listen for two distinct voices and no spoken "Speaker" labels: ${target}`
    );
  }
  return { name: "Dialogue 3.8, whole dialogue in one request (experiment)", status: "INFO", detail: lines.join("\n    ") };
}

// One bare request, to see what OpenRouter actually sends back: the studio
// assumes 24 kHz mono 16-bit samples, so the implied duration must be sane.
async function rawRequestCheck(apiKey: string, model: string): Promise<ProbeOutcome> {
  const name = "Raw OpenRouter speech request";
  const text = "Bonjour, ceci est un petit test de voix.";
  const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: text, voice: "Kore", response_format: "pcm" }),
  });
  const contentType = response.headers.get("Content-Type") ?? "(none)";
  if (!response.ok || !contentType.startsWith("audio/")) {
    return { name, status: "FAIL", detail: `HTTP ${response.status} ${contentType} ${(await response.text()).slice(0, 300)}` };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const pcm = pcmFromAudioBytes(bytes);
  return {
    name,
    status: "OK",
    detail: [
      `HTTP ${response.status}, Content-Type ${contentType}, ${bytes.byteLength} bytes`,
      `read as 24 kHz mono 16-bit: ${durationVerdict(text, pcm.byteLength / PCM_BYTES_PER_SECOND)}`,
      `generation id ${response.headers.get("X-Generation-Id") ?? "(none)"}`,
    ].join("\n    "),
  };
}

async function main() {
  const env = await loadEnv();
  const openRouterKey = env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    throw new Error("OPENROUTER_API_KEY is missing. Set it in the shell or in .dev.vars.");
  }
  const config = getTtsModelConfig(env as unknown as Env);
  const outDir = path.join(".tmp", "tts-openrouter-probe", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(outDir, { recursive: true });

  const outcomes: ProbeOutcome[] = [];
  outcomes.push(await rawRequestCheck(openRouterKey, config.monologueModel));
  outcomes.push(await synthesize(
    "Monologue 3.8 via OpenRouter",
    "1-monologue-3.8.wav",
    outDir,
    () => generateTake(openRouterKey, config.monologueModel, "monologue", MONOLOGUE, MONOLOGUE_DIRECTION, { solo: "Kore" }),
    MONOLOGUE,
    priceForModel(config, config.monologueModel)
  ));
  outcomes.push(await synthesize(
    "Dialogue 3.8 via OpenRouter, turn by turn (what the studio does)",
    "2-dialogue-3.8-turn-by-turn.wav",
    outDir,
    () => generateTake(openRouterKey, config.dialogueModel, "dialogue", DIALOGUE, DIALOGUE_DIRECTION, DIALOGUE_VOICES),
    DIALOGUE,
    priceForModel(config, config.dialogueModel)
  ));
  outcomes.push(await singleRequestDialogue(openRouterKey, config.dialogueModel, outDir));

  if (env.GEMINI_API_KEY) {
    outcomes.push(await synthesize(
      "Dialogue fallback: 2.5 Pro on the Gemini API",
      "4-dialogue-2.5-pro-fallback.wav",
      outDir,
      () => generateTake(env.GEMINI_API_KEY, config.finalModel, "dialogue", DIALOGUE, DIALOGUE_DIRECTION, DIALOGUE_VOICES),
      DIALOGUE,
      priceForModel(config, config.finalModel)
    ));
  } else {
    outcomes.push({ name: "Dialogue fallback: 2.5 Pro on the Gemini API", status: "INFO", detail: "skipped (no GEMINI_API_KEY)" });
  }

  for (const outcome of outcomes) {
    console.log(`${outcome.status.padEnd(4)} ${outcome.name}\n    ${outcome.detail}\n`);
  }
  if (outcomes.some((outcome) => outcome.status === "FAIL")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
