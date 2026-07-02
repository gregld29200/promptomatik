import { describe, expect, it } from "vitest";
import { PCM_BYTES_PER_SECOND, PCM_SAMPLE_RATE } from "./audio-config";
import {
  concatPcmWithSilence,
  durationFromPcmBytes,
  mp3FromPcm,
  peaksFromPcm,
  wavFromPcm,
} from "./audio-assembly";

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

describe("audio assembly", () => {
  it("concatenates PCM with 400ms silence gaps and reports duration", () => {
    const first = new Uint8Array(PCM_BYTES_PER_SECOND);
    const second = new Uint8Array(PCM_BYTES_PER_SECOND / 2);
    const pcm = concatPcmWithSilence([first, second]);

    expect(pcm.byteLength).toBe(PCM_BYTES_PER_SECOND * 1.9);
    expect(durationFromPcmBytes(pcm.byteLength)).toBeCloseTo(1.9, 5);
  });

  it("writes a valid 24kHz 16-bit mono WAV header", () => {
    const pcm = new Uint8Array(PCM_BYTES_PER_SECOND);
    const wav = wavFromPcm(pcm);
    const view = new DataView(wav.buffer);

    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(PCM_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(PCM_BYTES_PER_SECOND);
    expect(wav.byteLength).toBe(44 + PCM_BYTES_PER_SECOND);
  });

  it("encodes MP3 bytes from PCM", () => {
    const pcm = new Uint8Array(PCM_BYTES_PER_SECOND / 2);
    const mp3 = mp3FromPcm(pcm);

    expect(mp3.byteLength).toBeGreaterThan(0);
  });

  it("computes normalized PCM peaks", () => {
    const pcm = new Uint8Array(8);
    const view = new DataView(pcm.buffer);
    view.setInt16(0, 0, true);
    view.setInt16(2, 16_384, true);
    view.setInt16(4, -32_768, true);
    view.setInt16(6, 8_192, true);

    expect(peaksFromPcm(pcm, 2)).toEqual([0.5, 1]);
  });
});
