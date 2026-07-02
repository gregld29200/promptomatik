import { PCM_BYTES_PER_SECOND, PCM_SAMPLE_RATE } from "./audio-config";
import BitStream from "lamejs/src/js/BitStream.js";
import Lame from "lamejs/src/js/Lame.js";
import MPEGMode from "lamejs/src/js/MPEGMode.js";
import lamejs from "lamejs";

const SILENCE_MS = 400;
const WAV_HEADER_BYTES = 44;

const lameGlobals = globalThis as typeof globalThis & {
  BitStream?: unknown;
  Lame?: unknown;
  MPEGMode?: unknown;
};
lameGlobals.BitStream ??= BitStream;
lameGlobals.Lame ??= Lame;
lameGlobals.MPEGMode ??= MPEGMode;

function silenceBytes(ms = SILENCE_MS): Uint8Array {
  return new Uint8Array(Math.round((PCM_BYTES_PER_SECOND * ms) / 1000));
}

export function durationFromPcmBytes(byteLength: number): number {
  return byteLength / PCM_BYTES_PER_SECOND;
}

export function peaksFromPcm(pcm: Uint8Array, count = 200): number[] {
  const samples = pcmToInt16(pcm);
  if (samples.length === 0 || count <= 0) return [];

  const bucketSize = Math.max(1, Math.ceil(samples.length / count));
  const peaks: number[] = [];

  for (let start = 0; start < samples.length && peaks.length < count; start += bucketSize) {
    let peak = 0;
    const end = Math.min(samples.length, start + bucketSize);

    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(samples[index] / 32768));
    }

    peaks.push(Number(Math.min(1, peak).toFixed(4)));
  }

  while (peaks.length < count) peaks.push(0);
  return peaks;
}

export function concatPcmWithSilence(blocks: Uint8Array[], silenceMs = SILENCE_MS): Uint8Array {
  const gap = silenceBytes(silenceMs);
  const totalBytes = blocks.reduce((sum, block) => sum + block.byteLength, 0)
    + Math.max(0, blocks.length - 1) * gap.byteLength;
  const output = new Uint8Array(totalBytes);
  let offset = 0;

  blocks.forEach((block, index) => {
    output.set(block, offset);
    offset += block.byteLength;
    if (index < blocks.length - 1) {
      output.set(gap, offset);
      offset += gap.byteLength;
    }
  });

  return output;
}

export function wavFromPcm(pcm: Uint8Array): Uint8Array {
  const wav = new Uint8Array(WAV_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(wav.buffer);
  const dataBytes = pcm.byteLength;
  const byteRate = PCM_BYTES_PER_SECOND;

  writeAscii(wav, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(wav, 8, "WAVE");
  writeAscii(wav, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, PCM_SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(wav, 36, "data");
  view.setUint32(40, dataBytes, true);
  wav.set(pcm, WAV_HEADER_BYTES);

  return wav;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    bytes[offset + i] = value.charCodeAt(i);
  }
}

function pcmToInt16(pcm: Uint8Array): Int16Array {
  return new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
}

export function mp3FromPcm(pcm: Uint8Array): Uint8Array {
  const encoder = new lamejs.Mp3Encoder(1, PCM_SAMPLE_RATE, 128);
  const samples = pcmToInt16(pcm);
  const chunks: Uint8Array[] = [];
  const sampleBlockSize = 1152;

  for (let i = 0; i < samples.length; i += sampleBlockSize) {
    const encoded = encoder.encodeBuffer(samples.subarray(i, i + sampleBlockSize));
    if (encoded.length > 0) chunks.push(encoded);
  }

  const final = encoder.flush();
  if (final.length > 0) chunks.push(final);

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
