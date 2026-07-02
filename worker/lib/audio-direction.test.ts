import { describe, expect, it } from "vitest";
import { TranscriptValidationError, compileDirection, validateTranscriptForTts } from "./audio-direction";

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
          accentDetail: "Croydon",
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
      Accent: British English., specifically Croydon
      Pacing: Business meeting speed with realistic professional rhythm. Close to natural pace, realistic rhythm.
      Clarity: Natural but clear; reduced forms allowed.

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
              accentDetail: "a learner from Lyon",
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
      Speaker 1: A clear, balanced classroom delivery focused on comprehension. Accent: English spoken with a French accent, specifically a learner from Lyon. Manner of speaking: hesitates and searches for words.
      Speaker 2: Objective, measured, calm, and consistent.

      DIRECTOR'S NOTES:
      Style: A clear, balanced classroom delivery focused on comprehension.
      Accent: Neutral international English.
      Pacing: Natural classroom speed, clear but not artificial. Controlled natural pace with moderate pauses between ideas.
      Clarity: Clear articulation, limited reduced forms, clear sentence stress.

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
      Accent: Neutral international English.
      Pacing: Exam speed: controlled, neutral, and consistent. Fully authentic pace and rhythm, subtle emotion.
      Clarity: Authentic speech; natural linking and reduction.

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
      "Sarah: Bonjour tout le monde."
    )).toThrow(TranscriptValidationError);
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
