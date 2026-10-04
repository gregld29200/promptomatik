import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// Copied from the app's own packages by `npm run capture`.
export const fontsReady = Promise.all([
  loadFont({ family: "Fraunces", url: staticFile("fonts/fraunces.woff2"), weight: "100 900" }),
  loadFont({ family: "Fraunces", url: staticFile("fonts/fraunces-italic.woff2"), weight: "100 900", style: "italic" }),
  loadFont({ family: "DM Sans", url: staticFile("fonts/dm-sans.woff2"), weight: "100 1000" }),
]);
