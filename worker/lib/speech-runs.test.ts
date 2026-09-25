import { describe, expect, it } from "vitest";
import type { AudioDirection } from "./audio-config";
import { SUPPORTED_AUDIO_TAGS } from "../../src/lib/audio-script-rules";
import { TranscriptValidationError, speechStyle } from "./audio-direction";
import { EVENT_TAGS, MANNER_TAGS, planSpeechRuns } from "./speech-runs";

const DIRECTION: AudioDirection = {
  level: "B1",
  accent: "Parisian",
  pace: "Natural classroom speed",
  style: "Informal conversation",
  speakers: {
    "Speaker 2": { style: "Customer service", notes: "a little impatient" },
  },
};

const DIALOGUE_VOICES = { "Speaker 1": "Kore", "Speaker 2": "Puck" };

describe("planSpeechRuns", () => {
  it("voices each dialogue turn with its own speaker's voice and style", () => {
    const runs = planSpeechRuns({
      mode: "dialogue",
      script: "Speaker 1: Bonjour, je voudrais un café.\nSpeaker 2: Sur place ou à emporter ?",
      voices: DIALOGUE_VOICES,
      direction: DIRECTION,
    });

    expect(runs).toEqual([
      {
        text: "Bonjour, je voudrais un café.",
        voice: "Kore",
        style: speechStyle({ direction: DIRECTION, mode: "dialogue", speaker: "Speaker 1" }),
        turn: 0,
      },
      {
        text: "Sur place ou à emporter ?",
        voice: "Puck",
        style: speechStyle({ direction: DIRECTION, mode: "dialogue", speaker: "Speaker 2" }),
        turn: 1,
      },
    ]);
    expect(runs[1].style).toContain("Helpful, courteous");
    expect(runs[1].style).toContain("Manner of speaking: a little impatient.");
  });

  it("keeps a monologue block in one run, word for word, when no manner tag splits it", () => {
    const runs = planSpeechRuns({
      mode: "monologue",
      script: "Il est 3.5 fois plus rapide. M. Dupont arrive.\nOn commence ?",
      voices: { solo: "Charon" },
      direction: DIRECTION,
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      text: "Il est 3.5 fois plus rapide. M. Dupont arrive.\nOn commence ?",
      voice: "Charon",
      turn: 0,
    });
  });

  it("turns momentary tags into 3.8 inline events and drops unknown tags", () => {
    const runs = planSpeechRuns({
      mode: "monologue",
      script: "C'est drôle ! [laughs] Bon. [Pause] On continue [coughs] tranquillement. [sighs]",
      voices: { solo: "Kore" },
    });

    expect(runs).toEqual([{
      text: "C'est drôle ! <laugh> Bon. <short pause> On continue tranquillement. <sigh>",
      voice: "Kore",
      style: "",
      turn: 0,
    }]);
  });

  it("lets a manner tag colour the rest of its dialogue turn, from its sentence on", () => {
    const base = speechStyle({ direction: DIRECTION, mode: "dialogue", speaker: "Speaker 1" });
    const runs = planSpeechRuns({
      mode: "dialogue",
      script: "Speaker 1: Attends. [whispers] [excited] Il arrive ! On se cache.\nSpeaker 1: Voilà.",
      voices: DIALOGUE_VOICES,
      direction: DIRECTION,
    });

    expect(runs).toEqual([
      { text: "Attends.", voice: "Kore", style: base, turn: 0 },
      { text: "Il arrive ! On se cache.", voice: "Kore", style: `Whispering, excited. ${base}`, turn: 0 },
      { text: "Voilà.", voice: "Kore", style: base, turn: 1 },
    ]);
  });

  it("keeps a manner tag to its own sentence in a monologue block", () => {
    const base = speechStyle({ direction: DIRECTION, mode: "monologue", speaker: "solo" });
    const runs = planSpeechRuns({
      mode: "monologue",
      script: "Je suis là.\n[whispers] Ne dis rien, surtout.\nOn y va.",
      voices: { solo: "Kore" },
      direction: DIRECTION,
    });

    expect(runs.map((run) => [run.text, run.style])).toEqual([
      ["Je suis là.", base],
      ["Ne dis rien, surtout.", `Whispering. ${base}`],
      ["On y va.", base],
    ]);
  });

  it("maps every tag the studio offers", () => {
    for (const tag of SUPPORTED_AUDIO_TAGS) {
      expect(tag in EVENT_TAGS || tag in MANNER_TAGS, tag).toBe(true);
    }
  });

  it("refuses an unlabelled dialogue line", () => {
    expect(() => planSpeechRuns({
      mode: "dialogue",
      script: "Speaker 1: Bonjour.\nMarie: Salut.",
      voices: DIALOGUE_VOICES,
    })).toThrow(TranscriptValidationError);
  });
});

describe("speechStyle", () => {
  it("describes a monologue delivery from the direction presets", () => {
    expect(speechStyle({
      mode: "monologue",
      speaker: "solo",
      direction: {
        level: "A2",
        accent: "Slow classroom French",
        pace: "Slow learner-friendly",
        style: "Warm and encouraging",
        scene: "A calm classroom at the start of the lesson.",
        notes: "smiles between sentences",
      },
    })).toBe(
      "Supportive, patient, and gently motivating without exaggeration. "
      + "Accent: Slow classroom French. "
      + "Pacing: Slow learner-friendly delivery with enough space to process each idea. "
      + "Noticeably slower than natural speech, short breath groups, predictable intonation. "
      + "Clarity: Very clear articulation, no reduced forms, gentle sentence stress. "
      + "Manner of speaking: smiles between sentences. "
      + "Scene: A calm classroom at the start of the lesson."
    );
  });

  it("lets a speaker's free accent replace the global one", () => {
    const style = speechStyle({
      mode: "dialogue",
      speaker: "Speaker 1",
      direction: {
        level: "B2",
        accent: "British",
        pace: "Business meeting speed",
        style: "Business meeting",
        speakers: { "Speaker 1": { accentDetail: "a light Marseille accent." } },
      },
    });
    expect(style).toContain("Accent: a light Marseille accent.");
    expect(style).not.toContain("British");
  });
});
