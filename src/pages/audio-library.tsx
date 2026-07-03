import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Download, PlayCircle, RefreshCw } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { UpgradeGate } from "@/components/upgrade-gate";
import { useAuth } from "@/lib/auth/auth-context";
import { t, useLanguage } from "@/lib/i18n";
import * as api from "@/lib/api";
import type { AudioJob } from "@/lib/api";
import { expiresLabel, formatShort, isExpired, modeLabel, qualityLabel, scriptTitle } from "@/lib/audio-display";
import s from "./audio-library.module.css";

const PAGE_SIZE = 20;

export function AudioLibraryPage() {
  useLanguage();
  const { isParticipant } = useAuth();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<AudioJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isParticipant) return;
    void loadPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParticipant]);

  async function loadPage(offset: number) {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    const res = await api.getAudioJobs(PAGE_SIZE, offset);
    if (res.data) {
      setJobs((prev) => (offset === 0 ? res.data.jobs : [...prev, ...res.data.jobs]));
      setHasMore(res.data.jobs.length === PAGE_SIZE);
    }
    setLoading(false);
    setLoadingMore(false);
  }

  // Re-create an expired take with its exact settings. Charges the quota
  // like any generation - hence the inline confirmation with the cost.
  async function regenerate(job: AudioJob) {
    setRegenerating(job.id);
    setError(null);
    const res = await api.createAudioJob({
      mode: job.mode,
      quality: job.quality,
      script: job.script,
      direction: job.direction,
      voices: job.voices,
    });
    if (res.data) {
      navigate(`/audio?job=${res.data.jobId}`);
      return;
    }
    setRegenerating(null);
    setConfirmRegen(null);
    setError(res.error?.error ?? t("common.error"));
  }

  if (!isParticipant) {
    return (
      <Shell>
        <UpgradeGate variant="page" message={t("audio.locked")} />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className={s.page}>
        <header className={s.header}>
          <div>
            <p className={s.eyebrow}>{t("audio.eyebrow")}</p>
            <h1>{t("audio.library_title")}</h1>
            <p className={s.subtitle}>{t("audio.library_intro")}</p>
          </div>
        </header>

        {error && <p className={s.error}>{error}</p>}

        {loading ? (
          <div className={s.skeletons} aria-label={t("audio.history_loading")}>
            <span />
            <span />
            <span />
          </div>
        ) : jobs.length === 0 ? (
          <p className={s.empty}>{t("audio.history_empty")}</p>
        ) : (
          <div className={s.rows}>
            {jobs.map((job) => {
              const expired = isExpired(job);
              const alive = job.status === "ready" && !expired;
              return (
                <article key={job.id} className={s.row}>
                  <div className={s.rowMain}>
                    <strong className={s.rowTitle}>{scriptTitle(job.script)}</strong>
                    <span className={s.rowMeta}>
                      {modeLabel(job.mode)} · {qualityLabel(job.quality)} ·{" "}
                      {formatShort(job.actualSeconds ?? job.estimatedSeconds)}
                    </span>
                  </div>
                  <span
                    className={`${s.rowStatus} ${
                      job.status === "failed"
                        ? s.statusFailed
                        : expired
                          ? s.statusExpired
                          : job.status !== "ready"
                            ? s.statusActive
                            : ""
                    }`}
                  >
                    {expired ? t("audio.library_expired") : t(`audio.status_${job.status}`)}
                  </span>
                  <small className={s.rowExpiry}>{alive ? expiresLabel(job.expiresAt) : ""}</small>
                  <div className={s.rowActions}>
                    {alive && (
                      <>
                        <button type="button" className={s.action} onClick={() => navigate(`/audio?job=${job.id}`)}>
                          <PlayCircle size={15} aria-hidden />
                          {t("audio.library_open")}
                        </button>
                        <a className={s.action} href={`/api/audio/jobs/${job.id}/download/final.mp3`} download>
                          <Download size={15} aria-hidden />
                          MP3
                        </a>
                      </>
                    )}
                    {expired && (
                      confirmRegen === job.id ? (
                        <span className={s.confirm}>
                          {t("audio.library_regen_cost", {
                            time: formatShort(job.actualSeconds ?? job.estimatedSeconds),
                          })}
                          <button
                            type="button"
                            className={s.actionPrimary}
                            disabled={regenerating !== null}
                            onClick={() => void regenerate(job)}
                          >
                            {regenerating === job.id ? t("common.loading") : t("audio.library_regen_confirm")}
                          </button>
                          <button type="button" className={s.action} onClick={() => setConfirmRegen(null)}>
                            {t("common.cancel")}
                          </button>
                        </span>
                      ) : (
                        <button type="button" className={s.action} onClick={() => setConfirmRegen(job.id)}>
                          <RefreshCw size={15} aria-hidden />
                          {t("audio.library_regen")}
                        </button>
                      )
                    )}
                    {!alive && (
                      <button type="button" className={s.action} onClick={() => navigate(`/audio?job=${job.id}`)}>
                        {t("audio.library_duplicate")}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {hasMore && !loading && (
          <button
            type="button"
            className={s.loadMore}
            disabled={loadingMore}
            onClick={() => void loadPage(jobs.length)}
          >
            {loadingMore ? t("common.loading") : t("audio.library_load_more")}
          </button>
        )}
      </div>
    </Shell>
  );
}
