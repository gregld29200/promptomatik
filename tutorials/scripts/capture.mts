// Screen states of a tutorial: the real studio, run by Vite from the app's
// sources, with its API answered from the tutorial's demo.
//
//   npm run capture                 Studio audio
//   npm run capture -- documents    Documents
//
// Writes public/<tutorial>/shots/ and copies the brand fonts to public/fonts/.
import { capture, type Walk } from "./capture/kit.mts";

const id = process.argv[2] ?? "studio-audio";
const { walk } = (await import(`./capture/${id}.mts`)) as { walk: Walk };
await capture(id, walk);
