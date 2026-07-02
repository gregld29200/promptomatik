import type { AudioJob } from "@/lib/api";
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
  if (!label) return "la voix";
  return label.replace(/^Speaker\s+(\d+)$/i, "locuteur $1");
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
          <p className={s.kicker}>En régie...</p>
          <h2>{hasFailed ? "Prise interrompue" : isAssembling ? "Assemblage" : "Génération"}</h2>
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
          ? "Cette prise a échoué - réessayer ne vous coûte rien."
          : isAssembling
            ? "Assemblage de la prise finale..."
            : `Bloc ${activeIndex}/${total} - voix de ${speakerLabel(active?.text ?? "")}`}
      </div>

      <div className={s.progressGrid} role="list" aria-label="Progression des blocs">
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
              aria-label={`Bloc ${index + 1}: ${state}`}
            />
          );
        })}
      </div>

      <dl className={s.metrics}>
        <div>
          <dt>Temps écoulé</dt>
          <dd>{formatDuration(elapsedSeconds)}</dd>
        </div>
        <div>
          <dt>Estimation</dt>
          <dd>{formatDuration(job.estimatedSeconds)}</dd>
        </div>
        <div>
          <dt>Modèle</dt>
          <dd>{job.modelUsed ?? (job.quality === "final" ? "Final" : "Draft")}</dd>
        </div>
      </dl>

      {job.error && <p className={s.error}>{job.error}</p>}
    </section>
  );
}
