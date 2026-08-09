// The two limits the browser enforces before anything is uploaded, and the
// constants they enforce.
//
// ---------------------------------------------------------------------------
// WHY THE FIRST TEST IS THE IMPORTANT ONE
// ---------------------------------------------------------------------------
// `MAX_UPLOAD_BYTES`, `MAX_SOURCE_SECONDS` and `RETENTION_DAYS` in
// transcription-display.ts are hand-copied from `TRANSCRIPTION_MAX_UPLOAD_BYTES`,
// `TRANSCRIPTION_MAX_SOURCE_SECONDS` and `TRANSCRIPTION_RETENTION_DAYS` in
// worker/lib/transcription/types.ts, and they were kept in step by a comment
// saying "keep the two in step". A comment is not a mechanism. Move the Worker's
// ceiling and every one of these tests still passes while the interface refuses
// at the wrong number and every limit sentence a teacher reads becomes false.
// `RETENTION_DAYS` is the same trap one step quieter: it feeds `{{days}}` into
// `transcription.retention_notice` and `transcription.expired_body`, so a Worker
// that starts purging after three days would leave the form promising a week, in
// three languages, with nothing red.
//
// So the Worker's own module is imported here — it is pure, with no runtime
// dependency on anything Workers-specific — and all three numbers are compared
// directly. That is the assertion; the boundary cases below are the behaviour.
//
// The i18n layer is real, not stubbed: the messages must actually resolve, and a
// missing key would come back as the bare key string.

import { describe, expect, it } from "vitest";
import en from "./i18n/en.json";
import es from "./i18n/es.json";
import fr from "./i18n/fr.json";
import {
  TRANSCRIPTION_MAX_SOURCE_SECONDS,
  TRANSCRIPTION_MAX_UPLOAD_BYTES,
  TRANSCRIPTION_RETENTION_DAYS,
} from "../../worker/lib/transcription/types";
import {
  MAX_SOURCE_SECONDS,
  MAX_UPLOAD_BYTES,
  RETENTION_DAYS,
  failureMessage,
  fileDurationWarning,
  fileSizeWarning,
  formatBytes,
} from "./transcription-display";

/** A File of a given size, without allocating the bytes. */
function fileOfSize(size: number): File {
  const file = new File([], "lesson.mp3", { type: "audio/mpeg" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("the client mirrors of the Worker's limits", () => {
  it("refuses at exactly the byte ceiling the Worker enforces", () => {
    expect(MAX_UPLOAD_BYTES).toBe(TRANSCRIPTION_MAX_UPLOAD_BYTES);
  });

  it("refuses at exactly the length cap the Worker enforces", () => {
    expect(MAX_SOURCE_SECONDS).toBe(TRANSCRIPTION_MAX_SOURCE_SECONDS);
  });

  it("counts down to exactly the day the Worker's purge deletes on", () => {
    expect(RETENTION_DAYS).toBe(TRANSCRIPTION_RETENTION_DAYS);
  });
});

describe("fileSizeWarning", () => {
  it("accepts a file exactly at the ceiling", () => {
    expect(fileSizeWarning(fileOfSize(MAX_UPLOAD_BYTES))).toBeNull();
  });

  it("refuses one byte over, and says what to do instead", () => {
    const message = fileSizeWarning(fileOfSize(MAX_UPLOAD_BYTES + 1));
    expect(message).not.toBeNull();
    // Both numbers, and a next step — "your file is too big" on its own leaves a
    // teacher holding a file with nowhere to go.
    expect(message).toContain("64 Mo");
    expect(message).toContain("lien");
  });

  it("accepts an empty file rather than dividing by nothing", () => {
    expect(fileSizeWarning(fileOfSize(0))).toBeNull();
  });
});

describe("fileDurationWarning", () => {
  it("accepts a recording exactly at the 90-minute cap", () => {
    expect(fileDurationWarning(MAX_SOURCE_SECONDS)).toBeNull();
  });

  it("refuses one second over", () => {
    expect(fileDurationWarning(MAX_SOURCE_SECONDS + 1)).not.toBeNull();
  });

  it("stays silent on a length the browser could not read", () => {
    // `readMediaDuration` resolves to null for a container it cannot decode, and
    // Infinity is what a live stream reports. Neither is a reason to refuse a
    // file the Worker may well accept.
    expect(fileDurationWarning(Number.NaN)).toBeNull();
    expect(fileDurationWarning(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("formatBytes", () => {
  it("counts decimal megabytes, the way Finder and the Files app do", () => {
    // 73,400,320 bytes is "73,4 Mo" in Finder. Binary maths called it 70 Mo, so
    // the number in the refusal never matched the number on the teacher's screen.
    expect(formatBytes(73_400_320)).toBe("73 Mo");
    expect(formatBytes(MAX_UPLOAD_BYTES)).toBe("64 Mo");
  });

  it("keeps one decimal under 10 MB, where the difference is legible", () => {
    expect(formatBytes(2_400_000)).toBe("2.4 Mo");
  });

  it("treats a missing or nonsense size as zero rather than NaN", () => {
    expect(formatBytes(null)).toBe("0 Mo");
    expect(formatBytes(Number.NaN)).toBe("0 Mo");
  });
});

describe("failureMessage — an over-long source", () => {
  const failure = {
    code: "source_too_long" as const,
    durationSeconds: 6_720,
    maxSeconds: MAX_SOURCE_SECONDS,
  };

  it("tells a teacher to trim their own file", () => {
    expect(failureMessage(failure, { sourceKind: "upload" })).toContain("découpez-le");
  });

  it("never tells them to trim an episode hosted somewhere else", () => {
    // The 90 minutes are enforced identically on a link, but "cut it in two and
    // start again" is an instruction a teacher cannot follow for a podcast on
    // someone else's server.
    for (const sourceKind of ["direct_url", "podcast"] as const) {
      const message = failureMessage(failure, { sourceKind });
      expect(message).not.toContain("découpez-le");
      expect(message).toContain("épisode plus court");
    }
  });

  it("falls back to the file wording when the source is unknown", () => {
    expect(failureMessage(failure)).toContain("découpez-le");
  });
});

// ---------------------------------------------------------------------------
// The limits stated in PROSE, in three languages.
// ---------------------------------------------------------------------------
// `source_hint` and `limits_help_body` spell "64 Mo" and "90 minutes" out as
// words, in fr/en/es, because a sentence built by interpolation reads like a
// form and these two are the calm explanation beside the field. The cost of that
// choice is six numbers that no compiler is watching — and this feature has
// already been through one round of exactly that drift, when the upload ceiling
// went from 100 MB to 64 MB and five comments went on saying 100.
//
// So the numbers are derived from the Worker's own constants here and looked for
// in every catalogue. If the ceiling moves, this fails and names the language
// whose sentence became false, instead of a teacher discovering it.
describe("the limit sentences agree with the Worker's constants", () => {
  const catalogues = { fr, en, es } as const;
  const megabytes = String(TRANSCRIPTION_MAX_UPLOAD_BYTES / 1_000_000);
  const minutes = String(TRANSCRIPTION_MAX_SOURCE_SECONDS / 60);

  for (const [language, catalogue] of Object.entries(catalogues)) {
    const strings = catalogue.transcription as Record<string, string>;

    it(`states the real byte ceiling in ${language}`, () => {
      for (const key of ["source_hint", "limits_help_body"]) {
        expect(strings[key]).toContain(megabytes);
      }
    });

    it(`states the real length cap in ${language}`, () => {
      for (const key of ["source_hint", "limits_help_body"]) {
        expect(strings[key]).toContain(minutes);
      }
    });
  }
});
