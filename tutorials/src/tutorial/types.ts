// What a tutorial is made of, whatever studio it shows.
//
// Each paragraph is one voice-over take. Its beats say what the screen shows
// while it is spoken: which captured state (shot), what the camera frames,
// what is spotlit, where the cursor clicks and which label appears. `at` is
// the share of the paragraph already spoken when the beat starts.

export type BoxId = string;

export interface Beat {
  at?: number;
  shot: string;
  /** Box to frame; "page" shows the whole studio. */
  focus: BoxId | "page";
  spotlight?: BoxId;
  click?: BoxId;
  callout?: { target: BoxId; text: string; side?: "above" | "below" };
}

export interface Paragraph {
  id: string;
  text: string;
  beats: Beat[];
  /** A sound inserted after the paragraph, with its own visual. */
  after?: "compare";
  /** The recap steps appear over this paragraph. */
  recap?: boolean;
  /** A full-screen scene of the tutorial's own, shown while it is spoken. */
  scene?: string;
}

export interface Chapter {
  id: string;
  label?: string;
  title: string;
  /** Only in the module cut, not in the site cut. */
  moduleOnly?: boolean;
  paragraphs: Paragraph[];
  /** A sound played before the first paragraph. */
  before?: "result";
}

export type Cut = "module" | "site";

interface CardText {
  kicker: string;
  title: string;
  line: string;
}

export interface TutorialScript {
  /** Its folder under public/ and its name in the scripts' commands. */
  id: string;
  /** The opening card: "Prise en main du" / "Studio audio". */
  title: {
    lead: string;
    name: string;
    subtitle: string;
    kicker: Partial<Record<Cut, string>> & { site: string };
    /** The collage scrap next to the title. */
    scrap: "wave" | "page";
  };
  chapters: Chapter[];
  recap: { labels: string[]; cues: string[] };
  end: Partial<Record<Cut, CardText>> & { site: CardText };
  /** What follows the narration in the plain-text script. */
  appendix: { title: string; lines: string[] };
}
