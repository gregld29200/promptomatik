// Inter and Playfair Display are only used by the Audio Studio, so they load
// with this page instead of on every first paint.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/playfair-display/latin-600.css";
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Copy, FileAudio, HelpCircle, RotateCcw, Wand2, X } from "lucide-react";
import { Link } from "react-router";
import { Shell } from "@/components/layout/shell";
import { UpgradeGate } from "@/components/upgrade-gate";
import { HelpDot, HelpPanel, helpPanelId } from "@/components/ui/help-disclosure";
import { GenerationConsole } from "@/components/audio/generation-console";
import { VoiceCasting } from "@/components/audio/voice-casting";
import { WaveformPlayer } from "@/components/audio/waveform-player";
import { ScriptReview } from "@/components/audio/script-review";
import { ScriptStatus } from "@/components/audio/script-status";
import { EmotionMenu } from "@/components/audio/emotion-menu";
import { applySuggestions, type SuggestionDecision } from "@/lib/audio-suggestions";
import { useAuth } from "@/lib/auth/auth-context";
import { SUPPORTED_LANGUAGES, getLanguage, t, type Language } from "@/lib/i18n";
import * as api from "@/lib/api";
import { DIALOGUE_SLOTS, SUPPORTED_AUDIO_TAGS, dialogueCast, lintAudioScript, type CastMember } from "@/lib/audio-script-rules";
import type { AudioDirection, AudioJob, AudioMode, AudioQuality, AudioSpeakerDirection, AudioVoice, CefrLevel } from "@/lib/api";
import { expiresLabel, formatShort, isExpired, modeLabel, qualityLabel, stripTags, takeTitle } from "@/lib/audio-display";
import s from "./audio.module.css";

// V1 credit purchase entry point (REQ-8.3): a mailto stub. Stripe is V1.5.
const CONTACT_EMAIL = "greg@teachinspire.com";

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1"];
const ACCENTS = ["Neutral international", "British", "North American", "Australian", "Irish", "Indian English", "French-accented English", "Neutral", "Parisian", "Canadian", "Slow classroom French"];
const PACES = ["Slow learner-friendly", "Natural classroom speed", "Business meeting speed", "Exam speed", "Fast authentic speech"];
// "Dictation (measured, deliberate pauses after each sentence)" was removed
// from V1 after the pilot: model-performed pauses made durations vary up to
// 6x on identical input. Dictation returns in V1.5 on programmatic PCM
// silence insertion (BUILD_LOG.md, Phase 7 closure).
const STYLES = ["Neutral classroom", "Warm and encouraging", "Professional corporate", "Business meeting", "Podcast host", "Examiner voice", "Customer service", "Informal conversation", "Storytelling"];

// Sample scripts, one per interface language, offered when the editor is empty.
const EXAMPLES: Record<Language, string> = {
  fr: `Sophie : Bonjour, je cherche une salle pour une réunion jeudi matin.\nKarim : Bien sûr. Vous attendez combien de personnes ?\nSophie : Huit personnes, avec un projecteur si possible.\nKarim : La salle Camélia est libre à 10 heures. Je vous la réserve ?`,
  en: `Emma: Good morning, I need to move my appointment to Friday.\nTom: No problem. Would 2:30 work for you?\nEmma: Yes, that is perfect. Could you send me a confirmation?\nTom: Of course. You will receive it in a few minutes.`,
  es: `Lucía: Buenos días, quisiera cambiar mi cita al viernes.\nPablo: Sin problema. ¿Le viene bien a las dos y media?\nLucía: Sí, perfecto. ¿Podría enviarme una confirmación?\nPablo: Por supuesto. La recibirá en unos minutos.`,
};

// Display-only transforms; the backend direction values are the EN labels.
const DIRECTION_LABELS: Record<Language, Record<string, string>> = {
  en: {},
  fr: {
    "Neutral international": "International neutre",
    British: "Britannique",
    "North American": "Nord-américain",
    Australian: "Australien",
    Irish: "Irlandais",
    "Indian English": "Anglais indien",
    "French-accented English": "Anglais avec accent français",
    Neutral: "Neutre",
    Parisian: "Parisien",
    Canadian: "Canadien",
    "Slow classroom French": "Français de classe lent",
    "Slow learner-friendly": "Lent et apprenant",
    "Natural classroom speed": "Rythme naturel de classe",
    "Business meeting speed": "Rythme réunion pro",
    "Exam speed": "Rythme examen",
    "Fast authentic speech": "Rapide authentique",
    "Neutral classroom": "Classe neutre",
    "Warm and encouraging": "Chaleureux et encourageant",
    "Professional corporate": "Professionnel",
    "Business meeting": "Réunion professionnelle",
    "Podcast host": "Animateur podcast",
    "Examiner voice": "Voix d'examinateur",
    "Customer service": "Service client",
    "Informal conversation": "Conversation informelle",
    Storytelling: "Narration",
  },
  es: {
    "Neutral international": "Internacional neutro",
    British: "Británico",
    "North American": "Norteamericano",
    Australian: "Australiano",
    Irish: "Irlandés",
    "Indian English": "Inglés de India",
    "French-accented English": "Inglés con acento francés",
    Neutral: "Neutro",
    Parisian: "Parisino",
    Canadian: "Canadiense",
    "Slow classroom French": "Francés de clase lento",
    "Slow learner-friendly": "Lento para aprendientes",
    "Natural classroom speed": "Ritmo natural de clase",
    "Business meeting speed": "Ritmo de reunión profesional",
    "Exam speed": "Ritmo de examen",
    "Fast authentic speech": "Rápido y auténtico",
    "Neutral classroom": "Clase neutra",
    "Warm and encouraging": "Cálido y alentador",
    "Professional corporate": "Profesional",
    "Business meeting": "Reunión profesional",
    "Podcast host": "Presentador de pódcast",
    "Examiner voice": "Voz de examinador",
    "Customer service": "Atención al cliente",
    "Informal conversation": "Conversación informal",
    Storytelling: "Narración",
  },
};

const DATE_LOCALES: Record<Language, string> = { fr: "fr-FR", en: "en-US", es: "es-ES" };

function estimateSeconds(script: string) {
  const words = stripTags(script).trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / 2.5);
}

// Voices go to the worker by slot ("Speaker 1"): it rewrites the names in
// the script to the same slots before speech.
function voicesForPayload(mode: AudioMode, cast: CastMember[], selected: Record<string, string>) {
  if (mode === "monologue") return { solo: selected.solo };
  const slots = cast.flatMap((member) => (member.slot ? [member.slot] : []));
  const used = slots.length > 0 ? slots : [...DIALOGUE_SLOTS];
  return Object.fromEntries(used.map((slot) => [slot, selected[slot]]));
}

// Names the teacher gave their characters, by slot, for the voice cards and
// the per-character settings. Numbered labels ("Locuteur 1") add nothing.
function castNames(cast: CastMember[]): Partial<Record<string, string>> {
  return Object.fromEntries(cast.flatMap((member) =>
    member.slot && !/\d$/.test(member.label) ? [[member.slot, member.label]] : []
  ));
}

function directionLabel(value: string) {
  return DIRECTION_LABELS[getLanguage()][value] ?? value;
}

function speakerDisplay(slot: string, names: Partial<Record<string, string>>) {
  if (names[slot]) return names[slot] as string;
  const n = slot.match(/^Speaker\s+(\d+)$/i)?.[1];
  return n ? t("audio.speaker_n", { n }) : slot;
}

// The worker re-runs the linter as a backstop and answers with `audio_lint_<code>`
// rather than prose, since only the client knows the teacher's language.
function jobErrorMessage(error: string) {
  return error.startsWith("audio_lint_") ? t(`audio.lint_${error.slice("audio_lint_".length)}`) : error;
}

function uiLocale() {
  return DATE_LOCALES[getLanguage()];
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(uiLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function AudioStudioPage() {
  const { isParticipant } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mode, setMode] = useState<AudioMode>("dialogue");
  // Single user-facing quality since 2026-07-03 (Greg): drafts on a cheaper
  // model sound different from the final model, so they validate nothing.
  const quality: AudioQuality = "final";
  const [script, setScript] = useState("");
  const [direction, setDirection] = useState<AudioDirection>({
    level: "B1",
    accent: "Neutral international",
    accentDetail: "",
    pace: "Natural classroom speed",
    style: "Business meeting",
    scene: "",
  });
  const [voices, setVoices] = useState<Record<string, string>>({
    solo: "Kore",
    "Speaker 1": "Kore",
    "Speaker 2": "Puck",
  });
  const [catalog, setCatalog] = useState<AudioVoice[]>([]);
  const [quota, setQuota] = useState<api.AudioQuota | null>(null);
  const [history, setHistory] = useState<AudioJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [activeJob, setActiveJob] = useState<AudioJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  // Inline review: the script is frozen while the teacher accepts or
  // rejects each suggestion in place; `undoScript` restores the text the
  // last applied review replaced.
  const [review, setReview] = useState<(api.AudioSuggestResult & { script: string }) | null>(null);
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, SuggestionDecision>>({});
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [suggestNotice, setSuggestNotice] = useState<string | null>(null);
  // Folded by default; opens by itself when a duplicated take carries per-character settings.
  const [speakerSettingsOpen, setSpeakerSettingsOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [undo, setUndo] = useState<{ script: string; scene: string | undefined } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [openHelp, setOpenHelp] = useState<string | null>(null);
  /** One base for every disclosure panel on this page — see `helpPanelId`. */
  const helpBaseId = useId();
  const [creditPacks, setCreditPacks] = useState<api.CreditPack[]>([]);
  const [buyOpen, setBuyOpen] = useState(false);
  const [buyingPack, setBuyingPack] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (activeJob?.status === "ready") setEditorCollapsed(true);
  }, [activeJob?.status]);

  // Arriving from the library with ?job=<id>: restore that take's settings
  // and, if its files are still alive, its player.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get("job");
    if (!jobId) return;
    window.history.replaceState(null, "", window.location.pathname);
    void api.getAudioJob(jobId).then((res) => {
      if (!res.data) return;
      const job = res.data.job;
      setMode(job.mode);
      updateScript(job.script);
      setDirection(job.direction);
      setSpeakerSettingsOpen(Boolean(job.direction.speakers));
      setVoices((prev) => ({ ...prev, ...job.voices }));
      if (job.status === "ready" && !isExpired(job)) setActiveJob(job);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stripe Checkout return: show the outcome, then refresh the quota twice -
  // the webhook that credits the minutes can land after the redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("checkout");
    if (!status) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (status === "success") {
      setNotice(t("audio.checkout_success"));
      const refresh = () => api.getAudioQuota().then((res) => { if (res.data) setQuota(res.data); });
      const timers = [setTimeout(refresh, 2000), setTimeout(refresh, 6000)];
      return () => timers.forEach(clearTimeout);
    }
    if (status === "cancelled") {
      setNotice(t("audio.checkout_cancelled"));
    }
  }, []);

  const estimate = useMemo(() => estimateSeconds(script), [script]);
  const lintFindings = useMemo(() => lintAudioScript(script, mode), [script, mode]);
  const blockingFindings = lintFindings.filter((finding) => finding.severity === "blocking");
  const cast = useMemo(() => (mode === "dialogue" ? dialogueCast(script) : []), [mode, script]);
  const names = useMemo(() => castNames(cast), [cast]);
  const selectedVoices = useMemo(() => voicesForPayload(mode, cast, voices), [mode, cast, voices]);
  const missingVoiceSlot = Object.entries(selectedVoices).find(([, voice]) => !voice)?.[0];
  const missingVoices = missingVoiceSlot !== undefined;
  const quotaPool = (quota?.includedRemaining ?? 0) + (quota?.credits ?? 0);
  const quotaBlocked = quota ? estimate > quotaPool * 1.2 : false;
  const canGenerate = script.trim().length > 0 && blockingFindings.length === 0 && !missingVoices && !quotaBlocked && review === null;
  // Says why the button is grey, in one sentence, next to the button.
  const generateHint = !script.trim()
    ? t("audio.why_empty")
    : review
      ? t("audio.why_review")
      : blockingFindings.length > 0
        ? t("audio.why_blocking")
        : missingVoiceSlot
          ? t("audio.why_voice", { name: missingVoiceSlot === "solo" ? t("audio.narrator") : speakerDisplay(missingVoiceSlot, names) })
          : null;

  useEffect(() => {
    if (!isParticipant) return;
    void refreshAudioData();
  }, [isParticipant]);

  useEffect(() => {
    if (!activeJob || activeJob.status === "ready" || activeJob.status === "failed") return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [activeJob?.id, activeJob?.status]);

  useEffect(() => {
    if (!activeJob || activeJob.status === "ready" || activeJob.status === "failed") return;

    const poll = window.setInterval(async () => {
      const res = await api.getAudioJob(activeJob.id);
      if (!res.data) return;
      setActiveJob(res.data.job);
      if (res.data.job.status === "ready" || res.data.job.status === "failed") {
        setRegenerating(false);
        setHistoryLoading(true);
        void refreshAudioData();
      }
    }, 3000);

    return () => window.clearInterval(poll);
  }, [activeJob]);

  async function refreshAudioData() {
    const [quotaRes, voicesRes, jobsRes, packsRes] = await Promise.all([
      api.getAudioQuota(),
      api.getAudioVoices(),
      api.getAudioJobs(8),
      api.getCreditPacks(),
    ]);
    if (quotaRes.data) setQuota(quotaRes.data);
    if (packsRes.data) setCreditPacks(packsRes.data.packs);
    if (voicesRes.data) setCatalog(voicesRes.data.voices);
    if (jobsRes.data) setHistory(jobsRes.data.jobs);
    setHistoryLoading(false);
  }

  function updateDirection<Key extends keyof AudioDirection>(key: Key, value: AudioDirection[Key]) {
    setDirection((prev) => ({ ...prev, [key]: value }));
  }

  // The shared disclosure (src/components/ui/help-disclosure.tsx): one 44px touch
  // target and one `aria-controls` relationship for all three studios. The panel
  // is always rendered and hidden when closed, because `aria-controls` has to
  // point at an element that exists.
  function helpDot(id: string) {
    return (
      <HelpDot
        className={s.helpDot}
        size={13}
        label={t("audio.param_help_aria")}
        expanded={openHelp === id}
        controls={helpPanelId(helpBaseId, id)}
        onToggle={() => setOpenHelp((prev) => (prev === id ? null : id))}
      />
    );
  }

  function helpText(id: string, key: string) {
    return (
      <HelpPanel id={helpPanelId(helpBaseId, id)} open={openHelp === id} className={s.fieldHelp}>
        {t(key)}
      </HelpPanel>
    );
  }

  function updateSpeakerField(slot: string, field: keyof AudioSpeakerDirection, value: string) {
    if (slot === "Speaker 1" && field !== "notes") {
      updateDirection(field as "accent" | "accentDetail" | "style", value);
    }
    updateSpeakerDirection(slot, field, value);
  }

  function updateSpeakerDirection(slot: string, field: keyof AudioSpeakerDirection, value: string) {
    setDirection((prev) => {
      const entry: AudioSpeakerDirection = { ...prev.speakers?.[slot] };
      if (value) {
        entry[field] = value;
      } else {
        delete entry[field];
      }
      const speakers = { ...prev.speakers };
      if (Object.keys(entry).length > 0) {
        speakers[slot] = entry;
      } else {
        delete speakers[slot];
      }
      return { ...prev, speakers: Object.keys(speakers).length > 0 ? speakers : undefined };
    });
  }

  function clearReview() {
    setReview(null);
    setReviewDecisions({});
    setReviewError(null);
  }

  function updateScript(next: string) {
    setScript(next);
    setUndo(null);
    setSuggestNotice(null);
    clearReview();
  }

  function insertTag(tag: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      updateScript(`${script}${tag}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${script.slice(0, start)}${tag}${script.slice(end)}`;
    updateScript(next);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  async function buyPack(packId: string) {
    setBuyingPack(packId);
    const res = await api.startCreditCheckout(packId);
    if (res.data?.url) {
      window.location.href = res.data.url;
      return;
    }
    setBuyingPack(null);
    setError(res.error?.error ?? t("common.error"));
  }

  async function generate() {
    if (!canGenerate) return;
    setError(null);
    const res = await api.createAudioJob({
      mode,
      quality,
      script,
      direction,
      voices: selectedVoices,
    });
    if (res.error) {
      setError(res.error.code === "audio_quota_exceeded" ? t("audio.quota_blocked") : jobErrorMessage(res.error.error));
      return;
    }
    const jobRes = await api.getAudioJob(res.data.jobId);
    if (jobRes.data) setActiveJob(jobRes.data.job);
  }

  async function suggestEdits() {
    if (!script.trim() || suggesting) return;
    setSuggesting(true);
    setReviewError(null);
    setSuggestNotice(null);
    const sent = script;
    const res = await api.suggestAudioEdits({ script: sent, mode, level: direction.level });
    setSuggesting(false);
    if (res.error) {
      setReview(null);
      // Never a technical message, and never half a review: the text is untouched.
      setReviewError(t("audio.suggest_failed"));
      return;
    }
    if (res.data.suggestions.length === 0) {
      setSuggestNotice(t("audio.suggest_none"));
      return;
    }
    setReview({ ...res.data, script: sent.replace(/\r\n?/g, "\n") });
    setReviewDecisions({});
  }

  function decideSuggestion(id: string, decision: SuggestionDecision | null) {
    setReviewDecisions((prev) => {
      const next = { ...prev };
      if (decision) next[id] = decision;
      else delete next[id];
      return next;
    });
  }

  function decideAllPending(decision: SuggestionDecision) {
    if (!review) return;
    setReviewDecisions((prev) => ({
      ...Object.fromEntries(review.suggestions.map((suggestion) => [suggestion.id, decision])),
      ...prev,
    }));
  }

  function applyReview() {
    if (!review) return;
    const next = applySuggestions(review.script, review.suggestions, reviewDecisions);
    setUndo({ script: review.script, scene: direction.scene });
    setScript(next.script);
    if (next.scenes.length > 0) {
      setDirection((prev) => ({
        ...prev,
        scene: [prev.scene?.trim(), ...next.scenes].filter(Boolean).join("\n"),
      }));
    }
    clearReview();
  }

  function undoReview() {
    if (!undo) return;
    setScript(undo.script);
    setDirection((prev) => ({ ...prev, scene: undo.scene }));
    setUndo(null);
  }

  async function regenerateBlock(idx: number) {
    if (!activeJob) return;
    setRegenerating(true);
    setSelectedBlock(idx);
    const res = await api.regenerateAudioSegment(activeJob.id, idx);
    if (res.error) {
      setError(res.error.error);
      setRegenerating(false);
      return;
    }
    const jobRes = await api.getAudioJob(activeJob.id);
    if (jobRes.data) setActiveJob(jobRes.data.job);
  }

  async function duplicateSettings(job: AudioJob) {
    setMode(job.mode);
    updateScript(job.script);
    setDirection(job.direction);
    setVoices((prev) => ({ ...prev, ...job.voices }));
    const detail = await api.getAudioJob(job.id);
    if (detail.data) setActiveJob(detail.data.job);
  }

  function handleModeChange(nextMode: AudioMode) {
    setMode(nextMode);
    clearReview();
    if (nextMode === "monologue") {
      setVoices((prev) => ({ ...prev, solo: prev.solo || "Kore" }));
    } else {
      setVoices((prev) => ({
        ...prev,
        "Speaker 1": prev["Speaker 1"] || prev.solo || "Kore",
        "Speaker 2": prev["Speaker 2"] || "Puck",
      }));
    }
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
      <div className={s.audioPage}>
        <header className={s.header}>
          <div>
            <p className={s.eyebrow}>{t("audio.eyebrow")}</p>
            <h1>{t("audio.title")}</h1>
          </div>
          <div className={s.quota} aria-live="polite" title={t("audio.quota_reset")}>
            <svg viewBox="0 0 36 36" className={s.quotaRing} aria-hidden>
              <circle cx="18" cy="18" r="15.5" className={s.quotaRingBg} />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                className={`${s.quotaRingFill} ${quota && quota.includedRemaining / 3600 < 0.25 ? s.quotaRingLow : ""}`}
                strokeDasharray={`${quota ? Math.max(0, Math.min(1, quota.includedRemaining / 3600)) * 97.4 : 0} 97.4`}
                transform="rotate(-90 18 18)"
              />
            </svg>
            <div className={s.quotaBody}>
              <strong className={s.quotaMinutes}>
                {quota ? `${Math.max(0, Math.floor(quota.includedRemaining / 60))} min` : "…"}
              </strong>
              <span>{t("audio.quota_remaining_caption")}</span>
              {quota && quota.credits > 0 && (
                <em className={s.quotaCreditsChip}>
                  {t("audio.quota_credits", { minutes: String(Math.max(1, Math.floor(quota.credits / 60))) })}
                </em>
              )}
              {creditPacks.length > 0 && (
                <button type="button" className={s.buyLink} onClick={() => setBuyOpen(true)}>
                  {t("audio.buy_credits")}
                </button>
              )}
            </div>
          </div>
        </header>

        <div className={s.zones}>
          <section className={s.zone}>
            <div className={s.zoneTitle}>
              <h2>{t("audio.script_zone")}</h2>
            </div>

            <div className={s.segmented} aria-label={t("audio.mode")}>
              {(["dialogue", "monologue"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={mode === option ? s.segmentedActive : ""}
                  onClick={() => handleModeChange(option)}
                >
                  {t(`audio.${option}`)}
                </button>
              ))}
            </div>

            {review ? (
              <ScriptReview
                script={review.script}
                suggestions={review.suggestions}
                decisions={reviewDecisions}
                onDecide={decideSuggestion}
                onAcceptAll={() => decideAllPending("accepted")}
                onRejectAll={() => decideAllPending("rejected")}
                onApply={applyReview}
                onCancel={clearReview}
              />
            ) : (
              <textarea
                ref={textareaRef}
                value={script}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateScript(event.target.value)}
                className={`${s.editor} ${editorCollapsed ? s.editorCollapsed : ""}`}
                onFocus={() => setEditorCollapsed(false)}
                placeholder={t("audio.script_placeholder")}
                aria-label={t("audio.script_zone")}
              />
            )}

            {!script.trim() && (
              <div className={s.emptyTools}>
                <span>{t("audio.empty_script")}</span>
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button key={lang} type="button" onClick={() => updateScript(EXAMPLES[lang])}>
                    {lang.toUpperCase()}
                  </button>
                ))}
              </div>
            )}

            {!review && (
              <ScriptStatus
                mode={mode}
                script={script}
                findings={lintFindings}
                cast={cast}
                estimate={t("audio.estimate", { time: formatShort(estimate) })}
                onSwitchToDialogue={() => handleModeChange("dialogue")}
              />
            )}

            {!review && (
              <div className={s.prepareBar}>
                <button
                  type="button"
                  className={s.suggestAction}
                  disabled={!script.trim() || suggesting}
                  onClick={() => void suggestEdits()}
                >
                  <Wand2 size={16} aria-hidden />
                  {suggesting ? t("audio.suggest_loading") : t("audio.suggest")}
                </button>
                <EmotionMenu onInsert={insertTag} />
                {undo && (
                  <button type="button" className={s.secondaryAction} onClick={undoReview}>
                    <RotateCcw size={16} aria-hidden />
                    {t("audio.review_undo_all")}
                  </button>
                )}
                <button type="button" className={s.linkAction} onClick={() => setHelpOpen(true)}>
                  <HelpCircle size={16} aria-hidden />
                  {t("audio.help_title")}
                </button>
              </div>
            )}

            {suggestNotice && <p className={s.notice} role="status">{suggestNotice}</p>}
            {reviewError && (
              <p className={s.error} role="alert">
                {reviewError}{" "}
                <button type="button" className={s.inlineRetry} onClick={() => void suggestEdits()}>
                  {t("common.retry")}
                </button>
              </p>
            )}
          </section>

          <section className={s.zone}>
            <div className={s.zoneTitle}>
              <h2>{t("audio.direction_zone")}</h2>
              <button type="button" className={s.zoneHelp} onClick={() => setHelpOpen(true)} aria-label={t("audio.help_title")}>
                <HelpCircle size={15} aria-hidden />
              </button>
            </div>

            <label className={s.field}>
              <span>{t("audio.level")} {helpDot("level")}</span>
              <select value={direction.level} onChange={(event) => updateDirection("level", event.target.value as CefrLevel)}>
                {LEVELS.map((level) => <option key={level}>{level}</option>)}
              </select>
              {helpText("level", "audio.param_help_level")}
            </label>
            <label className={s.field}>
              <span>{t("audio.pace")} {helpDot("pace")}</span>
              <select value={direction.pace} onChange={(event) => updateDirection("pace", event.target.value)}>
                {PACES.map((pace) => <option key={pace} value={pace}>{directionLabel(pace)}</option>)}
              </select>
              {helpText("pace", "audio.param_help_pace")}
            </label>
            {mode === "monologue" ? (
              <>
                <label className={s.field}>
                  <span>{t("audio.accent")} {helpDot("accent")}</span>
                  <select
                    className={direction.accentDetail?.trim() ? s.inheritedValue : ""}
                    value={direction.accent}
                    onChange={(event) => updateDirection("accent", event.target.value)}
                  >
                    {ACCENTS.map((accent) => <option key={accent} value={accent}>{directionLabel(accent)}</option>)}
                  </select>
                  {helpText("accent", "audio.param_help_accent")}
                </label>
                <label className={s.field}>
                  <span>{t("audio.accent_detail")} {helpDot("accent_detail")}</span>
                  <input
                    type="text"
                    value={direction.accentDetail ?? ""}
                    onChange={(event) => updateDirection("accentDetail", event.target.value)}
                    placeholder={t("audio.accent_detail_placeholder")}
                    maxLength={120}
                  />
                  {helpText("accent_detail", "audio.param_help_accent_detail")}
                </label>
                <label className={s.field}>
                  <span>{t("audio.style")} {helpDot("style")}</span>
                  <select value={direction.style} onChange={(event) => updateDirection("style", event.target.value)}>
                    {STYLES.map((style) => <option key={style} value={style}>{directionLabel(style)}</option>)}
                  </select>
                  {helpText("style", "audio.param_help_style")}
                </label>
                <label className={s.field}>
                  <span>{t("audio.speaker_notes")} {helpDot("notes")}</span>
                  <input
                    type="text"
                    value={direction.notes ?? ""}
                    onChange={(event) => updateDirection("notes", event.target.value)}
                    placeholder={t("audio.speaker_notes_placeholder")}
                    maxLength={200}
                  />
                  {helpText("notes", "audio.param_help_notes")}
                </label>
              </>
            ) : (
              <details
                className={s.speakerDetails}
                open={speakerSettingsOpen}
                onToggle={(event) => setSpeakerSettingsOpen(event.currentTarget.open)}
              >
                <summary>
                  {t("audio.speaker_settings", {
                    names: DIALOGUE_SLOTS.map((slot) => speakerDisplay(slot, names)).join(" · "),
                  })}
                </summary>
              {DIALOGUE_SLOTS.map((slot) => (
                <fieldset key={slot} className={s.speakerGroup}>
                  <legend>{speakerDisplay(slot, names)}</legend>
                  <label className={s.field}>
                    <span>{t("audio.accent")} {helpDot(`${slot}-accent`)}</span>
                    <select
                      className={
                        (direction.speakers?.[slot]?.accentDetail ?? (slot === "Speaker 1" ? direction.accentDetail : ""))?.trim()
                          ? s.inheritedValue
                          : direction.speakers?.[slot]?.accent
                            ? ""
                            : s.inheritedValue
                      }
                      value={direction.speakers?.[slot]?.accent ?? direction.accent}
                      onChange={(event) => updateSpeakerField(slot, "accent", event.target.value)}
                    >
                      {ACCENTS.map((accent) => <option key={accent} value={accent}>{directionLabel(accent)}</option>)}
                    </select>
                    {helpText(`${slot}-accent`, "audio.param_help_accent")}
                  </label>
                  <label className={s.field}>
                    <span>{t("audio.accent_detail")} {helpDot(`${slot}-accent_detail`)}</span>
                    <input
                      type="text"
                      value={direction.speakers?.[slot]?.accentDetail ?? (slot === "Speaker 1" ? direction.accentDetail ?? "" : "")}
                      onChange={(event) => updateSpeakerField(slot, "accentDetail", event.target.value)}
                      placeholder={t("audio.accent_detail_placeholder")}
                      maxLength={120}
                    />
                    {helpText(`${slot}-accent_detail`, "audio.param_help_accent_detail")}
                  </label>
                  <label className={s.field}>
                    <span>{t("audio.style")} {helpDot(`${slot}-style`)}</span>
                    <select
                      className={direction.speakers?.[slot]?.style ? "" : s.inheritedValue}
                      value={direction.speakers?.[slot]?.style ?? direction.style}
                      onChange={(event) => updateSpeakerField(slot, "style", event.target.value)}
                    >
                      {STYLES.map((style) => <option key={style} value={style}>{directionLabel(style)}</option>)}
                    </select>
                    {helpText(`${slot}-style`, "audio.param_help_style")}
                  </label>
                  <label className={s.field}>
                    <span>{t("audio.speaker_notes")} {helpDot(`${slot}-notes`)}</span>
                    <input
                      type="text"
                      value={direction.speakers?.[slot]?.notes ?? ""}
                      onChange={(event) => updateSpeakerField(slot, "notes", event.target.value)}
                      placeholder={t("audio.speaker_notes_placeholder")}
                      maxLength={200}
                    />
                    {helpText(`${slot}-notes`, "audio.param_help_notes")}
                  </label>
                </fieldset>
              ))}
              </details>
            )}
            <label className={s.field}>
              <span>{t("audio.scene")} {helpDot("scene")}</span>
              <textarea
                value={direction.scene ?? ""}
                onChange={(event) => updateDirection("scene", event.target.value)}
                placeholder={t("audio.scene_placeholder")}
              />
              {helpText("scene", "audio.param_help_scene")}
            </label>
          </section>

          <section className={s.zone}>
            <div className={s.zoneTitle}>
              <h2>{t("audio.booth_zone")}</h2>
              <button type="button" className={s.zoneHelp} onClick={() => setHelpOpen(true)} aria-label={t("audio.help_title")}>
                <HelpCircle size={15} aria-hidden />
              </button>
            </div>

            <VoiceCasting voices={catalog} mode={mode} selected={voices} onChange={setVoices} slotNames={names} />

            <div className={s.generateDock}>
              <button
                type="button"
                className={s.primary}
                disabled={!canGenerate}
                onClick={() => void generate()}
                aria-describedby={generateHint ? "generate-hint" : undefined}
              >
                <FileAudio size={17} aria-hidden />
                {t("audio.generate")}
              </button>
              {generateHint && <p id="generate-hint" className={s.generateHint}>{generateHint}</p>}
            </div>

            {quotaBlocked && (
              <p className={s.warning}>
                {t("audio.quota_blocked")}{" "}
                {creditPacks.length > 0 ? (
                  <button type="button" className={s.warningAction} onClick={() => setBuyOpen(true)}>
                    {t("audio.buy_credits")}
                  </button>
                ) : (
                  <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t("audio.quota_blocked_mail_subject"))}`}>
                    {t("audio.quota_blocked_cta")}
                  </a>
                )}
              </p>
            )}
            {notice && <p className={s.notice}>{notice}</p>}
            {error && <p className={s.error}>{error}</p>}

            <GenerationConsole job={activeJob} elapsedSeconds={elapsed} slotNames={names} />

            {activeJob?.status === "ready" && (
              <WaveformPlayer
                job={activeJob}
                selectedBlock={selectedBlock}
                onSelectBlock={setSelectedBlock}
                onRegenerate={(idx) => void regenerateBlock(idx)}
                regenerating={regenerating}
              />
            )}
          </section>
        </div>

        <section className={s.history}>
          <div className={s.zoneTitle}>
            <h2>{t("audio.recent_takes")}</h2>
            <Link to="/audio/library" className={s.libraryLink}>
              {t("audio.library_link")}
            </Link>
          </div>
          {historyLoading ? (
            <div className={s.skeletons} aria-label={t("audio.history_loading")}>
              <span />
              <span />
              <span />
            </div>
          ) : history.length === 0 ? (
            <p className={s.emptyHistory}>{t("audio.history_empty")}</p>
          ) : (
            <div className={s.historyRows}>
              {history.slice(0, 3).map((job) => (
                <button key={job.id} type="button" onClick={() => void duplicateSettings(job)} className={s.historyRow}>
                  <span className={s.historyTitle}>{takeTitle(job)}</span>
                  <span className={s.historyMeta}>{modeLabel(job.mode)} · {qualityLabel(job.quality)}</span>
                  <strong>{formatShort(job.actualSeconds ?? job.estimatedSeconds)}</strong>
                  <span
                    className={`${s.historyStatus} ${
                      job.status === "failed" ? s.historyStatusFailed : job.status !== "ready" ? s.historyStatusActive : ""
                    }`}
                  >
                    {t(`audio.status_${job.status}`)}
                  </span>
                  <small title={job.expiresAt ? formatDate(job.expiresAt) : undefined}>
                    {expiresLabel(job.expiresAt)}
                  </small>
                  <Copy size={15} aria-hidden />
                </button>
              ))}
            </div>
          )}
        </section>

        {buyOpen && (
          <div className={s.helpOverlay} role="dialog" aria-modal="true" aria-labelledby="buy-credits-title">
            <div className={s.helpPanel}>
              <div className={s.prepareHead}>
                <div>
                  <h3 id="buy-credits-title">{t("audio.buy_title")}</h3>
                  <p>{t("audio.buy_intro")}</p>
                </div>
                <button type="button" className={s.iconButton} onClick={() => setBuyOpen(false)} aria-label={t("common.close")}>
                  <X size={16} aria-hidden />
                </button>
              </div>
              <div className={s.packGrid}>
                {creditPacks.map((pack) => (
                  <div key={pack.id} className={s.packCard}>
                    <strong>{t("audio.buy_pack_minutes", { minutes: String(pack.minutes) })}</strong>
                    <span className={s.packPrice}>
                      {pack.amountCents !== null && pack.currency
                        ? (pack.amountCents / 100).toLocaleString(uiLocale(), {
                            style: "currency",
                            currency: pack.currency.toUpperCase(),
                          })
                        : "—"}
                    </span>
                    <button
                      type="button"
                      className={s.primary}
                      disabled={buyingPack !== null}
                      onClick={() => void buyPack(pack.id)}
                    >
                      {buyingPack === pack.id ? t("common.loading") : t("audio.buy_cta")}
                    </button>
                  </div>
                ))}
              </div>
              <p className={s.buyNote}>{t("audio.buy_secure_note")}</p>
            </div>
          </div>
        )}

        {helpOpen && (
          <div className={s.helpOverlay} role="dialog" aria-modal="true" aria-labelledby="audio-help-title">
            <div className={s.helpPanel}>
              <div className={s.prepareHead}>
                <div>
                  <h3 id="audio-help-title">{t("audio.help_title")}</h3>
                  <p>{t("audio.help_intro")}</p>
                </div>
                <button type="button" className={s.iconButton} onClick={() => setHelpOpen(false)} aria-label={t("common.close")}>
                  <X size={16} aria-hidden />
                </button>
              </div>
              <h4 className={s.helpSection}>{t("audio.help_script_title")}</h4>
              <ul className={s.helpList}>
                <li>{t("audio.help_speakers")}</li>
                <li>{t("audio.help_tags")}</li>
                <li>{t("audio.help_stage")}</li>
                <li>{t("audio.help_direction")}</li>
                <li>{t("audio.help_dictation")}</li>
              </ul>
              <h4 className={s.helpSection}>{t("audio.guide_direction_title")}</h4>
              <ul className={s.helpList}>
                <li>{t("audio.guide_direction_1")}</li>
                <li>{t("audio.guide_direction_2")}</li>
                <li>{t("audio.guide_direction_3")}</li>
                <li>{t("audio.guide_direction_4")}</li>
              </ul>
              <h4 className={s.helpSection}>{t("audio.guide_generation_title")}</h4>
              <ul className={s.helpList}>
                <li>{t("audio.guide_generation_1")}</li>
                <li>{t("audio.guide_generation_2")}</li>
                <li>{t("audio.guide_generation_3")}</li>
                <li>{t("audio.guide_generation_4")}</li>
              </ul>
              <div className={s.helpTags} aria-label={t("audio.help_supported_tags")}>
                <strong>{t("audio.help_supported_tags")}</strong>
                <div>
                  {SUPPORTED_AUDIO_TAGS.map((tag) => <code key={tag}>{tag}</code>)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
