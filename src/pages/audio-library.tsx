import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Check, Download, Pencil, PlayCircle, RefreshCw, Trash2, X } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { UpgradeGate } from "@/components/upgrade-gate";
import { useAuth } from "@/lib/auth/auth-context";
import { t, useLanguage } from "@/lib/i18n";
import * as api from "@/lib/api";
import type { AudioJob } from "@/lib/api";
import { expiresLabel, formatShort, isExpired, modeLabel, qualityLabel, scriptTitle, takeTitle } from "@/lib/audio-display";
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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
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
      quality: "final",
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

  function startRename(job: AudioJob) {
    setRenamingId(job.id);
    setRenameValue(job.title ?? "");
    setConfirmDelete(null);
  }

  async function saveRename(job: AudioJob) {
    setSavingRename(true);
    setError(null);
    const res = await api.renameAudioJob(job.id, renameValue);
    if (res.data) {
      const title = res.data.title;
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, title } : j)));
      setRenamingId(null);
    } else {
      setError(res.error?.error ?? t("common.error"));
    }
    setSavingRename(false);
  }

  // Permanent removal: files in R2 and the take itself. Quota already spent
  // stays spent (the ledger is the accounting history, not the storage).
  async function removeJob(job: AudioJob) {
    setDeleting(job.id);
    setError(null);
    const res = await api.deleteAudioJob(job.id);
    if (res.data) {
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
    } else {
      setError(res.error?.error ?? t("common.error"));
    }
    setDeleting(null);
    setConfirmDelete(null);
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
                    {renamingId === job.id ? (
                      <span className={s.renameForm}>
                        <input
                          className={s.renameInput}
                          value={renameValue}
                          maxLength={120}
                          autoFocus
                          placeholder={scriptTitle(job.script)}
                          aria-label={t("audio.library_rename_label")}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveRename(job);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                        />
                        <button
                          type="button"
                          className={s.action}
                          disabled={savingRename}
                          onClick={() => void saveRename(job)}
                          title={t("common.save")}
                          aria-label={t("common.save")}
                        >
                          <Check size={15} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={s.action}
                          onClick={() => setRenamingId(null)}
                          title={t("common.cancel")}
                          aria-label={t("common.cancel")}
                        >
                          <X size={15} aria-hidden />
                        </button>
                      </span>
                    ) : (
                      <strong className={s.rowTitle}>
                        {takeTitle(job)}
                        <button
                          type="button"
                          className={s.renameTrigger}
                          onClick={() => startRename(job)}
                          title={t("audio.library_rename")}
                          aria-label={t("audio.library_rename")}
                        >
                          <Pencil size={13} aria-hidden />
                        </button>
                      </strong>
                    )}
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
                    {confirmDelete === job.id ? (
                      <span className={s.confirm}>
                        {t("audio.library_delete_confirm_text")}
                        <button
                          type="button"
                          className={s.actionDanger}
                          disabled={deleting !== null}
                          onClick={() => void removeJob(job)}
                        >
                          {deleting === job.id ? t("common.loading") : t("audio.library_delete_confirm")}
                        </button>
                        <button type="button" className={s.action} onClick={() => setConfirmDelete(null)}>
                          {t("common.cancel")}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={s.action}
                        onClick={() => {
                          setConfirmDelete(job.id);
                          setConfirmRegen(null);
                        }}
                        title={t("audio.library_delete")}
                        aria-label={t("audio.library_delete")}
                      >
                        <Trash2 size={15} aria-hidden />
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
