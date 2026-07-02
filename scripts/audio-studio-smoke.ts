import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../worker/env";
import { getTtsModelConfig } from "../worker/lib/audio-config";
import { compileDirection } from "../worker/lib/audio-direction";
import { splitScriptIntoBlocks } from "../worker/lib/audio-script";
import { concatPcmWithSilence, mp3FromPcm, wavFromPcm } from "../worker/lib/audio-assembly";
import { costForQuality, generateBlock } from "../worker/lib/tts-provider";

async function loadDevVars(): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  const file = await readFile(".dev.vars", "utf8").catch(() => "");
  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    vars[key] = value;
  }
  return { ...process.env, ...vars };
}

async function main() {
  const envVars = await loadDevVars();
  const apiKey = envVars.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Add it to .dev.vars or the shell environment.");
  }

  const config = getTtsModelConfig(envVars as unknown as Env);
  const quality = "draft" as const;
  const model = config.draftModel;
  const script = [
    "Speaker 1: Good morning. Could you help me book a room for Friday?",
    "Speaker 2: Of course. Do you need a projector or just a quiet space?",
    "Speaker 1: Just a quiet space, please. [pause] It is for a short speaking test.",
  ].join("\n");
  const direction = {
    level: "B1" as const,
    accent: "Neutral international",
    pace: "Natural classroom speed",
    style: "Informal conversation",
    scene: "Two adults speak clearly at a school reception desk.",
  };
  const blocks = splitScriptIntoBlocks(script, "dialogue");

  const startedAt = Date.now();
  const pcmBlocks: Uint8Array[] = [];
  let retryCount = 0;

  for (const block of blocks) {
    const prompt = compileDirection({
      direction,
      mode: "dialogue",
      speakers: ["Speaker 1", "Speaker 2"],
      script: block.text,
    });
    const result = await generateBlock({
      apiKey,
      model,
      prompt,
      mode: "dialogue",
      voices: {
        "Speaker 1": "Kore",
        "Speaker 2": "Puck",
      },
    });
    pcmBlocks.push(result.pcm);
    retryCount += result.retryCount;
  }

  const pcm = concatPcmWithSilence(pcmBlocks);
  const wav = wavFromPcm(pcm);
  const mp3 = mp3FromPcm(pcm);
  const durationSeconds = pcm.byteLength / 48_000;
  const wallClockMs = Date.now() - startedAt;
  const costUsd = costForQuality(config, quality, durationSeconds);

  const outDir = path.join(".tmp", "audio-studio-phase2");
  await mkdir(outDir, { recursive: true });
  const basename = `smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const wavPath = path.join(outDir, `${basename}.wav`);
  const mp3Path = path.join(outDir, `${basename}.mp3`);
  await writeFile(wavPath, wav);
  await writeFile(mp3Path, mp3);

  console.log(JSON.stringify({
    model,
    quality,
    blocks: blocks.length,
    durationSeconds: Number(durationSeconds.toFixed(2)),
    wallClockMs,
    retryCount,
    apiCostUsd: Number(costUsd.toFixed(6)),
    wavPath,
    mp3Path,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
