import { TUTORIAL as documents } from "../documents/script";
import { TUTORIAL as studioAudio } from "../studio-audio/script";
import type { TutorialScript } from "./types";

/** Every tutorial, by the id its compositions and scripts use. */
export const TUTORIALS: Record<string, TutorialScript> = {
  [studioAudio.id]: studioAudio,
  [documents.id]: documents,
};

export function tutorialScript(id: string): TutorialScript {
  const script = TUTORIALS[id];
  if (!script) throw new Error(`Unknown tutorial "${id}": ${Object.keys(TUTORIALS).join(", ")}.`);
  return script;
}
