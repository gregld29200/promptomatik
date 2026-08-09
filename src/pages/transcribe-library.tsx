// Transcription Studio — the library.
//
// Deliberately the same page as `audio-library.tsx`: same row grid, same inline
// rename, same two-step delete confirmation, same "show more". A teacher who
// has used the Audio Studio already knows how this works, and a second visual
// language for the same job would be a cost with no benefit.

import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router";
import { Check, FileText, Pencil, Trash2, X } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { UpgradeGate } from "@/components/upgrade-gate";
import { useAuth } from "@/lib/auth/auth-context";
import { t, useLanguage } from "@/lib/i18n";
import * as api from "@/lib/api";
import type { TranscriptionJobSummary } from "@/lib/api";
import {
  apiErrorMessage,
  expiresLabel,
  expiryUrgency,
  formatDuration,
  formatExactMoment,
  isTranscriptExpired,
  sourceKindLabel,
  statusLabel,
} from "@/lib/transcription-display";
import s from "./transcribe-library.module.css";

const PAGE_SIZE = 20;

export function TranscribeLibraryPage() {
  const [language] = useLanguage();
  const { isParticipant } = useAuth();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<TranscriptionJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether the message belongs to the rename field. A failed rename leaves
   * focus in the input while the message renders at the top of the page, so
   * without this the field itself never says anything went wrong.
   */
  const [renameFailed, setRenameFailed] = useState(false);
  const errorId = useId();

  useEffect(() => {
    if (!isParticipant) return;
    void loadPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParticipant]);

  async function loadPage(offset: number) {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    const res = await api.getTranscriptionJobs(PAGE_SIZE, offset);
    if (res.data) {
      setJobs((previous) => (offset === 0 ? res.data.jobs : [...previous, ...res.data.jobs]));
      setHasMore(res.data.jobs.length === PAGE_SIZE);
    } else {
      setError(apiErrorMessage(res.error));
    }
    setLoading(false);
    setLoadingMore(false);
  }

  function startRename(job: TranscriptionJobSummary) {
    setRenamingId(job.id);
    setRenameValue(job.title);
    setConfirmDelete(null);
    setRenameFailed(false);
  }

  async function saveRename(job: TranscriptionJobSummary) {
    setSavingRename(true);
    setError(null);
    setRenameFailed(false);
    const res = await api.renameTranscriptionJob(job.id, renameValue);
    if (res.data) {
      // An emptied field clears the stored title; the list then shows the
      // derived label the server sends back on the next load.
      const title = res.data.title ?? job.title;
      setJobs((previous) => previous.map((item) => (item.id === job.id ? { ...item, title } : item)));
      setRenamingId(null);
    } else {
      setError(apiErrorMessage(res.error));
      setRenameFailed(true);
    }
    setSavingRename(false);
  }

  // Permanent: the transcript row and any media we stored for it. Hours already
  // spent stay spent — the ledger is accounting history, not storage.
  async function removeJob(job: TranscriptionJobSummary) {
    setDeleting(job.id);
    setError(null);
    setRenameFailed(false);
    const res = await api.deleteTranscriptionJob(job.id);
    if (res.data) {
      setJobs((previous) => previous.filter((item) => item.id !== job.id));
    } else {
      setError(apiErrorMessage(res.error));
    }
    setDeleting(null);
    setConfirmDelete(null);
  }

  if (!isParticipant) {
    return (
      <Shell>
        <UpgradeGate variant="page" message={t("transcription.locked")} />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className={s.page}>
        <header className={s.header}>
          <div>
            <p className={s.eyebrow}>{t("transcription.eyebrow")}</p>
            <h1>{t("transcription.library_title")}</h1>
            <p className={s.subtitle}>{t("transcription.library_intro")}</p>
          </div>
          {/* No "new transcription" button here: the shell topbar already carries
              that action on this route (see getPageContext in shell.tsx), and the
              Audio Studio library shows it once too. */}
        </header>

        {/* role="alert" so a load, rename or delete failure is announced — the
            rename case is the sharp one: focus stays in the field while the
            message renders up here. */}
        {error && (
          <p id={errorId} className={s.error} role="alert">
            {error}
          </p>
        )}

        {/* role="status" makes the aria-label valid (it is ignored on a bare
            generic element) and turns the skeleton into a polite live region. */}
        {loading ? (
          <div className={s.skeletons} role="status" aria-label={t("transcription.library_loading")}>
            <span />
            <span />
            <span />
          </div>
        ) : jobs.length === 0 ? (
          <p className={s.empty}>{t("transcription.library_empty")}</p>
        ) : (
          <div className={s.rows}>
            {jobs.map((job) => {
              // Seven days, then the transcript is deleted. An expired row keeps
              // its place in the list — the teacher remembers making it — but it
              // must read as expired and must not offer a button that would 410.
              const expired = isTranscriptExpired(job);
              // Before the deadline: the countdown ("Expire dans 6 jours"), with
              // the exact moment on the title. After it: the exact moment as
              // VISIBLE TEXT. The old code blanked this cell on an expired row
              // while still hanging the date on its `title`, so the one statement
              // of when the transcript actually went could be neither hovered nor
              // read aloud — and "Expirée" alone does not tell a teacher whether
              // it went yesterday or a month ago.
              const exactMoment = job.expiresAt
                ? t("transcription.expires_on", {
                    date: formatExactMoment(job.expiresAt, language),
                  })
                : "";
              const countdown = job.expiresAt
                ? expired
                  ? exactMoment
                  : expiresLabel(job.expiresAt)
                : "";
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
                        aria-label={t("transcription.library_rename_label")}
                        aria-invalid={renameFailed || undefined}
                        aria-describedby={renameFailed && error ? errorId : undefined}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveRename(job);
                          if (event.key === "Escape") setRenamingId(null);
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
                    // The pencil is a SIBLING of the truncating title, never a
                    // child of it: `.rowTitle` clips its overflow, so a button
                    // inside it is pushed outside the clip box by a long title
                    // and becomes untappable — which is what happened on a
                    // 375px screen, where the title always fills the row.
                    <span className={s.titleLine}>
                      {/* The Worker sends "" when it could derive nothing from
                          the URL or the filename — the fallback sentence is
                          translated here, the same one the reader shows. */}
                      <strong className={s.rowTitle}>
                        {job.title || t("transcription.untitled_transcript")}
                      </strong>
                      <button
                        type="button"
                        className={s.renameTrigger}
                        onClick={() => startRename(job)}
                        title={t("transcription.library_rename")}
                        aria-label={t("transcription.library_rename")}
                      >
                        <Pencil size={16} aria-hidden />
                      </button>
                    </span>
                  )}
                  <span className={s.rowMeta}>
                    {sourceKindLabel(job.sourceKind)} · {formatDuration(job.durationSeconds)}
                  </span>
                </div>

                <span
                  className={`${s.rowStatus} ${
                    job.status === "failed"
                      ? s.statusFailed
                      : expired
                        ? s.statusExpired
                        : job.status !== "completed"
                          ? s.statusActive
                          : ""
                  }`}
                >
                  {expired ? t("transcription.library_expired") : statusLabel(job.status)}
                </span>

                {/* The countdown, with the exact moment on the title — the same
                    pairing the Audio Studio library uses on a take. An expired
                    row already shows that moment, so it gets no title: a tooltip
                    repeating the text under the cursor is noise. */}
                <small
                  className={s.rowExpiry}
                  data-urgency={countdown ? expiryUrgency(job.expiresAt) : undefined}
                  title={!expired && exactMoment ? exactMoment : undefined}
                >
                  {countdown}
                </small>

                <div className={s.rowActions}>
                  {/* An expired transcript has no text to open and no file to
                      download: the row says so instead of offering a dead end. */}
                  {!expired && (
                    <button
                      type="button"
                      className={s.action}
                      onClick={() => navigate(`/transcribe?job=${job.id}`)}
                    >
                      <FileText size={15} aria-hidden />
                      {t("transcription.library_open")}
                    </button>
                  )}
                  {confirmDelete === job.id ? (
                    <span className={s.confirm}>
                      {t("transcription.library_delete_confirm_text")}
                      <button
                        type="button"
                        className={s.actionDanger}
                        disabled={deleting !== null}
                        onClick={() => void removeJob(job)}
                      >
                        {deleting === job.id
                          ? t("common.loading")
                          : t("transcription.library_delete_confirm")}
                      </button>
                      <button type="button" className={s.action} onClick={() => setConfirmDelete(null)}>
                        {t("common.cancel")}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={s.action}
                      onClick={() => setConfirmDelete(job.id)}
                      title={t("transcription.library_delete")}
                      aria-label={t("transcription.library_delete")}
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
            {loadingMore ? t("common.loading") : t("transcription.library_load_more")}
          </button>
        )}
      </div>
    </Shell>
  );
}
