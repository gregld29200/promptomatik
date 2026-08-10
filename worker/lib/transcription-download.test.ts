import { describe, expect, it } from "vitest";
import fr from "../../src/lib/i18n/fr.json";
import en from "../../src/lib/i18n/en.json";
import es from "../../src/lib/i18n/es.json";
import {
  SPEAKER_LABEL,
  isTranscriptDownloadLanguage,
  readableTimecode,
  renderTranscriptDownload,
  renderTranscriptTxt,
  renderTranscriptVtt,
  transcriptFilenameStem,
} from "./transcription-download";
import type {
  NormalisedTranscript,
  TranscriptSegment,
  TranscriptWord,
} from "./transcription/types";

function word(text: string, start: number, end: number, speaker: string | null): TranscriptWord {
  return { text, start, end, speaker, confidence: 0.9, language: "fr" };
}

function segment(
  idx: number,
  speaker: string | null,
  words: TranscriptWord[]
): TranscriptSegment {
  return {
    idx,
    speaker,
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map((item) => item.text).join(" "),
    words,
    language: "fr",
  };
}

const DIARIZED: NormalisedTranscript = {
  metadata: {
    provider: "deepgram",
    providerJobId: "req-1",
    model: "nova-3",
    durationSeconds: 12,
    detectedLanguages: ["fr"],
    diarization: true,
    speakerCount: 2,
    channels: 1,
  },
  speakers: [
    { id: "0", index: 0, label: "speaker_0", seconds: 4 },
    { id: "1", index: 1, label: "speaker_1", seconds: 3 },
  ],
  segments: [
    segment(0, "0", [word("Bonjour", 0, 0.6, "0"), word("Claire.", 0.7, 1.4, "0")]),
    segment(1, "1", [word("Merci", 2, 2.5, "1"), word("beaucoup.", 2.6, 3.3, "1")]),
  ],
  text: "Bonjour Claire.\n\nMerci beaucoup.",
};

const UNDIARIZED: NormalisedTranscript = {
  ...DIARIZED,
  metadata: { ...DIARIZED.metadata, provider: "groq", model: "whisper-large-v3-turbo", diarization: false, speakerCount: null },
  speakers: [],
  segments: DIARIZED.segments.map((item) => ({
    ...item,
    speaker: null,
    words: item.words.map((w) => ({ ...w, speaker: null })),
  })),
};

describe("speaker label parity with the interface", () => {
  // The Worker has no i18n runtime and an <a download> cannot carry rendered
  // strings, so this one label is duplicated in transcription-download.ts.
  // This test is what stops it drifting away from what the teacher sees.
  it("matches transcription.speaker_n in fr, en and es", () => {
    const catalogues = { fr, en, es } as Record<
      "fr" | "en" | "es",
      { transcription: { speaker_n: string } }
    >;
    for (const lang of ["fr", "en", "es"] as const) {
      expect(SPEAKER_LABEL[lang]).toBe(catalogues[lang].transcription.speaker_n);
    }
  });

  it("recognises exactly the three interface languages", () => {
    expect(isTranscriptDownloadLanguage("fr")).toBe(true);
    expect(isTranscriptDownloadLanguage("es")).toBe(true);
    expect(isTranscriptDownloadLanguage("de")).toBe(false);
  });
});

describe("readableTimecode", () => {
  it("drops the hour until there is one", () => {
    expect(readableTimecode(0)).toBe("00:00");
    expect(readableTimecode(75)).toBe("01:15");
    expect(readableTimecode(3725)).toBe("1:02:05");
  });

  it("treats a nonsense duration as zero rather than printing NaN", () => {
    expect(readableTimecode(Number.NaN)).toBe("00:00");
    expect(readableTimecode(-4)).toBe("00:00");
  });
});

describe("txt", () => {
  it("puts a timecode and a localised speaker on each turn", () => {
    const out = renderTranscriptTxt(DIARIZED, "Entretien Claire", "fr");
    expect(out).toContain("Entretien Claire");
    expect(out).toContain("[00:00] Intervenant 1");
    expect(out).toContain("[00:02] Intervenant 2");
    expect(out).toContain("Bonjour Claire.");
  });

  it("omits the speaker entirely when the provider could not diarize", () => {
    const out = renderTranscriptTxt(UNDIARIZED, "Podcast", "fr");
    expect(out).toContain("[00:00]\nBonjour Claire.");
    expect(out).not.toContain("Intervenant");
  });

  it("localises the speaker label", () => {
    expect(renderTranscriptTxt(DIARIZED, "x", "es")).toContain("Interlocutor 1");
    expect(renderTranscriptTxt(DIARIZED, "x", "en")).toContain("Speaker 1");
  });
});

describe("vtt", () => {
  it("starts with the WEBVTT header and uses dot milliseconds and voice spans", () => {
    const out = renderTranscriptVtt(DIARIZED, "fr");
    expect(out.startsWith("WEBVTT\n")).toBe(true);
    expect(out).toContain("00:00:00.000 --> 00:00:01.400");
    expect(out).toContain("<v Intervenant 1>Bonjour Claire.");
  });

  // Moved here when srt was removed (2026-08-10): the behaviour under test is
  // allCues()'s cue splitting, which vtt shares — it was never srt-specific.
  it("splits a long turn into several readable cues instead of one unusable block", () => {
    // 40 words over 20 seconds in ONE segment: a diarized turn of that length
    // is ordinary, and as a single cue it is an unusable subtitle.
    const words = Array.from({ length: 40 }, (_, i) =>
      word(`mot${i}`, i * 0.5, i * 0.5 + 0.4, "0")
    );
    const long: NormalisedTranscript = { ...DIARIZED, segments: [segment(0, "0", words)] };
    const blocks = renderTranscriptVtt(long, "fr")
      .split("\n\n")
      .filter((block) => block.trim().length > 0 && block.trim() !== "WEBVTT");

    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const block of blocks) {
      const [, ...text] = block.split("\n");
      // Each cue must stay inside the two-line reading budget: at most 16 words
      // and at most ~84 characters after the voice span.
      const spoken = text.join(" ").replace(/^<v Intervenant \d+>/, "").trim();
      expect(spoken.split(/\s+/).length).toBeLessThanOrEqual(16);
      expect(spoken.length).toBeLessThanOrEqual(84);
    }
  });

  it("writes a bare cue when there are no speakers to attribute", () => {
    const out = renderTranscriptVtt(UNDIARIZED, "fr");
    expect(out).not.toContain("<v ");
    expect(out).toContain("Bonjour Claire.");
  });
});

describe("renderTranscriptDownload", () => {
  it("names the file after the transcript and falls back when the title is unusable", () => {
    expect(renderTranscriptDownload("txt", DIARIZED, "Entretien Claire", "fr").filename).toBe(
      "entretien-claire.txt"
    );
    expect(transcriptFilenameStem("   ")).toBe("transcription");
    expect(transcriptFilenameStem("Épisode n°4 : l'oral")).toBe("episode-n-4-l-oral");
  });

  it("gives every format its own content type and extension", () => {
    for (const format of ["txt", "vtt"] as const) {
      const rendered = renderTranscriptDownload(format, DIARIZED, "x", "fr");
      expect(rendered.filename.endsWith(`.${format}`)).toBe(true);
      expect(rendered.body.length).toBeGreaterThan(0);
    }
  });
});
