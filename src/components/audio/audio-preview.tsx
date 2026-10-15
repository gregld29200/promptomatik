import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import * as api from "@/lib/api";
import type { AudioPreviewUsage } from "@/lib/api";
import { t } from "@/lib/i18n";
import s from "./audio-preview.module.css";

// The count of previews left stays out of sight until the teacher nears a cap.
export const PREVIEW_COUNTER_FROM_DAILY = 25;
const PREVIEW_COUNTER_WITHIN_MONTHLY = 10;

export type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; url: string; usage: AudioPreviewUsage }
  | { status: "error"; message: string };

export function previewCounter(usage: AudioPreviewUsage): string | null {
  if (usage.dailyLimit <= 0 || usage.monthlyLimit <= 0) return null;
  const dailyLeft = Math.max(0, usage.dailyLimit - usage.dailyUsed);
  const monthlyLeft = Math.max(0, usage.monthlyLimit - usage.monthlyUsed);
  if (monthlyLeft < dailyLeft && monthlyLeft <= PREVIEW_COUNTER_WITHIN_MONTHLY) {
    return t("audio.preview_remaining_month", { count: String(monthlyLeft) });
  }
  if (usage.dailyUsed >= PREVIEW_COUNTER_FROM_DAILY) {
    return t("audio.preview_remaining_day", { count: String(dailyLeft) });
  }
  return null;
}

export function previewErrorMessage(error: api.ApiError, inputMessage: (error: string) => string): string {
  if (error.code === "preview_daily_limit") return t("audio.preview_limit_day");
  if (error.code === "preview_monthly_limit") return t("audio.preview_limit_month");
  if (error.status === 400 && error.error !== "invalid_request") return inputMessage(error.error);
  return t("audio.preview_failed");
}

type PreviewPayload = Parameters<typeof api.previewAudio>[0];

// One preview at a time, tied to the settings it was made from: changing the
// script, a voice or the direction drops it, and a late answer for older
// settings is ignored.
export function useAudioPreview(settingsKey: string, inputMessage: (error: string) => string) {
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const urlRef = useRef<string | null>(null);
  const requestRef = useRef(0);

  function releaseUrl() {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }

  useEffect(() => {
    requestRef.current += 1;
    releaseUrl();
    setState({ status: "idle" });
  }, [settingsKey]);

  useEffect(() => releaseUrl, []);

  async function run(payload: PreviewPayload) {
    requestRef.current += 1;
    const id = requestRef.current;
    setState({ status: "loading" });
    const res = await api.previewAudio(payload);
    if (id !== requestRef.current) return;
    if (res.error) {
      setState({ status: "error", message: previewErrorMessage(res.error, inputMessage) });
      return;
    }
    releaseUrl();
    const { audio, dailyUsed, dailyLimit, monthlyUsed, monthlyLimit } = res.data;
    urlRef.current = URL.createObjectURL(audio);
    setState({ status: "ready", url: urlRef.current, usage: { dailyUsed, dailyLimit, monthlyUsed, monthlyLimit } });
  }

  return { state, run };
}

export function PreviewPanel({ state }: { state: PreviewState }) {
  if (state.status === "idle") return null;

  if (state.status === "loading") {
    return (
      <p className={s.loading} role="status">
        <Spinner size={16} />
        {t("audio.preview_loading")}
      </p>
    );
  }

  if (state.status === "error") {
    return <p className={s.message} role="alert">{state.message}</p>;
  }

  const counter = previewCounter(state.usage);
  return (
    <div className={s.panel}>
      {/* A preview is for listening, not keeping: no download button (Chrome)
          and no "Save audio as" menu (Firefox). Friction, not protection —
          the caps in worker/lib/audio-preview.ts are the real guard. */}
      <audio
        className={s.player}
        src={state.url}
        controls
        controlsList="nodownload"
        onContextMenu={(event) => event.preventDefault()}
        autoPlay
        aria-label={t("audio.preview_player_label")}
      />
      <p className={s.note}>{t("audio.preview_note")}</p>
      {counter && <p className={s.counter} role="status">{counter}</p>}
    </div>
  );
}
