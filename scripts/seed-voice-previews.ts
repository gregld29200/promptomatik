// One-time voice preview seed (PRD §7.10, Phase 6).
// Generates one ~4s neutral English introduction per Gemini prebuilt voice
// with the Draft (Flash) model at default temperature, and uploads each
// sample to voices/{name}.mp3 in the MEDIA bucket (no lifecycle rule).
//
// Idempotent: voices that already have a preview object are skipped, so a
// re-run only generates what is missing and never double-spends API cost.
//
// Usage:
//   npm run audio:seed-voices           # local R2 (wrangler dev storage)
//   npm run audio:seed-voices -- --remote   # production R2 bucket

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Env } from "../worker/env";
import { getTtsModelConfig } from "../worker/lib/audio-config";
import { mp3FromPcm } from "../worker/lib/audio-assembly";
import { AUDIO_VOICES } from "../worker/lib/audio-voices";
import { costForQuality, generateBlock } from "../worker/lib/tts-provider";

const BUCKET = "teachinspire-media";
const PREVIEW_PREFIX = "voices";

function previewSentence(voiceName: string): string {
  return `Hello! My name is ${voiceName}, and this is what I sound like.`;
}

async function loadDevVars(): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  const file = await readFile(".dev.vars", "utf8").catch(() => "");
  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    vars[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return { ...process.env, ...vars } as Record<string, string>;
}

function wrangler(args: string[]): { ok: boolean; output: string } {
  const result = spawnSync("npx", ["wrangler", ...args], { encoding: "utf8" });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function previewExists(objectPath: string, locationFlag: string): boolean {
  return wrangler(["r2", "object", "get", objectPath, "--pipe", locationFlag]).ok;
}

async function main() {
  const remote = process.argv.includes("--remote");
  const locationFlag = remote ? "--remote" : "--local";
  const envVars = await loadDevVars();
  const apiKey = envVars.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Add it to .dev.vars or the shell environment.");
  }

  const config = getTtsModelConfig(envVars as unknown as Env);
  const model = config.draftModel;
  const workDir = await mkdtemp(path.join(tmpdir(), "voice-previews-"));

  let generated = 0;
  let skipped = 0;
  let totalSeconds = 0;

  try {
    for (const voice of AUDIO_VOICES) {
      const objectPath = `${BUCKET}/${PREVIEW_PREFIX}/${voice.name}.mp3`;

      if (previewExists(objectPath, locationFlag)) {
        skipped += 1;
        console.log(`skip ${voice.name} (preview already exists)`);
        continue;
      }

      const result = await generateBlock({
        apiKey,
        model,
        prompt: previewSentence(voice.name),
        mode: "monologue",
        voices: { solo: voice.name },
      });
      const mp3 = mp3FromPcm(result.pcm);
      const filePath = path.join(workDir, `${voice.name}.mp3`);
      await writeFile(filePath, mp3);

      const upload = wrangler([
        "r2", "object", "put", objectPath,
        "--file", filePath,
        "--content-type", "audio/mpeg",
        locationFlag,
      ]);
      if (!upload.ok) {
        throw new Error(`Upload failed for ${voice.name}: ${upload.output.trim()}`);
      }

      generated += 1;
      totalSeconds += result.durationSeconds;
      console.log(
        `ok   ${voice.name} (${result.durationSeconds.toFixed(2)}s, retries ${result.retryCount})`
      );
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  const totalCostUsd = costForQuality(config, "draft", totalSeconds);
  console.log(JSON.stringify({
    target: remote ? "remote" : "local",
    voices: AUDIO_VOICES.length,
    generated,
    skipped,
    totalAudioSeconds: Number(totalSeconds.toFixed(2)),
    totalApiCostUsd: Number(totalCostUsd.toFixed(6)),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
