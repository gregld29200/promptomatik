// Transcription Studio — the workshop page.
//
// One prominent field that takes either a pasted link or a file, one honest
// choice about speakers, an optional language hint, and then an honest wait.
// The reading experience itself is `src/components/transcription` — this page
// owns the API calls, the polling and the strings, and hands the component a
// transcript and a `translate`.
//
// ---------------------------------------------------------------------------
// DEV FIXTURE — how `?demo=1` is kept out of production
// ---------------------------------------------------------------------------
// There is no Groq or Deepgram key in development, so `/transcribe?demo=1`
// renders the hand-written fixture from `src/components/transcription` through
// the real reading UI, with no API call and no job.
//
// The gate is `import.meta.env.DEV`, which Vite replaces with the literal
// `false` at build time — not a runtime flag that could be flipped, and not
// reachable on the deployed site by any URL.
//
// Two details make the stripping real rather than merely intended:
//   * the fixture arrives through a DYNAMIC import inside the folded branch, so
//     Rollup can drop the module and not just the expression;
//   * `TranscriptView` is imported from its own file, NOT from the
//     `@/components/transcription` barrel — that barrel re-exports the fixture,
//     whose top-level `buildTranscript()` call reads as a side effect and would
//     keep the module in the bundle however dead the branch was.
// Checked against `npm run build`: "Claire Fontaine" appears in no built asset.
//
// See also `npm run transcribe:seed` for exercising the library, the job view
// and the four download routes against local D1.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AudioLines, Clock, FileAudio, Library, Link2, Upload, X } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { UpgradeGate } from "@/components/upgrade-gate";
import { Allowance } from "@/components/ui/allowance";
import { HelpDot, HelpPanel } from "@/components/ui/help-disclosure";
import { PRODUCT_NAME } from "@/lib/config";
import { TranscriptView } from "@/components/transcription/transcript-view";
import type { TranscriptData } from "@/components/transcription/types";
import { useAuth } from "@/lib/auth/auth-context";
import { t, useLanguage } from "@/lib/i18n";
import * as api from "@/lib/api";
import type { PodcastFeed, TranscriptionJob } from "@/lib/api";
import {
  apiErrorMessage,
  downloadNudge,
  expiredBody,
  expiresLabel,
  expiryUrgency,
  failureMessage,
  fileDurationWarning,
  fileSizeWarning,
  formatBytes,
  formatDate,
  formatDuration,
  formatExactMoment,
  isTerminalStatus,
  isTranscriptExpired,
  MAX_SOURCE_SECONDS,
  readMediaDuration,
  retentionNotice,
  statusHint,
  statusLabel,
} from "@/lib/transcription-display";
import s from "./transcribe.module.css";

/** Poll cadence while a job runs. Fast enough to feel live, cheap enough to leave open. */
const POLL_INTERVAL_MS = 2_500;

const LANGUAGE_HINTS = ["fr", "en", "es", "de", "it", "pt"] as const;

export function TranscribePage() {
  const [language] = useLanguage();
  const { isParticipant } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [sourceText, setSourceText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [diarize, setDiarize] = useState(true);
  const [languageHint, setLanguageHint] = useState("");
  const [titleDraft, setTitleDraft] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [feed, setFeed] = useState<PodcastFeed | null>(null);
  const [loadingFeed, setLoadingFeed] = useState(false);

  const [job, setJob] = useState<TranscriptionJob | null>(null);
  const [quota, setQuota] = useState<api.TranscriptionQuota | null>(null);
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  /**
   * What `/inspect` makes of the link currently in the field. Classification is
   * pure and touches no provider, so it runs while the teacher is still looking
   * at the field — a YouTube link says so there and then, instead of after they
   * have chosen a diarization mode, a language and a title for a job that was
   * never going to run.
   */
  const [sourceCheck, setSourceCheck] = useState<api.ClassifiedTranscriptionSource | null>(null);
  /**
   * A file the teacher just picked that we already know we cannot take. Kept
   * separate from `message` (the API-error line at the top) because this one
   * belongs beside the field they were using, and it is not a failure — nothing
   * was attempted yet.
   */
  const [limitWarning, setLimitWarning] = useState<string | null>(null);
  /** Whether the size/length explainer beside the field is open. */
  const [limitsOpen, setLimitsOpen] = useState(false);
  const limitsHelpId = useId();
  const sourceHintId = useId();
  /**
   * What the source field is described BY.
   *
   * The hint carries both limits and was, until now, associated with nothing: a
   * screen reader announced "Lien ou fichier audio, edit text" and not one word
   * about 64 Mo or 90 minutes — the very information the disclosure exists to
   * surface. The explainer joins the list only while it is open, because a hidden
   * paragraph is not something the field is currently described by.
   */
  const sourceHelpIds = limitsOpen ? `${sourceHintId} ${limitsHelpId}` : sourceHintId;

  const fileInput = useRef<HTMLInputElement>(null);
  /** The file the teacher chose most recently — so a slow length check cannot
      refuse a file they have already replaced. */
  const latestPick = useRef<File | null>(null);
  const jobId = params.get("job");
  const demo = import.meta.env.DEV && params.get("demo") === "1";

  // The fixture is pulled in by a dynamic import inside a branch that constant-
  // folds to `false` in a production build, so Rollup drops both the branch and
  // the module. Verified: "Claire Fontaine" appears in no built bundle.
  const [demoTranscript, setDemoTranscript] = useState<TranscriptData | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (params.get("demo") !== "1") {
      setDemoTranscript(null);
      return;
    }
    let live = true;
    void import("@/components/transcription/transcript-fixture").then((module) => {
      if (live) setDemoTranscript(module.frenchInterviewFixture);
    });
    return () => {
      live = false;
    };
  }, [params]);

  /**
   * The page has two jobs behind one route: the intake form, and reading one
   * named transcript. `reading` is which one, and `readingTitle` is what that
   * transcript is called — it is the H1, the last breadcrumb and the browser
   * tab, so two transcripts are never indistinguishable in history.
   */
  const reading = Boolean(jobId) || demo;
  const readingTitle =
    job?.title?.trim() ||
    // Before the first poll answers we do not know the name yet: saying
    // "untitled" would be a claim, "loading" is the truth. The demo fixture has
    // no title and never will, so it is untitled straight away.
    (jobId && !job ? t("common.loading") : t("transcription.untitled_transcript"));

  useEffect(() => {
    document.title = reading ? `${readingTitle} · ${PRODUCT_NAME}` : PRODUCT_NAME;
    return () => {
      document.title = PRODUCT_NAME;
    };
  }, [reading, readingTitle]);

  // Debounced, not per-keystroke: a pasted link fires one request, and a link
  // typed by hand fires one when the typing stops. A failed check is silent —
  // it must never be the reason a teacher cannot submit.
  useEffect(() => {
    const url = sourceText.trim();
    if (file !== null || url.length < 8) {
      setSourceCheck(null);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      void api.inspectTranscriptionSource(url).then((res) => {
        if (!live) return;
        setSourceCheck(res.data ? res.data.source : null);
      });
    }, 450);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [sourceText, file]);

  const refreshQuota = useCallback(async () => {
    const res = await api.getTranscriptionQuota();
    if (res.data) setQuota(res.data);
  }, []);

  useEffect(() => {
    if (!isParticipant) return;
    void refreshQuota();
  }, [isParticipant, refreshQuota]);

  // Poll while the job is alive. The effect re-runs on every status change, so
  // reaching a terminal status stops the timer instead of leaving it spinning.
  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }

    // Capture the narrowed id: the guard above proves it is a string, but that
    // narrowing does not reach inside `tick`'s closure on its own.
    const activeJobId = jobId;
    let cancelled = false;
    let timer: number | undefined;

    async function tick() {
      const res = await api.getTranscriptionJob(activeJobId);
      if (cancelled) return;
      if (res.error) {
        setMessage(apiErrorMessage(res.error));
        return;
      }
      setJob(res.data.job);
      if (isTerminalStatus(res.data.job.status)) {
        void refreshQuota();
        return;
      }
      timer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [jobId, refreshQuota]);

  function resetToForm() {
    setParams({}, { replace: true });
    setJob(null);
    setFeed(null);
    setMessage(null);
    setSpeakerNames({});
    setSourceText("");
    setSourceCheck(null);
    setFile(null);
    setLimitWarning(null);
    setTitleDraft("");
  }

  function openJob(id: string) {
    setMessage(null);
    setFeed(null);
    setSpeakerNames({});
    setParams({ job: id }, { replace: false });
  }

  function clearFileInput() {
    if (fileInput.current) fileInput.current.value = "";
  }

  /**
   * The two limits, checked the moment a file is chosen — before a single byte
   * leaves the machine.
   *
   * SIZE is known immediately and is refused synchronously. LENGTH needs the
   * media's own header, which the browser can read without uploading anything, so
   * that check lands a beat later and clears the file if it fails. Both messages
   * say what to do instead; neither is a server round trip the teacher waits out.
   */
  function pickFile(next: File | null) {
    setMessage(null);
    setLimitWarning(null);

    latestPick.current = next;
    if (next === null) {
      setFile(null);
      return;
    }

    const tooLarge = fileSizeWarning(next);
    if (tooLarge) {
      setLimitWarning(tooLarge);
      setFile(null);
      clearFileInput();
      return;
    }

    setFile(next);
    setSourceText("");
    setSourceCheck(null);

    void readMediaDuration(next).then((seconds) => {
      // The teacher may have picked another file while we were reading this one.
      if (latestPick.current !== next || seconds === null) return;
      const tooLong = fileDurationWarning(seconds);
      if (!tooLong) return;
      setLimitWarning(tooLong);
      setFile(null);
      clearFileInput();
    });
  }

  const commonOptions = {
    diarize,
    languageHint: languageHint || null,
    title: titleDraft.trim() || null,
  };

  async function submitUrl(url: string) {
    const res = await api.createTranscriptionJob({ url, ...commonOptions });
    if (res.error) {
      // The media is on someone else's server: a refusal must not tell the
      // teacher to cut the file in two.
      setMessage(apiErrorMessage(res.error, { sourceKind: "direct_url" }));
      return;
    }
    openJob(res.data.jobId);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setMessage(null);
    setSubmitting(true);

    try {
      if (file) {
        const res = await api.uploadTranscriptionFile(file, commonOptions);
        if (res.error) {
          setMessage(apiErrorMessage(res.error, { sourceKind: "upload" }));
          return;
        }
        openJob(res.data.jobId);
        return;
      }

      const url = sourceText.trim();
      if (!url) return;

      // Classify first: a YouTube or Spotify link gets its own honest sentence
      // straight away, and a podcast feed opens the episode picker instead of
      // silently transcribing whichever episode happens to be newest.
      const inspected = await api.inspectTranscriptionSource(url);
      if (inspected.error) {
        setMessage(apiErrorMessage(inspected.error, { sourceKind: "direct_url" }));
        return;
      }
      const source = inspected.data.source;
      if (!source.supported) {
        setMessage(
          failureMessage(source.failure ?? { code: "unsupported_source" }, { sourceKind: source.kind })
        );
        return;
      }

      if (source.kind === "podcast") {
        setLoadingFeed(true);
        const episodes = await api.getPodcastEpisodes(source.url ?? url);
        setLoadingFeed(false);
        // A feed we cannot list is not a dead end: the resolver may still find
        // the enclosure on its own, so we fall through to a normal submission
        // rather than blocking the teacher on our own parsing.
        if (episodes.data && episodes.data.feed.episodes.length > 0) {
          setFeed(episodes.data.feed);
          return;
        }
      }

      await submitUrl(source.url ?? url);
    } finally {
      setSubmitting(false);
      setLoadingFeed(false);
    }
  }

  async function chooseEpisode(audioUrl: string, episodeTitle: string | null) {
    setSubmitting(true);
    setMessage(null);
    const res = await api.createTranscriptionJob({
      url: audioUrl,
      diarize,
      languageHint: languageHint || null,
      title: titleDraft.trim() || episodeTitle || null,
    });
    setSubmitting(false);
    if (res.error) {
      setMessage(apiErrorMessage(res.error, { sourceKind: "podcast" }));
      return;
    }
    openJob(res.data.jobId);
  }

  if (!isParticipant) {
    return (
      <Shell>
        <UpgradeGate variant="page" message={t("transcription.locked")} />
      </Shell>
    );
  }

  const transcript = demo ? demoTranscript : job?.transcript ?? null;
  const downloads = job ? api.transcriptionDownloads(job) : null;
  // A finished job whose seven days ran out. The Worker already withheld the
  // transcript and the download links, so there is nothing to render but the
  // explanation.
  const expiredJob = job !== null && isTranscriptExpired(job);
  /* An unsupported link is a dead end we already know about: no point letting
     the teacher fill in the rest of the form and press the button. */
  const canSubmit =
    !submitting &&
    (file !== null || (sourceText.trim().length > 0 && sourceCheck?.supported !== false));

  return (
    /* Reading a transcript, the breadcrumb says which one — the route only knows
       it is "the workspace". */
    <Shell pageLabel={reading ? readingTitle : null}>
      <div className={s.page}>
        {/* Two pages behind one route, and they need different headers. Reading a
            finished transcript, the intake pitch and the remaining-hours strip
            are noise around a document: the H1 becomes the transcript's own name
            so the page says what the teacher opened. */}
        <header className={s.header}>
          <div className={s.headerLede}>
            <p className={s.eyebrow}>{t("transcription.eyebrow")}</p>
            <h1>{reading ? readingTitle : t("transcription.title")}</h1>
            {!reading && <p className={s.subtitle}>{t("transcription.intro")}</p>}
          </div>
          <div className={s.headerAside}>
            {!reading && quota && (
              <Allowance
                align="end"
                label={t("transcription.quota_label")}
                value={
                  quota.includedRemaining <= 0
                    ? t("transcription.quota_empty")
                    : t("transcription.quota_remaining", {
                        remaining: formatDuration(quota.includedRemaining),
                        limit: formatDuration(quota.includedLimit),
                      })
                }
                reset={t("transcription.quota_reset", {
                  date: formatDate(quota.monthResetsOn, language),
                })}
                fraction={
                  quota.includedLimit > 0 ? quota.includedRemaining / quota.includedLimit : null
                }
                exhausted={quota.includedRemaining <= 0}
              />
            )}
            <button type="button" className={s.ghostAction} onClick={() => navigate("/transcribe/library")}>
              <Library size={15} aria-hidden />
              {t("transcription.view_library")}
            </button>
          </div>
        </header>

        {demo && <p className={s.demoNotice}>{t("transcription.demo_notice")}</p>}

        {message && (
          <p className={s.message} role="alert">
            {message}
          </p>
        )}

        {!jobId && !demo && !feed && (
          <form className={s.form} onSubmit={(event) => void handleSubmit(event)}>
            <div className={s.sourceBlock}>
              {/* The label carries the explainer, so the limits are one keystroke
                  from the control they constrain. The disclosure itself is the
                  shared `HelpDot` / `HelpPanel` the Audio Studio and Documents
                  now use too: one 44px target, one `aria-controls` relationship,
                  one always-rendered panel. */}
              <span className={s.labelRow}>
                <label className={s.label} htmlFor="transcription-source">
                  {t("transcription.source_label")}
                </label>
                <HelpDot
                  className={s.helpDot}
                  label={t("transcription.limits_help_label")}
                  expanded={limitsOpen}
                  controls={limitsHelpId}
                  onToggle={() => setLimitsOpen((open) => !open)}
                />
              </span>
              <HelpPanel id={limitsHelpId} open={limitsOpen} className={s.fieldHelp}>
                <strong>{t("transcription.limits_help_title")}</strong>{" "}
                {t("transcription.limits_help_body")}
              </HelpPanel>
              <div className={s.sourceRow}>
                <span className={s.sourceIcon} aria-hidden>
                  <Link2 size={18} />
                </span>
                <input
                  id="transcription-source"
                  // Deliberately `text`, not `url`: native constraint validation
                  // would block the submit for a pasted "example.com/feed.mp3"
                  // with a bubble in the BROWSER's language, and our own warm,
                  // translated `error_unsupported_source` would never run. The
                  // `/inspect` classifier is what judges the link.
                  type="text"
                  inputMode="url"
                  className={s.sourceInput}
                  value={sourceText}
                  disabled={file !== null}
                  placeholder={t("transcription.source_placeholder")}
                  aria-describedby={sourceHelpIds}
                  onChange={(event) => {
                    setSourceText(event.target.value);
                    setMessage(null);
                    // The file refusal is about a file that is no longer in play.
                    // Leaving it up puts "this file is too big" directly above
                    // "this link points at an audio file" — two verdicts on one
                    // field, one of them about something the teacher already did
                    // what we asked about.
                    setLimitWarning(null);
                  }}
                />
                <span className={s.separator} aria-hidden>
                  {t("transcription.or_separator")}
                </span>
                <button
                  type="button"
                  className={s.uploadButton}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={15} aria-hidden />
                  {t("transcription.upload_button")}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  className={s.fileInput}
                  accept="audio/*,video/*,.mp3,.m4a,.wav,.ogg,.flac,.aac,.opus"
                  aria-label={t("transcription.upload_label")}
                  onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
                />
              </div>
              <p id={sourceHintId} className={s.hint}>
                {t("transcription.source_hint")}
              </p>

              {/* An over-limit file, refused before anything is uploaded.
                  `role="alert"`, unlike the link verdict below: the teacher DID
                  act, and the file they chose is not the one that will be sent. */}
              {limitWarning && (
                <p className={s.sourceBlocked} role="alert">
                  {limitWarning}
                </p>
              )}

              {/* The verdict on the link, under the field, while the field still
                  has the teacher's attention. `role="status"` because it appears
                  without them asking; it is information, not an error they made
                  in a form they were submitting. */}
              {sourceCheck && (
                <p
                  className={sourceCheck.supported ? s.sourceOk : s.sourceBlocked}
                  role="status"
                >
                  {sourceCheck.supported
                    ? sourceCheck.kind === "podcast"
                      ? t("transcription.source_ok_podcast")
                      : // A YouTube link is NOT a media file, and saying it is
                        // was wrong from the moment YouTube became supported.
                        // It also sets the right expectation: the audio has to
                        // be fetched first, so this one starts slower.
                        sourceCheck.kind === "youtube"
                        ? t("transcription.source_ok_youtube")
                        : t("transcription.source_ok_direct_url")
                    : failureMessage(sourceCheck.failure ?? { code: "unsupported_source" }, {
                        sourceKind: sourceCheck.kind,
                      })}
                </p>
              )}

              {file && (
                <p className={s.filePill}>
                  <FileAudio size={15} aria-hidden />
                  {t("transcription.upload_selected", {
                    name: file.name,
                    size: formatBytes(file.size),
                  })}
                  <button
                    type="button"
                    className={s.filePillClear}
                    onClick={() => {
                      pickFile(null);
                      clearFileInput();
                    }}
                    title={t("transcription.upload_clear")}
                    aria-label={t("transcription.upload_clear")}
                  >
                    <X size={14} aria-hidden />
                  </button>
                </p>
              )}
            </div>

            {/* One exclusive choice, so real radios inside the fieldset — the
                same idiom as `SimpleTemplatePicker`. With `<button
                aria-pressed>` children the legend goes unannounced and the two
                cards read as independent toggles, which hides the single most
                consequential decision on this page from a screen reader. */}
            <fieldset className={s.choice}>
              <legend className={s.label}>{t("transcription.speakers_question")}</legend>
              <div className={s.choiceGrid}>
                <SpeakerChoice
                  selected={diarize}
                  onSelect={() => setDiarize(true)}
                  title={t("transcription.speakers_on")}
                  help={t("transcription.speakers_on_help")}
                />
                <SpeakerChoice
                  selected={!diarize}
                  onSelect={() => setDiarize(false)}
                  title={t("transcription.speakers_off")}
                  help={t("transcription.speakers_off_help")}
                />
              </div>
            </fieldset>

            <div className={s.detailRow}>
              <div className={s.detailField}>
                <label className={s.label} htmlFor="transcription-language">
                  {t("transcription.language_label")}
                </label>
                <select
                  id="transcription-language"
                  className={s.select}
                  value={languageHint}
                  onChange={(event) => setLanguageHint(event.target.value)}
                >
                  <option value="">{t("transcription.language_auto")}</option>
                  {LANGUAGE_HINTS.map((code) => (
                    <option key={code} value={code}>
                      {t(`transcription.language_${code}`)}
                    </option>
                  ))}
                </select>
                <p className={s.hint}>{t("transcription.language_hint")}</p>
              </div>

              <div className={s.detailField}>
                <label className={s.label} htmlFor="transcription-title">
                  {t("transcription.title_label")}
                </label>
                <input
                  id="transcription-title"
                  type="text"
                  className={s.textInput}
                  maxLength={120}
                  value={titleDraft}
                  placeholder={t("transcription.title_placeholder")}
                  onChange={(event) => setTitleDraft(event.target.value)}
                />
              </div>
            </div>

            <button type="submit" className={s.submit} disabled={!canSubmit}>
              <AudioLines size={17} aria-hidden />
              {submitting
                ? loadingFeed
                  ? t("transcription.episodes_loading")
                  : t("transcription.submitting")
                : t("transcription.submit")}
            </button>

            {/* Said once, calmly, before anything is transcribed — not sprung on
                a teacher a week later. It is a privacy position, not a
                limitation: we do not keep recordings of someone's learners
                indefinitely, and the text is theirs to download. */}
            <p className={s.retention}>{retentionNotice()}</p>
          </form>
        )}

        {feed && (
          <EpisodePicker
            feed={feed}
            busy={submitting}
            language={language}
            onChoose={(url, episodeTitle) => void chooseEpisode(url, episodeTitle)}
            onBack={() => setFeed(null)}
          />
        )}

        {job && !isTerminalStatus(job.status) && <RunningJob job={job} />}

        {job?.status === "failed" && (
          <section className={s.failure}>
            <h2 className={s.failureTitle}>{t("transcription.error_title")}</h2>
            <p className={s.failureBody}>
              {job.error
                ? failureMessage(job.error, { sourceKind: job.sourceKind })
                : t("transcription.error_internal")}
            </p>
            <button type="button" className={s.ghostAction} onClick={resetToForm}>
              {t("transcription.retry")}
            </button>
          </section>
        )}

        {/* The transcript is gone, but the job is not: say so plainly and offer
            the only thing that still works, rather than an empty reader. */}
        {expiredJob && (
          <section className={s.expiredCard}>
            <h2 className={s.failureTitle}>{t("transcription.expired_title")}</h2>
            <p className={s.failureBody}>{expiredBody()}</p>
            <button type="button" className={s.ghostAction} onClick={resetToForm}>
              {t("transcription.new_transcript")}
            </button>
          </section>
        )}

        {transcript && (
          <>
            {job?.expiresAt && !demo && (
              <ExpiryStrip expiresAt={job.expiresAt} language={language} />
            )}
            <TranscriptView
              transcript={transcript}
              translate={t}
              title={demo ? null : job?.title}
              // The page's own h1 is this transcript's name, so the view drops
              // its title and keeps the metadata line.
              showTitle={false}
              // The audio itself, so a word flagged as uncertain can be listened
              // to rather than merely doubted. Null in demo mode, where there is
              // no media behind the fixture.
              audioSrc={demo || !job ? null : api.transcriptionMediaUrl(job)}
              diarizeRequested={demo ? true : job?.diarizeRequested ?? false}
              downloads={downloads}
              speakerNames={speakerNames}
              onRenameSpeaker={(id, name) =>
                setSpeakerNames((previous) => ({ ...previous, [id]: name }))
              }
            />
            <button type="button" className={s.ghostAction} onClick={resetToForm}>
              {t("transcription.new_transcript")}
            </button>
          </>
        )}
      </div>
    </Shell>
  );
}

function SpeakerChoice({
  selected,
  onSelect,
  title,
  help,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  help: string;
}) {
  return (
    <label className={`${s.choiceCard} ${selected ? s.choiceCardActive : ""}`}>
      <input
        type="radio"
        name="transcription-diarize"
        className={s.choiceRadio}
        checked={selected}
        onChange={onSelect}
      />
      <strong>{title}</strong>
      <span>{help}</span>
    </label>
  );
}

/**
 * The countdown above the transcript, and the nudge to download it.
 *
 * This is more prominent than the Audio Studio's equivalent on purpose. An audio
 * take expires but its SCRIPT is kept forever, so an expired take can be
 * regenerated for nothing. A transcript IS the deliverable: a teacher who does
 * not download it loses the thing they came for, and re-running it spends their
 * monthly hours a second time. So it sits above the text rather than in a corner,
 * and `data-urgency` makes the last two days read louder than the first five.
 */
function ExpiryStrip({ expiresAt, language }: { expiresAt: string; language: string }) {
  const exact = t("transcription.expires_on", { date: formatExactMoment(expiresAt, language) });
  return (
    <aside className={s.expiry} data-urgency={expiryUrgency(expiresAt)}>
      <Clock size={16} aria-hidden />
      <div>
        {/* The exact moment is BOTH the title (the audio idiom) and visible text,
            because a title attribute alone reaches neither a keyboard nor a
            screen reader — and "expires in 1 day" is not a date you can plan
            around. */}
        <strong title={exact}>{expiresLabel(expiresAt)}</strong>{" "}
        <span className={s.expiryDate}>{exact}</span>
        <p>{downloadNudge(expiresAt)}</p>
      </div>
    </aside>
  );
}

/** The honest wait: which of the five states we are in, and what it means. */
function RunningJob({ job }: { job: TranscriptionJob }) {
  return (
    <section className={s.running} aria-live="polite">
      <span className={s.spinner} aria-hidden />
      <div>
        <strong>{statusLabel(job.status)}</strong>
        <p>{statusHint(job.status)}</p>
      </div>
    </section>
  );
}

function EpisodePicker({
  feed,
  busy,
  language,
  onChoose,
  onBack,
}: {
  feed: PodcastFeed;
  busy: boolean;
  language: string;
  onChoose: (audioUrl: string, title: string | null) => void;
  onBack: () => void;
}) {
  return (
    <section className={s.episodes}>
      <header className={s.episodesHead}>
        <div>
          <h2>{t("transcription.episodes_title")}</h2>
          <p>{feed.title ?? t("transcription.episodes_intro")}</p>
        </div>
        <button type="button" className={s.ghostAction} onClick={onBack}>
          {t("transcription.episodes_back")}
        </button>
      </header>

      {feed.episodes.length === 0 ? (
        <p className={s.empty}>{t("transcription.episodes_none")}</p>
      ) : (
        <ul className={s.episodeList}>
          {feed.episodes.map((episode) => {
            // The visible button says only "Transcrire", which would give every
            // row in a 50-episode feed the same accessible name. The label
            // carries the title so a screen reader can tell the rows apart —
            // and it still starts with the visible word (WCAG 2.5.3).
            const episodeLabel = episode.title?.trim() || t("transcription.episodes_untitled");
            // The 90-minute cap applies to an episode exactly as it does to an
            // upload, and the feed already told us this one's length — which the
            // row is already printing. Offering a live button on a row that reads
            // "1 h 52" means the teacher creates a job, waits, and is refused for
            // a reason the page could have stated before the click.
            const tooLong =
              episode.durationSeconds !== null && episode.durationSeconds > MAX_SOURCE_SECONDS;
            return (
            <li key={episode.guid ?? episode.audioUrl} className={s.episode}>
              <div className={s.episodeMain}>
                <strong>{episodeLabel}</strong>
                <span>
                  {episode.publishedAt
                    ? formatDate(episode.publishedAt, language)
                    : t("transcription.episodes_undated")}
                  {" · "}
                  {episode.durationSeconds === null
                    ? t("transcription.episodes_unknown_length")
                    : formatDuration(episode.durationSeconds)}
                </span>
              </div>
              {tooLong ? (
                // A plain statement, not a disabled button: a control that can
                // never do anything is worse than no control, and this way the
                // reason is the thing in the row rather than a tooltip.
                <span className={s.episodeTooLong}>
                  {t("transcription.episodes_too_long", {
                    max: formatDuration(MAX_SOURCE_SECONDS),
                  })}
                </span>
              ) : (
                <button
                  type="button"
                  className={s.episodeChoose}
                  disabled={busy}
                  aria-label={t("transcription.episodes_choose_named", { title: episodeLabel })}
                  onClick={() => onChoose(episode.audioUrl, episode.title)}
                >
                  {t("transcription.episodes_choose")}
                </button>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
