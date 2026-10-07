import { describe, expect, it } from "vitest";
import { TranscriptValidationError, compileDirection, hasRegionalAccent, validateTranscriptForTts, withAccentBriefs } from "./audio-direction";

describe("compileDirection", () => {
  it("snapshots an A2 monologue direction", () => {
    expect(
      compileDirection({
        mode: "monologue",
        speakers: ["solo"],
        script: "Bonjour tout le monde. Aujourd'hui, nous parlons du travail.",
        direction: {
          level: "A2",
          accent: "Slow classroom French",
          pace: "Slow learner-friendly",
          style: "Warm and encouraging",
          scene: "A calm classroom at the start of the lesson.",
        },
      })
    ).toMatchInlineSnapshot(`
      "Synthesize the following monologue as speech. Everything before
      "TRANSCRIPT:" is performance direction — do not read it aloud. Read only the
      transcript, exactly as written, following the bracketed audio tags.

      AUDIO PROFILE:
      The speaker: Supportive, patient, and gently motivating without exaggeration.

      THE SCENE:
      A calm classroom at the start of the lesson.

      DIRECTOR'S NOTES:
      Style: Supportive, patient, and gently motivating without exaggeration.
      Accent: Slow classroom French.
      Pacing: Slow learner-friendly delivery with enough space to process each idea. Noticeably slower than natural speech, short breath groups, predictable intonation.
      Clarity: Very clear articulation, no reduced forms, gentle sentence stress.
      Audio tags: perform every bracketed tag (like [laughs] or [excited]) as a vocal expression at that exact spot; never read the bracket text aloud.

      TRANSCRIPT:
      Bonjour tout le monde. Aujourd'hui, nous parlons du travail."
    `);
  });

  it("snapshots a B2 dialogue direction with accent detail", () => {
    expect(
      compileDirection({
        mode: "dialogue",
        speakers: ["Speaker 1", "Speaker 2"],
        script: "Speaker 1: Could we move the meeting?\nSpeaker 2: Yes, Friday works.",
        direction: {
          level: "B2",
          accent: "British",
          accentDetail: "a light Croydon accent",
          pace: "Business meeting speed",
          style: "Business meeting",
        },
      })
    ).toMatchInlineSnapshot(`
      "Synthesize the following dialogue as speech. Everything before
      "TRANSCRIPT:" is performance direction — do not read it aloud. Read only the
      transcript, exactly as written, following the bracketed audio tags.

      AUDIO PROFILE:
      Speaker 1: Natural professional conversation with attentive turn-taking.
      Speaker 2: Natural professional conversation with attentive turn-taking.

      DIRECTOR'S NOTES:
      Style: Natural professional conversation with attentive turn-taking.
      Accent: a light Croydon accent.
      Pacing: Business meeting speed with realistic professional rhythm. Close to natural pace, realistic rhythm.
      Clarity: Natural but clear; reduced forms allowed.
      Audio tags: perform every bracketed tag (like [laughs] or [excited]) as a vocal expression at that exact spot; never read the bracket text aloud.

      TRANSCRIPT:
      Speaker 1: Could we move the meeting?
      Speaker 2: Yes, Friday works."
    `);
  });

  it("snapshots a dialogue with per-speaker overrides (PRD amendment)", () => {
    expect(
      compileDirection({
        mode: "dialogue",
        speakers: ["Speaker 1", "Speaker 2"],
        script: "Speaker 1: Good morning.\nSpeaker 2: Good morning, do sit down.",
        direction: {
          level: "B1",
          accent: "Neutral international",
          pace: "Natural classroom speed",
          style: "Neutral classroom",
          speakers: {
            "Speaker 1": {
              accent: "French-accented English",
              accentDetail: "English with a French accent, a learner from Lyon",
              notes: "hesitates and searches for words",
            },
            "Speaker 2": {
              style: "Examiner voice",
            },
          },
        },
      })
    ).toMatchInlineSnapshot(`
      "Synthesize the following dialogue as speech. Everything before
      "TRANSCRIPT:" is performance direction — do not read it aloud. Read only the
      transcript, exactly as written, following the bracketed audio tags.

      AUDIO PROFILE:
      Speaker 1: A clear, balanced classroom delivery focused on comprehension. Accent: English with a French accent, a learner from Lyon. Manner of speaking: hesitates and searches for words.
      Speaker 2: Objective, measured, calm, and consistent. Accent: A neutral, clear accent, natural for the language of the transcript.

      DIRECTOR'S NOTES:
      Style: A clear, balanced classroom delivery focused on comprehension.
      Accent: each speaker keeps the accent given in the audio profile, in every line
      Pacing: Natural classroom speed, clear but not artificial. Controlled natural pace with moderate pauses between ideas.
      Clarity: Clear articulation, limited reduced forms, clear sentence stress.
      Audio tags: perform every bracketed tag (like [laughs] or [excited]) as a vocal expression at that exact spot; never read the bracket text aloud.

      TRANSCRIPT:
      Speaker 1: Good morning.
      Speaker 2: Good morning, do sit down."
    `);
  });

  // The dictation style was removed from V1 after the pilot (BUILD_LOG.md,
  // Phase 7 closure), so the third representative snapshot is the examiner
  // voice instead.
  it("snapshots a C1 examiner direction", () => {
    expect(
      compileDirection({
        mode: "monologue",
        speakers: ["solo"],
        script: "The report is due on Thursday. Please review it carefully.",
        direction: {
          level: "C1",
          accent: "Neutral international",
          pace: "Exam speed",
          style: "Examiner voice",
        },
      })
    ).toMatchInlineSnapshot(`
      "Synthesize the following monologue as speech. Everything before
      "TRANSCRIPT:" is performance direction — do not read it aloud. Read only the
      transcript, exactly as written, following the bracketed audio tags.

      AUDIO PROFILE:
      The speaker: Objective, measured, calm, and consistent.

      DIRECTOR'S NOTES:
      Style: Objective, measured, calm, and consistent.
      Accent: A neutral, clear accent, natural for the language of the transcript.
      Pacing: Exam speed: controlled, neutral, and consistent. Fully authentic pace and rhythm, subtle emotion.
      Clarity: Authentic speech; natural linking and reduction.
      Audio tags: perform every bracketed tag (like [laughs] or [excited]) as a vocal expression at that exact spot; never read the bracket text aloud.

      TRANSCRIPT:
      The report is due on Thursday. Please review it carefully."
    `);
  });
});

describe("validateTranscriptForTts", () => {
  it("accepts dialogue with canonical Speaker 1/2 labels", () => {
    expect(() => validateTranscriptForTts(
      "dialogue",
      "Speaker 1: Bonjour.\nSpeaker 2: Salut."
    )).not.toThrow();
  });

  it("rejects mixed localized labels before the TTS call", () => {
    expect(() => validateTranscriptForTts(
      "dialogue",
      "Speaker 1: Bonjour.\nLocuteur 2: Salut."
    )).toThrow(TranscriptValidationError);
  });

  it("rejects stray display names before the TTS call", () => {
    expect(() => validateTranscriptForTts(
      "dialogue",
      "Marie: Bonjour.\nSpeaker 2: Salut."
    )).toThrow(TranscriptValidationError);
  });

  it("rejects speaker labels in monologue mode", () => {
    expect(() => validateTranscriptForTts(
      "monologue",
      "Speaker 1: Bonjour tout le monde."
    )).toThrow(TranscriptValidationError);
    expect(() => validateTranscriptForTts(
      "monologue",
      "Locuteur 1 : Bonjour tout le monde."
    )).toThrow(TranscriptValidationError);
    expect(() => validateTranscriptForTts(
      "monologue",
      "Léa : Bonjour.\nKarim : Salut."
    )).toThrow(/Invalid line: Léa : Bonjour\./);
  });

  it("accepts French typography colons in monologue mode, as the studio does", () => {
    for (const script of [
      "Attention : l'examen commence à 9 heures.",
      "Remarque : ce verbe est irrégulier.",
      "Un petit conseil : restez sobre.",
      "Attention : l'examen commence à 9 heures.\nRemarque : ce verbe est irrégulier.",
    ]) {
      expect(() => validateTranscriptForTts("monologue", script), script).not.toThrow();
    }
  });

  it("accepts prose colons in monologue mode (phase 7 harness finding)", () => {
    expect(() => validateTranscriptForTts(
      "monologue",
      "Claire posa sa valise sur le quai et regarda l'horloge : six heures dix."
    )).not.toThrow();
    expect(() => validateTranscriptForTts(
      "monologue",
      "Some employees enjoy the flexibility: they can start earlier."
    )).not.toThrow();
  });
});

describe("monologue manner-of-speaking note", () => {
  it("appends the note to the narrator profile line", () => {
    const prompt = compileDirection({
      mode: "monologue",
      speakers: ["solo"],
      script: "Good morning everyone.",
      direction: {
        level: "B1",
        accent: "Neutral international",
        pace: "Natural classroom speed",
        style: "Storytelling",
        notes: "hesitates often, searches for words.",
      },
    });

    expect(prompt).toContain(
      "The speaker: Expressive narration with clear images and controlled emotion. Manner of speaking: hesitates often, searches for words."
    );
  });
});

// Defense in depth: the queue consumer feeds compileDirection whatever
// direction_json is stored on the job. A malformed/partial direction
// (missing preset fields) must degrade gracefully, not crash the worker
// with "Cannot read properties of undefined (reading 'replace')".
describe("compileDirection tolerates a malformed direction", () => {
  it("does not throw when preset fields are missing", () => {
    expect(() =>
      compileDirection({
        mode: "monologue",
        speakers: ["solo"],
        script: "Bonjour.",
        // Cast: this shape can only reach us from stored/legacy job data,
        // never from the (now Zod-validated) create endpoint.
        direction: {} as never,
      })
    ).not.toThrow();
  });

  it("does not throw when the CEFR level is unknown", () => {
    expect(() =>
      compileDirection({
        mode: "monologue",
        speakers: ["solo"],
        script: "Bonjour.",
        direction: {
          level: "Z9",
          accent: "Neutral",
          pace: "Natural",
          style: "Warm",
        } as never,
      })
    ).not.toThrow();
  });
})

describe("hasRegionalAccent", () => {
  const base = { level: "B1", pace: "Natural classroom speed", style: "Informal conversation" } as const;

  it("is false for a language's everyday pronunciation", () => {
    expect(hasRegionalAccent({ ...base, accent: "Neutral" }, "monologue")).toBe(false);
    expect(hasRegionalAccent({ ...base, accent: "Parisian", accentDetail: "  " }, "monologue")).toBe(false);
  });

  it("is true for a free accent text or a regional preset", () => {
    expect(hasRegionalAccent({ ...base, accent: "Neutral", accentDetail: "accent du midi" }, "monologue")).toBe(true);
    expect(hasRegionalAccent({ ...base, accent: "Canadian" }, "monologue")).toBe(true);
  });

  it("looks at each speaker's own accent in a dialogue only", () => {
    const direction = { ...base, accent: "Neutral", speakers: { "Speaker 2": { accentDetail: "marseillais prononcé" } } };
    expect(hasRegionalAccent(direction, "dialogue")).toBe(true);
    expect(hasRegionalAccent(direction, "monologue")).toBe(false);
  });
});

describe("withAccentBriefs", () => {
  const base = { level: "B1", pace: "Natural classroom speed", style: "Informal conversation" } as const;
  const brief = async (accent: string) => `BRIEF(${accent})`;

  it("rewrites a regional accent and leaves a native one alone", async () => {
    expect((await withAccentBriefs({ ...base, accent: "Neutral", accentDetail: "accent du midi" }, "monologue", brief)).accentDetail)
      .toBe("BRIEF(accent du midi)");
    expect((await withAccentBriefs({ ...base, accent: "Canadian" }, "monologue", brief)).accentDetail)
      .toBe("BRIEF(Canadian French)");
    expect(await withAccentBriefs({ ...base, accent: "Parisian" }, "monologue", brief)).toEqual({ ...base, accent: "Parisian" });
  });

  it("rewrites a dialogue speaker's own accent, and the prompt states each speaker's accent", async () => {
    const direction = await withAccentBriefs(
      { ...base, accent: "Neutral", speakers: { "Speaker 2": { accentDetail: "accent du sud" } } },
      "dialogue",
      brief
    );
    expect(direction.accentDetail).toBeUndefined();
    expect(direction.speakers?.["Speaker 2"]?.accentDetail).toBe("BRIEF(accent du sud)");

    const prompt = compileDirection({ direction, mode: "dialogue", speakers: ["Speaker 1", "Speaker 2"], script: "Speaker 1: Salut.\nSpeaker 2: Bonjour." });
    expect(prompt).toContain("Speaker 1: Relaxed, spontaneous, and natural. Accent: Neutral French.");
    expect(prompt).toContain("Speaker 2: Relaxed, spontaneous, and natural. Accent: BRIEF(accent du sud).");
    expect(prompt).not.toContain("\nAccent: Neutral French.");
  });
});
