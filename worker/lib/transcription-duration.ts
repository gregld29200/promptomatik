// Transcription Studio — how long is this media, before we pay to find out?
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// The 90-minute per-source cap is the only thing standing between one teacher's
// paste box and an unbounded provider bill. It cannot be enforced from a byte
// count alone: a 345 MB file is nine hours at 64 kbps and forty minutes at
// 1.1 Mbit/s. So we read the container header — the bytes the encoder wrote to
// say how long the audio is — and only fall back to arithmetic when the header
// does not tell us.
//
// Two numbers come out of here and they mean different things:
//
//   `sniffContainerDuration`  the container's OWN statement of its length.
//                             Accurate to a frame. Used to accept, to reject,
//                             and to pre-fill the job row.
//   `minimumDurationSeconds`  a LOWER BOUND derived from the byte count and the
//                             highest bitrate that container can plausibly
//                             carry. It can only ever prove a file is too long;
//                             it never claims to know how long it is.
//
// Both are conservative by construction. Every parser below returns null the
// moment a field is implausible (a sample rate no encoder uses, a duration
// longer than a day), because a wrong *large* number rejects a teacher's real
// lecture and a wrong *small* one is harmless — billing always uses what the
// provider measured, never anything computed here.

/** How we learned the duration. Recorded for logs and tests, never shown to a teacher. */
export type DurationSource = "mp3_xing" | "mp3_cbr" | "mp4_mvhd" | "wav_fmt" | "flac_streaminfo";

export interface SniffedDuration {
  seconds: number;
  source: DurationSource;
}

/** Nothing real is longer than this; past it we are reading garbage as a header. */
const MAX_PLAUSIBLE_SECONDS = 24 * 60 * 60;
const MIN_SAMPLE_RATE = 6_000;
const MAX_SAMPLE_RATE = 384_000;

/**
 * The highest byte rate each container plausibly carries, in bytes per second.
 * Used ONLY to divide a byte count into a lower bound on seconds, so every
 * value here is a generous ceiling: too high wastes headroom, too low would
 * reject a legitimate high-bitrate file.
 *
 *   audio/mpeg  320 kbps is the highest bitrate MP3 defines at all.
 *   AAC/Opus    practical ceilings well above any spoken-word encode.
 *   wav/flac    24-bit / 96 kHz stereo PCM is ~576 kB/s; FLAC is barely under.
 *               Both containers state their length in the header, so this
 *               fallback is almost never the number that decides anything.
 */
const MAX_BYTES_PER_SECOND: Readonly<Record<string, number>> = {
  "audio/mpeg": 40_000,
  "audio/mp3": 40_000,
  "audio/mpeg3": 40_000,
  "audio/x-mpeg-3": 40_000,
  "audio/mp4": 40_000,
  "audio/m4a": 40_000,
  "audio/x-m4a": 40_000,
  "audio/aac": 40_000,
  "audio/aacp": 40_000,
  "audio/opus": 64_000,
  "audio/ogg": 64_000,
  "audio/webm": 64_000,
  "audio/wav": 600_000,
  "audio/wave": 600_000,
  "audio/x-wav": 600_000,
  "audio/vnd.wave": 600_000,
  "audio/flac": 600_000,
  "audio/x-flac": 600_000,
};

/** An unknown-but-allowed type gets the most generous ceiling we use anywhere. */
const DEFAULT_MAX_BYTES_PER_SECOND = 600_000;

export function maxBytesPerSecond(contentType: string | null): number {
  if (contentType === null) return DEFAULT_MAX_BYTES_PER_SECOND;
  return MAX_BYTES_PER_SECOND[contentType.toLowerCase()] ?? DEFAULT_MAX_BYTES_PER_SECOND;
}

/**
 * The shortest this media can possibly be, given its size and its container.
 * Null when we do not know the byte count — an unbounded stream has no length
 * to reason about and the caller must refuse it rather than guess.
 */
export function minimumDurationSeconds(contentType: string | null, totalBytes: number | null): number | null {
  if (totalBytes === null || !Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  return Math.floor(totalBytes / maxBytesPerSecond(contentType));
}

// ---------------------------------------------------------------------------
// Byte readers. Every one is bounds-checked: the head is a prefix of a file we
// did not write, so running off the end is the normal case, not an error.
// ---------------------------------------------------------------------------

function u8(bytes: Uint8Array, at: number): number | null {
  return at >= 0 && at < bytes.length ? bytes[at] : null;
}

function be24(bytes: Uint8Array, at: number): number | null {
  if (at < 0 || at + 3 > bytes.length) return null;
  return (bytes[at] << 16) | (bytes[at + 1] << 8) | bytes[at + 2];
}

/** Unsigned — `<<24` would sign-flip anything with the top bit set. */
function be32(bytes: Uint8Array, at: number): number | null {
  if (at < 0 || at + 4 > bytes.length) return null;
  return bytes[at] * 0x1000000 + ((bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]);
}

function le32(bytes: Uint8Array, at: number): number | null {
  if (at < 0 || at + 4 > bytes.length) return null;
  return bytes[at + 3] * 0x1000000 + ((bytes[at + 2] << 16) | (bytes[at + 1] << 8) | bytes[at]);
}

/** ASCII tag comparison — container magic is always ASCII. */
function tagAt(bytes: Uint8Array, at: number, tag: string): boolean {
  if (at < 0 || at + tag.length > bytes.length) return false;
  for (let i = 0; i < tag.length; i += 1) {
    if (bytes[at + i] !== tag.charCodeAt(i)) return false;
  }
  return true;
}

/** A duration is only returned when it could describe real audio. */
function plausible(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_PLAUSIBLE_SECONDS) return null;
  return seconds;
}

function plausibleRate(rate: number | null): number | null {
  if (rate === null || rate < MIN_SAMPLE_RATE || rate > MAX_SAMPLE_RATE) return null;
  return rate;
}

// ---------------------------------------------------------------------------
// MP3 / MPEG audio
// ---------------------------------------------------------------------------

/** kbps by bitrate index. Layer III only — other layers bail to the byte bound. */
const MPEG1_LAYER3_BITRATES: readonly number[] = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const MPEG2_LAYER3_BITRATES: readonly number[] = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
];
const MPEG1_RATES: readonly number[] = [44_100, 48_000, 32_000];
const MPEG2_RATES: readonly number[] = [22_050, 24_000, 16_000];
const MPEG25_RATES: readonly number[] = [11_025, 12_000, 8_000];

interface MpegFrame {
  /** Bits per second. */
  bitrate: number;
  sampleRate: number;
  samplesPerFrame: number;
  /** True for MPEG-1, which puts the Xing header further into the frame. */
  version1: boolean;
  mono: boolean;
}

/** Where the audio starts: after an ID3v2 tag, if there is one. */
function audioOffset(bytes: Uint8Array): number {
  if (!tagAt(bytes, 0, "ID3")) return 0;
  const flags = u8(bytes, 5);
  const size =
    ((u8(bytes, 6) ?? 0) & 0x7f) * 0x200000 +
    (((u8(bytes, 7) ?? 0) & 0x7f) << 14) +
    (((u8(bytes, 8) ?? 0) & 0x7f) << 7) +
    ((u8(bytes, 9) ?? 0) & 0x7f);
  const footer = flags !== null && (flags & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
}

function parseMpegFrame(bytes: Uint8Array, at: number): MpegFrame | null {
  const b1 = u8(bytes, at + 1);
  const b2 = u8(bytes, at + 2);
  const b3 = u8(bytes, at + 3);
  if (b1 === null || b2 === null || b3 === null) return null;

  const versionBits = (b1 >> 3) & 0x03;
  if (versionBits === 1) return null; // reserved
  const layer = (b1 >> 1) & 0x03;
  if (layer !== 1) return null; // Layer III only

  const bitrateIndex = (b2 >> 4) & 0x0f;
  const rateIndex = (b2 >> 2) & 0x03;
  if (rateIndex === 3) return null;

  const version1 = versionBits === 3;
  const kbps = version1 ? MPEG1_LAYER3_BITRATES[bitrateIndex] : MPEG2_LAYER3_BITRATES[bitrateIndex];
  if (kbps === 0) return null; // free-format or invalid

  const rates = version1 ? MPEG1_RATES : versionBits === 2 ? MPEG2_RATES : MPEG25_RATES;
  const sampleRate = plausibleRate(rates[rateIndex]);
  if (sampleRate === null) return null;

  return {
    bitrate: kbps * 1000,
    sampleRate,
    samplesPerFrame: version1 ? 1152 : 576,
    version1,
    mono: ((b3 >> 6) & 0x03) === 3,
  };
}

/** First frame sync within the search window, or null. */
function findMpegFrame(bytes: Uint8Array, from: number): { at: number; frame: MpegFrame } | null {
  const limit = Math.min(bytes.length - 4, from + 64 * 1024);
  for (let at = Math.max(0, from); at <= limit; at += 1) {
    if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) continue;
    const frame = parseMpegFrame(bytes, at);
    if (frame !== null) return { at, frame };
  }
  return null;
}

/**
 * A VBR file states its frame count in a Xing/Info header inside the first
 * frame; that count times the samples per frame is the exact duration. A CBR
 * file states nothing, so its length is the audio byte count over its bitrate —
 * which is why `totalBytes` matters here and nowhere else in this parser.
 */
function sniffMpeg(bytes: Uint8Array, totalBytes: number | null): SniffedDuration | null {
  const start = audioOffset(bytes);
  const found = findMpegFrame(bytes, start);
  if (found === null) return null;
  const { at, frame } = found;

  const sideInfo = frame.version1 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17;
  const xingAt = at + 4 + sideInfo;
  if (tagAt(bytes, xingAt, "Xing") || tagAt(bytes, xingAt, "Info")) {
    const flags = be32(bytes, xingAt + 4);
    if (flags !== null && (flags & 0x01) !== 0) {
      const frames = be32(bytes, xingAt + 8);
      if (frames !== null && frames > 0) {
        const seconds = plausible((frames * frame.samplesPerFrame) / frame.sampleRate);
        if (seconds !== null) return { seconds, source: "mp3_xing" };
      }
    }
  }

  if (totalBytes === null || totalBytes <= at) return null;
  const seconds = plausible(((totalBytes - at) * 8) / frame.bitrate);
  return seconds === null ? null : { seconds, source: "mp3_cbr" };
}

// ---------------------------------------------------------------------------
// MP4 / M4A
// ---------------------------------------------------------------------------

/**
 * Walk the top-level box list to `moov`, then its children to `mvhd`, which
 * carries a timescale and a duration in that timescale.
 *
 * A file whose `moov` sits at the end (not "faststart") tells us nothing from
 * its first bytes — that is a null, not a failure, and the byte bound takes over.
 */
function sniffMp4(bytes: Uint8Array): SniffedDuration | null {
  const moov = findBox(bytes, 0, bytes.length, "moov");
  if (moov === null) return null;
  const mvhd = findBox(bytes, moov.start, moov.end, "mvhd");
  if (mvhd === null) return null;

  const version = u8(bytes, mvhd.start);
  if (version === null) return null;
  const timescale = version === 1 ? be32(bytes, mvhd.start + 20) : be32(bytes, mvhd.start + 12);
  // A 64-bit duration is read as its low 32 bits plus a scaled high word; both
  // halves must be present or we know nothing.
  const duration =
    version === 1
      ? (() => {
          const high = be32(bytes, mvhd.start + 24);
          const low = be32(bytes, mvhd.start + 28);
          return high === null || low === null ? null : high * 0x100000000 + low;
        })()
      : be32(bytes, mvhd.start + 16);

  if (timescale === null || duration === null || timescale <= 0) return null;
  const seconds = plausible(duration / timescale);
  return seconds === null ? null : { seconds, source: "mp4_mvhd" };
}

/**
 * Payload bounds of the first `type` box found between `from` and `until`.
 * `start` is the first byte AFTER the box header, so a caller reads a box's
 * fields at their documented offsets and nothing here knows what they mean.
 */
function findBox(
  bytes: Uint8Array,
  from: number,
  until: number,
  type: string
): { start: number; end: number } | null {
  let at = from;
  while (at + 8 <= until) {
    const declared = be32(bytes, at);
    if (declared === null) return null;
    let header = 8;
    let size = declared;
    if (declared === 1) {
      const high = be32(bytes, at + 8);
      const low = be32(bytes, at + 12);
      if (high === null || low === null) return null;
      size = high * 0x100000000 + low;
      header = 16;
    } else if (declared === 0) {
      size = until - at;
    }
    if (size < header) return null;

    if (tagAt(bytes, at + 4, type)) {
      return { start: at + header, end: Math.min(until, at + size) };
    }
    at += size;
  }
  return null;
}

// ---------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------

/**
 * `fmt ` gives the byte rate, `data` gives the payload size, and the quotient is
 * the duration. A `data` size of 0 or 0xFFFFFFFF means "until end of file"
 * (a streamed WAV), so the file's own length stands in.
 */
function sniffWav(bytes: Uint8Array, totalBytes: number | null): SniffedDuration | null {
  if (!tagAt(bytes, 0, "RIFF") || !tagAt(bytes, 8, "WAVE")) return null;

  let byteRate: number | null = null;
  let dataSize: number | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const size = le32(bytes, at + 4);
    if (size === null) break;
    if (tagAt(bytes, at, "fmt ")) {
      // fmt payload: format(2) channels(2) sampleRate(4) byteRate(4) …
      if (plausibleRate(le32(bytes, at + 12)) === null) return null;
      byteRate = le32(bytes, at + 16);
    } else if (tagAt(bytes, at, "data")) {
      dataSize = size === 0xffffffff || size === 0 ? null : size;
      if (dataSize === null && totalBytes !== null) dataSize = Math.max(0, totalBytes - (at + 8));
      break;
    }
    // Chunks are word-aligned; an odd size carries a pad byte.
    at += 8 + size + (size % 2);
  }

  if (byteRate === null || byteRate <= 0 || dataSize === null || dataSize <= 0) return null;
  const seconds = plausible(dataSize / byteRate);
  return seconds === null ? null : { seconds, source: "wav_fmt" };
}

// ---------------------------------------------------------------------------
// FLAC
// ---------------------------------------------------------------------------

/**
 * STREAMINFO is always the first metadata block and carries a 20-bit sample
 * rate and a 36-bit total sample count. `totalSamples === 0` means the encoder
 * did not know (a piped stream), which is a null.
 */
function sniffFlac(bytes: Uint8Array): SniffedDuration | null {
  if (!tagAt(bytes, 0, "fLaC")) return null;
  const header = u8(bytes, 4);
  const length = be24(bytes, 5);
  if (header === null || length === null || (header & 0x7f) !== 0 || length < 34) return null;

  const at = 8;
  const b0 = u8(bytes, at + 10);
  const b1 = u8(bytes, at + 11);
  const b2 = u8(bytes, at + 12);
  const b3 = u8(bytes, at + 13);
  const tail = be32(bytes, at + 14);
  if (b0 === null || b1 === null || b2 === null || b3 === null || tail === null) return null;

  const sampleRate = plausibleRate((b0 << 12) | (b1 << 4) | (b2 >> 4));
  if (sampleRate === null) return null;
  const totalSamples = (b3 & 0x0f) * 0x100000000 + tail;
  if (totalSamples <= 0) return null;

  const seconds = plausible(totalSamples / sampleRate);
  return seconds === null ? null : { seconds, source: "flac_streaminfo" };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Read a duration out of the first bytes of a media file.
 *
 * `head` is a prefix (we range-GET ~256 kB), `totalBytes` the whole file's
 * length when the server declared it. Dispatch is on magic bytes, not on the
 * declared content type — a mislabelled `.mp3` that is really an MP4 is common
 * and the bytes are never wrong.
 *
 * Returns null for every container we cannot read from its head alone (Ogg and
 * Opus put the length in the LAST page; WebM/Matroska needs an EBML walk;
 * bare ADTS AAC states nothing at all). Null is not a failure — it means the
 * caller must fall back to `minimumDurationSeconds`.
 */
export function sniffContainerDuration(head: Uint8Array, totalBytes: number | null): SniffedDuration | null {
  if (head.length < 12) return null;
  if (tagAt(head, 0, "RIFF")) return sniffWav(head, totalBytes);
  if (tagAt(head, 0, "fLaC")) return sniffFlac(head);
  if (tagAt(head, 4, "ftyp")) return sniffMp4(head);
  if (tagAt(head, 0, "ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) {
    return sniffMpeg(head, totalBytes);
  }
  // Not a magic we know: an MP4 without `ftyp` first, or an MPEG stream with
  // junk in front of the first sync. One last look for a frame sync, then give up.
  return sniffMp4(head) ?? sniffMpeg(head, totalBytes);
}
