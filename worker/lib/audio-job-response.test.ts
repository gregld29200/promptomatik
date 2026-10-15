import { describe, expect, it } from "vitest";
import type { AudioDirection } from "./audio-config";
import { rowToAudioJob, type AudioJobRow, type AudioSegmentRow } from "./audio-job-response";

const NEUTRAL: AudioDirection = {
  level: "B1",
  accent: "Neutral international",
  accentDetail: "",
  pace: "Natural classroom speed",
  style: "Informal conversation",
};
const SCOTTISH: AudioDirection = { ...NEUTRAL, accentDetail: "strong Scottish accent" };

function row(direction: AudioDirection, modelUsed: string | null, status: AudioJobRow["status"] = "ready"): AudioJobRow {
  return {
    id: "job-1",
    user_id: "user-1",
    mode: "monologue",
    quality: "final",
    title: null,
    script_raw: "Hello there.",
    direction_json: JSON.stringify(direction),
    voices_json: JSON.stringify({ solo: "Kore" }),
    status,
    estimated_seconds: 5,
    actual_seconds: 5,
    error: null,
    model_used: modelUsed,
    gen_ms: 1000,
    retry_count: 0,
    api_cost_usd: 0.001,
    r2_prefix: null,
    expires_at: null,
    created_at: "2026-10-15 10:29:08",
  };
}

function segment(idx: number, modelUsed: string | null): AudioSegmentRow {
  return {
    job_id: "job-1",
    idx,
    text: "Hello there.",
    status: "ok",
    duration_seconds: 2.5,
    retry_count: 0,
    last_error_status: modelUsed?.includes("/") ? 402 : null,
    model_used: modelUsed,
    r2_key: null,
  };
}

describe("rowToAudioJob accentDropped", () => {
  it("flags an accented take voiced by 3.8 after the accent models failed", () => {
    const job = rowToAudioJob(row(SCOTTISH, "google/gemini-3.8-flash-tts"), [
      segment(0, "google/gemini-3.8-flash-tts"),
    ]);
    expect(job.accentDropped).toBe(true);
  });

  it("flags a take where only one block fell back", () => {
    const job = rowToAudioJob(row(SCOTTISH, "gemini-3.1-flash-tts-preview"), [
      segment(0, "gemini-3.1-flash-tts-preview"),
      segment(1, "google/gemini-3.8-flash-tts"),
    ]);
    expect(job.accentDropped).toBe(true);
  });

  it("stays quiet when the accent model voiced the take", () => {
    const job = rowToAudioJob(row(SCOTTISH, "gemini-3.1-flash-tts-preview"), [
      segment(0, "gemini-3.1-flash-tts-preview"),
      segment(1, "gemini-2.5-pro-preview-tts"),
    ]);
    expect(job.accentDropped).toBe(false);
  });

  it("stays quiet for a take without a regional accent", () => {
    expect(rowToAudioJob(row(NEUTRAL, "google/gemini-3.8-flash-tts")).accentDropped).toBe(false);
  });

  it("reads the job's model when the segments are not loaded", () => {
    expect(rowToAudioJob(row(SCOTTISH, "google/gemini-3.8-flash-tts")).accentDropped).toBe(true);
  });

  it("waits for the take to be ready", () => {
    expect(rowToAudioJob(row(SCOTTISH, "google/gemini-3.8-flash-tts", "generating")).accentDropped).toBe(false);
  });
});
