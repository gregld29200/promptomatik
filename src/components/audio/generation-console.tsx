import type { AudioJob } from "@/lib/api";
import { t } from "@/lib/i18n";
import s from "./generation-console.module.css";

interface GenerationConsoleProps {
  job: AudioJob | null;
  elapsedSeconds: number;
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function currentBlock(job: AudioJob) {
  const segments = job.segments ?? [];
  const active = segments.find((segment) => segment.status === "pending" || segment.status === "failed")
    ?? segments[segments.length - 1];
  return active ?? null;
}

function speakerLabel(text: string) {
  const match = text.match(/^([^:\n]{1,40}):/);
  const label = match?.[1]?.trim();
  if (!label) return t("audio.console_generic_voice");
  const n = label.match(/^Speaker\s+(\d+)$/i)?.[1];
  return n ? t("audio.console_speaker_n", { n }) : label;
}

export function GenerationConsole({ job, elapsedSeconds }: GenerationConsoleProps) {
  if (!job || job.status === "ready") return null;

  const segments = job.segments ?? [];
  const done = segments.filter((segment) => segment.status === "ok").length;
  const active = currentBlock(job);
  const activeIndex = active ? active.idx + 1 : Math.max(1, done + 1);
  const total = Math.max(segments.length, 1);
  const isAssembling = job.status === "assembling";
  const hasFailed = job.status === "failed";

  return (
    <section className={s.console} aria-live="polite">
      <div className={s.header}>
        <div>
          <p className={s.kicker}>{t("audio.console_kicker")}</p>
          <h2>{hasFailed ? t("audio.console_failed_title") : isAssembling ? t("audio.console_assembling_title") : t("audio.console_generating_title")}</h2>
        </div>
        <div className={s.meter} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className={s.statusLine}>
        {hasFailed
          ? t("audio.console_failed_hint")
          : isAssembling
            ? t("audio.console_assembling_hint")
            : t("audio.console_block_line", {
                current: String(activeIndex),
                total: String(total),
                speaker: speakerLabel(active?.text ?? ""),
              })}
      </div>

      <div className={s.progressGrid} role="list" aria-label={t("audio.console_blocks_aria")}>
        {Array.from({ length: total }, (_, index) => {
          const segment = segments[index];
          const state = segment?.status ?? (index < done ? "ok" : "pending");
          return (
            <div
              key={index}
              role="listitem"
              className={`${s.block} ${state === "ok" ? s.done : ""} ${
                index + 1 === activeIndex && !isAssembling ? s.active : ""
              }`}
              aria-label={`${t("audio.block_label", { index: String(index + 1) })}: ${state}`}
            />
          );
        })}
      </div>

      <dl className={s.metrics}>
        <div>
          <dt>{t("audio.console_elapsed")}</dt>
          <dd>{formatDuration(elapsedSeconds)}</dd>
        </div>
        <div>
          <dt>{t("audio.console_estimate")}</dt>
          <dd>{formatDuration(job.estimatedSeconds)}</dd>
        </div>
        <div>
          <dt>{t("audio.console_model")}</dt>
          <dd>{job.quality === "final" ? t("audio.final") : t("audio.draft")}</dd>
        </div>
      </dl>

      {job.error && <p className={s.error}>{job.error}</p>}
    </section>
  );
}
