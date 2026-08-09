import { describe, expect, it } from "vitest";
import {
  maxBytesPerSecond,
  minimumDurationSeconds,
  sniffContainerDuration,
} from "./transcription-duration";

// ---------------------------------------------------------------------------
// Container builders. Every buffer here is hand-written from the format spec —
// no fixture file, so what each parser depends on is visible in the test.
// ---------------------------------------------------------------------------

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i);
  return out;
}

function be32(value: number): Uint8Array {
  return bytes((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function le32(value: number): Uint8Array {
  return bytes(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function le16(value: number): Uint8Array {
  return bytes(value & 0xff, (value >>> 8) & 0xff);
}

function pad(length: number, fill = 0): Uint8Array {
  return new Uint8Array(length).fill(fill);
}

/** ID3v2 tag with `size` bytes of (irrelevant) payload, syncsafe-encoded. */
function id3(size: number): Uint8Array {
  const syncsafe = bytes(
    (size >>> 21) & 0x7f,
    (size >>> 14) & 0x7f,
    (size >>> 7) & 0x7f,
    size & 0x7f
  );
  return concat(ascii("ID3"), bytes(0x03, 0x00, 0x00), syncsafe, pad(size));
}

/** MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo. */
const MPEG1_STEREO_HEADER = bytes(0xff, 0xfb, 0x90, 0x00);

/** MPEG-1 Layer III frame carrying a Xing header that declares `frames`. */
function xingFrame(frames: number): Uint8Array {
  return concat(
    MPEG1_STEREO_HEADER,
    pad(32), // side info for MPEG-1 stereo
    ascii("Xing"),
    be32(0x01), // flags: frame count present
    be32(frames),
    pad(64)
  );
}

function mvhdBox(timescale: number, duration: number): Uint8Array {
  const payload = concat(
    bytes(0x00, 0x00, 0x00, 0x00), // version 0 + flags
    be32(0), // creation
    be32(0), // modification
    be32(timescale),
    be32(duration)
  );
  return concat(be32(payload.length + 8), ascii("mvhd"), payload);
}

function mvhdBox64(timescale: number, duration: number): Uint8Array {
  const payload = concat(
    bytes(0x01, 0x00, 0x00, 0x00), // version 1 + flags
    pad(16), // 64-bit creation + modification
    be32(timescale),
    be32(0), // duration, high word
    be32(duration)
  );
  return concat(be32(payload.length + 8), ascii("mvhd"), payload);
}

function mp4(inner: Uint8Array, withMoov = true): Uint8Array {
  const ftyp = concat(be32(16), ascii("ftyp"), ascii("M4A "), be32(0));
  if (!withMoov) return concat(ftyp, concat(be32(inner.length + 8), ascii("free"), inner));
  const moov = concat(be32(inner.length + 8), ascii("moov"), inner);
  return concat(ftyp, moov);
}

function wav(sampleRate: number, byteRate: number, dataSize: number): Uint8Array {
  const fmt = concat(
    ascii("fmt "),
    le32(16),
    le16(1), // PCM
    le16(2), // channels
    le32(sampleRate),
    le32(byteRate),
    le16(4),
    le16(16)
  );
  const data = concat(ascii("data"), le32(dataSize));
  const body = concat(ascii("WAVE"), fmt, data);
  return concat(ascii("RIFF"), le32(body.length + 4), body);
}

function flac(sampleRate: number, totalSamples: number): Uint8Array {
  // 20 bits sample rate, 3 bits channels, 5 bits depth, 36 bits total samples.
  const high = Math.floor(totalSamples / 0x100000000) & 0x0f;
  const low = totalSamples % 0x100000000;
  const packed = concat(
    bytes((sampleRate >>> 12) & 0xff, (sampleRate >>> 4) & 0xff, ((sampleRate & 0x0f) << 4) | (1 << 1) | 0),
    bytes(((15 & 0x01) << 4) | high),
    be32(low)
  );
  const streaminfo = concat(pad(10), packed, pad(16));
  return concat(ascii("fLaC"), bytes(0x00), bytes(0x00, 0x00, 0x22), streaminfo);
}

// ---------------------------------------------------------------------------
// MP3
// ---------------------------------------------------------------------------

describe("sniffContainerDuration — MPEG audio", () => {
  it("reads the exact duration out of a Xing frame count", () => {
    const head = concat(id3(2048), xingFrame(2297));
    const sniffed = sniffContainerDuration(head, 5_000_000);
    expect(sniffed?.source).toBe("mp3_xing");
    // 2297 frames x 1152 samples / 44100 Hz
    expect(sniffed?.seconds).toBeCloseTo((2297 * 1152) / 44100, 3);
  });

  it("derives a CBR duration from the audio byte count when there is no Xing header", () => {
    const start = id3(1024);
    const head = concat(start, MPEG1_STEREO_HEADER, pad(4096));
    // 128 kbps over 1 600 000 audio bytes = 100 s.
    const total = start.length + 1_600_000;
    const sniffed = sniffContainerDuration(head, total);
    expect(sniffed?.source).toBe("mp3_cbr");
    expect(sniffed?.seconds).toBeCloseTo(100, 1);
  });

  it("is the gate that catches a seven-hour podcast the byte bound waves through", () => {
    // 200 MB at 64 kbps mono is ~7 hours. 200 MB / 40 kB/s is 5 000 s, so the
    // byte bound alone admits it — only the frame header knows the truth.
    const monoHeader = bytes(0xff, 0xfb, 0x50, 0xc0); // 64 kbps, 44.1 kHz, mono
    const head = concat(monoHeader, pad(2048));
    const sniffed = sniffContainerDuration(head, 200_000_000);
    expect(sniffed?.source).toBe("mp3_cbr");
    expect(sniffed?.seconds ?? 0).toBeGreaterThan(24_000);
    expect(minimumDurationSeconds("audio/mpeg", 200_000_000)).toBeLessThan(5_400);
  });

  it("returns null for a free-format frame rather than inventing a bitrate", () => {
    const head = concat(bytes(0xff, 0xfb, 0x00, 0x00), pad(2048));
    expect(sniffContainerDuration(head, 10_000_000)).toBeNull();
  });

  it("returns null when the head carries no frame sync at all", () => {
    expect(sniffContainerDuration(pad(4096, 0x42), 10_000_000)).toBeNull();
  });

  it("returns null for a CBR file whose total length we do not know", () => {
    const head = concat(MPEG1_STEREO_HEADER, pad(1024));
    expect(sniffContainerDuration(head, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MP4
// ---------------------------------------------------------------------------

describe("sniffContainerDuration — MP4", () => {
  it("reads timescale and duration out of a version 0 mvhd", () => {
    const sniffed = sniffContainerDuration(mp4(mvhdBox(600, 600 * 754)), 40_000_000);
    expect(sniffed).toEqual({ seconds: 754, source: "mp4_mvhd" });
  });

  it("reads a version 1 mvhd, whose fields sit at different offsets", () => {
    const sniffed = sniffContainerDuration(mp4(mvhdBox64(48_000, 48_000 * 3_600)), 40_000_000);
    expect(sniffed).toEqual({ seconds: 3_600, source: "mp4_mvhd" });
  });

  it("returns null when moov is not in the head (a file that is not faststart)", () => {
    expect(sniffContainerDuration(mp4(pad(64), false), 40_000_000)).toBeNull();
  });

  it("returns null for an mvhd with a zero timescale instead of dividing by it", () => {
    expect(sniffContainerDuration(mp4(mvhdBox(0, 1_000)), 40_000_000)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WAV / FLAC
// ---------------------------------------------------------------------------

describe("sniffContainerDuration — WAV", () => {
  it("divides the data chunk by the byte rate", () => {
    const sniffed = sniffContainerDuration(wav(44_100, 176_400, 176_400 * 120), 21_200_000);
    expect(sniffed).toEqual({ seconds: 120, source: "wav_fmt" });
  });

  it("falls back to the file length for a streamed data chunk of 0xFFFFFFFF", () => {
    const head = wav(44_100, 176_400, 0xffffffff);
    const sniffed = sniffContainerDuration(head, head.length + 176_400 * 30);
    expect(sniffed?.source).toBe("wav_fmt");
    expect(sniffed?.seconds ?? 0).toBeCloseTo(30, 0);
  });

  it("refuses an implausible sample rate rather than reporting a wild duration", () => {
    expect(sniffContainerDuration(wav(1, 176_400, 176_400 * 120), 21_200_000)).toBeNull();
  });
});

describe("sniffContainerDuration — FLAC", () => {
  it("divides total samples by the sample rate", () => {
    const sniffed = sniffContainerDuration(flac(48_000, 48_000 * 900), 60_000_000);
    expect(sniffed).toEqual({ seconds: 900, source: "flac_streaminfo" });
  });

  it("returns null when the encoder did not know the sample count", () => {
    expect(sniffContainerDuration(flac(48_000, 0), 60_000_000)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Containers we cannot read from the head
// ---------------------------------------------------------------------------

describe("sniffContainerDuration — unreadable heads", () => {
  it("returns null for Ogg/Opus, whose length lives in the last page", () => {
    const head = concat(ascii("OggS"), pad(4096));
    expect(sniffContainerDuration(head, 30_000_000)).toBeNull();
  });

  it("returns null for a head too short to hold any magic", () => {
    expect(sniffContainerDuration(bytes(1, 2, 3), 1_000)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Byte-derived lower bound
// ---------------------------------------------------------------------------

describe("minimumDurationSeconds", () => {
  it("uses the highest bitrate the container can carry, so the bound is a floor", () => {
    // 320 kbps = 40 kB/s: 90 minutes of MP3 cannot exceed ~216 MB.
    expect(maxBytesPerSecond("audio/mpeg")).toBe(40_000);
    expect(minimumDurationSeconds("audio/mpeg", 216_000_000)).toBe(5_400);
    expect(minimumDurationSeconds("audio/mpeg", 300_000_000)).toBeGreaterThan(5_400);
  });

  it("proves a 3 GB file is too long, which the old 750 kB/s ceiling did not", () => {
    expect(minimumDurationSeconds("audio/mpeg", 3 * 1024 * 1024 * 1024)).toBeGreaterThan(5_400);
  });

  it("knows nothing about a source with no declared length", () => {
    expect(minimumDurationSeconds("audio/mpeg", null)).toBeNull();
    expect(minimumDurationSeconds("audio/mpeg", 0)).toBeNull();
  });

  it("gives an unknown content type the most generous ceiling we use", () => {
    expect(maxBytesPerSecond(null)).toBe(600_000);
    expect(maxBytesPerSecond("audio/x-something-new")).toBe(600_000);
  });
});
