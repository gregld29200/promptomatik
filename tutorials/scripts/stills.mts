// Frames of the edit as PNGs, to review a change without a full render.
//
//   npm run stills -- StudioAudioModule 120,900,2400
//
// Writes out/stills/.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [id = "StudioAudioModule", list = "0"] = process.argv.slice(2);
const frames = list.split(",").map(Number);
const browserExecutable = process.env.REMOTION_BROWSER ?? null;

const serveUrl = await bundle({ entryPoint: resolve(ROOT, "src/index.ts"), publicDir: resolve(ROOT, "public") });
const composition = await selectComposition({ serveUrl, id, browserExecutable });
mkdirSync(resolve(ROOT, "out/stills"), { recursive: true });
for (const frame of frames) {
  const output = resolve(ROOT, `out/stills/${id}-${frame}.png`);
  await renderStill({ serveUrl, composition, frame, output, browserExecutable });
  console.log(output);
}
