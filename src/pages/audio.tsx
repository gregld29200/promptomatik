import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Copy, FileAudio, HelpCircle, Info, Lock, Tags, Wand2, X } from "lucide-react";
import { Link } from "react-router";
import { Shell } from "@/components/layout/shell";
import { AudioTeaser } from "@/components/audio/audio-teaser";
import { GenerationConsole } from "@/components/audio/generation-console";
import { VoiceCasting } from "@/components/audio/voice-casting";
import { WaveformPlayer } from "@/components/audio/waveform-player";
import { useAuth } from "@/lib/auth/auth-context";
import { SUPPORTED_LANGUAGES, getLanguage, t, type Language } from "@/lib/i18n";
import * as api from "@/lib/api";
import { SUPPORTED_AUDIO_TAGS, lintAudioScript, type ScriptLintFinding } from "@/lib/audio-script-rules";
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
const TAGS = SUPPORTED_AUDIO_TAGS;
const PREPARE_GROUPS = ["speaker_rename", "tag_added", "direction_hint", "cleanup"] as const;

// Sample scripts, one per interface language, offered when the editor is empty.
const EXAMPLES: Record<Language, string> = {
  fr: `Locuteur 1: Bonjour, je cherche une salle pour une réunion jeudi matin.\nLocuteur 2: Bien sûr. Vous attendez combien de personnes ?\nLocuteur 1: Huit personnes, avec un projecteur si possible.\nLocuteur 2: La salle Camélia est libre à 10 heures. Je vous la réserve ?`,
  en: `Speaker 1: Good morning, I need to move my appointment to Friday.\nSpeaker 2: No problem. Would 2:30 work for you?\nSpeaker 1: Yes, that is perfect. Could you send me a confirmation?\nSpeaker 2: Of course. You will receive it in a few minutes.`,
  es: `Hablante 1: Buenos días, quisiera cambiar mi cita al viernes.\nHablante 2: Sin problema. ¿Le viene bien a las dos y media?\nHablante 1: Sí, perfecto. ¿Podría enviarme una confirmación?\nHablante 2: Por supuesto. La recibirá en unos minutos.`,
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

const PREPARE_TYPE_TO_GROUP: Record<api.AudioPrepareChange["type"], (typeof PREPARE_GROUPS)[number]> = {
  speaker_rename: "speaker_rename",
  tag_added: "tag_added",
  stage_direction_converted: "tag_added",
  direction_hint: "direction_hint",
  removed_stage_direction: "cleanup",
  cleanup: "cleanup",
};

function estimateSeconds(script: string) {
  const words = stripTags(script).trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / 2.5);
}

function speakerLabels(script: string) {
  const labels = new Set<string>();
  for (const match of script.matchAll(/^([^:\n]{1,40}):/gm)) {
    const label = match[1].trim();
    if (label) labels.add(label);
  }
  return [...labels];
}

function voicesForPayload(mode: AudioMode, script: string, selected: Record<string, string>) {
  if (mode === "monologue") return { solo: selected.solo };
  const labels = speakerLabels(script);
  const speakers = labels.length > 0 ? labels : ["Speaker 1", "Speaker 2"];
  return Object.fromEntries(
    speakers.slice(0, 2).map((speaker, index) => [
      speaker,
      selected[`Speaker ${index + 1}`],
    ])
  );
}

function renderHighlighted(text: string) {
  return text.split(/(\[[^\]]+\])/g).map((part, index) => {
    if (part.startsWith("[") && part.endsWith("]")) {
      return <mark key={index}>{part}</mark>;
    }
    return <span key={index}>{part}</span>;
  });
}

function changeId(change: api.AudioPrepareChange, index: number) {
  return `${change.type}-${change.line}-${index}`;
}

function diffParts(before: string, after: string) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    prefix: before.slice(0, prefix),
    beforeChanged: before.slice(prefix, before.length - suffix),
    afterChanged: after.slice(prefix, after.length - suffix),
    suffix: before.slice(before.length - suffix),
  };
}

function applyPreparedChanges(original: string, changes: api.AudioPrepareChange[], decisions: Record<string, "accepted" | "rejected">) {
  const lines = original.split("\n");
  const directionHints: string[] = [];
  const orderedChanges = [...changes].sort((left, right) => {
    const priority: Record<api.AudioPrepareChange["type"], number> = {
      stage_direction_converted: 0,
      tag_added: 0,
      direction_hint: 1,
      removed_stage_direction: 1,
      cleanup: 1,
      speaker_rename: 2,
    };
    return priority[left.type] - priority[right.type];
  });

  orderedChanges.forEach((change) => {
    const originalIndex = changes.indexOf(change);
    if (decisions[changeId(change, originalIndex)] !== "accepted") return;
    if (change.type === "direction_hint") {
      if (change.after.trim()) directionHints.push(change.after.trim());
      const lineIndex = change.line - 1;
      if (lineIndex >= 0 && lineIndex < lines.length && lines[lineIndex].includes(change.before)) {
        lines[lineIndex] = lines[lineIndex].replace(change.before, "").replace(/\s{2,}/g, " ").trim();
      }
      return;
    }
    const lineIndex = change.line - 1;
    if (lineIndex >= 0 && lineIndex < lines.length && lines[lineIndex].includes(change.before)) {
      lines[lineIndex] = lines[lineIndex].replace(change.before, change.after);
      return;
    }

    if (lineIndex >= 0 && lineIndex < lines.length && change.before.endsWith(":") && change.after.endsWith(":")) {
      const expectedName = change.before.slice(0, -1).trim().toLowerCase();
      const label = lines[lineIndex].match(/^([^:\n]{1,80}):/);
      const currentName = label?.[1]?.trim().toLowerCase();
      if (label && currentName?.startsWith(expectedName)) {
        lines[lineIndex] = lines[lineIndex].replace(label[0], change.after);
        return;
      }
    }

    const script = lines.join("\n");
    if (script.includes(change.before)) {
      const next = script.replace(change.before, change.after);
      lines.splice(0, lines.length, ...next.split("\n"));
    }
  });

  return { script: lines.join("\n"), directionHints };
}

function directionLabel(value: string) {
  return DIRECTION_LABELS[getLanguage()][value] ?? value;
}

function speakerDisplay(slot: string) {
  const n = slot.match(/^Speaker\s+(\d+)$/i)?.[1];
  return n ? t("audio.speaker_n", { n }) : slot;
}

function lintMessage(finding: ScriptLintFinding) {
  const message = t(`audio.lint_${finding.code}`, { tag: finding.tag ?? "" });
  return finding.line ? `${message} ${t("audio.lint_line", { line: String(finding.line) })}` : message;
}

// The worker re-runs the linter as a backstop and answers with `audio_lint_<code>`
// rather than prose, since only the client knows the teacher's language.
function jobErrorMessage(error: string) {
  return error.startsWith("audio_lint_") ? t(`audio.lint_${error.slice("audio_lint_".length)}`) : error;
}

const DIALOGUE_SLOTS = ["Speaker 1", "Speaker 2"] as const;

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
  const [prepareResult, setPrepareResult] = useState<api.AudioPrepareResult | null>(null);
  const [prepareDecisions, setPrepareDecisions] = useState<Record<string, "accepted" | "rejected">>({});
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [openHelp, setOpenHelp] = useState<string | null>(null);
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
  const warningFindings = lintFindings.filter((finding) => finding.severity === "warning");
  const selectedVoices = useMemo(() => voicesForPayload(mode, script, voices), [mode, script, voices]);
  const missingVoices = Object.values(selectedVoices).some((voice) => !voice);
  const quotaPool = (quota?.includedRemaining ?? 0) + (quota?.credits ?? 0);
  const quotaBlocked = quota ? estimate > quotaPool * 1.2 : false;
  const canGenerate = script.trim().length > 0 && blockingFindings.length === 0 && !missingVoices && !quotaBlocked;
  const acceptedPrepareCount = Object.values(prepareDecisions).filter((decision) => decision === "accepted").length;

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

  function helpDot(id: string) {
    return (
      <button
        type="button"
        className={s.helpDot}
        aria-label={t("audio.param_help_aria")}
        aria-expanded={openHelp === id}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpenHelp((prev) => (prev === id ? null : id));
        }}
      >
        <Info size={13} aria-hidden />
      </button>
    );
  }

  function helpText(id: string, key: string) {
    return openHelp === id ? <p className={s.fieldHelp}>{t(key)}</p> : null;
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

  function clearPrepareReview() {
    setPrepareResult(null);
    setPrepareDecisions({});
    setPrepareError(null);
  }

  function updateScript(next: string) {
    setScript(next);
    clearPrepareReview();
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

  async function prepareScript() {
    if (!script.trim() || preparing) return;
    setPreparing(true);
    setPrepareError(null);
    const res = await api.prepareAudioScript({ script, mode });
    setPreparing(false);
    if (res.error) {
      setPrepareResult(null);
      setPrepareDecisions({});
      setPrepareError(res.error.error);
      return;
    }

    setPrepareResult(res.data);
    setPrepareDecisions({});
  }

  function decidePrepareChange(id: string, decision: "accepted" | "rejected") {
    setPrepareDecisions((prev) => ({ ...prev, [id]: decision }));
  }

  function acceptAllPreparedChanges() {
    if (!prepareResult) return;
    setPrepareDecisions(Object.fromEntries(
      prepareResult.changes.map((change, index) => [changeId(change, index), "accepted"])
    ));
  }

  function applyPrepareSelection() {
    if (!prepareResult || acceptedPrepareCount === 0) return;
    const acceptedHints = prepareResult.changes
      .map((change, index) => ({ change, id: changeId(change, index) }))
      .filter(({ change, id }) => change.type === "direction_hint" && prepareDecisions[id] === "accepted")
      .map(({ change }) => change.after.trim())
      .filter(Boolean);
    if (acceptedPrepareCount === prepareResult.changes.length) {
      setScript(prepareResult.formatted_script);
      if (acceptedHints.length > 0) {
        setDirection((prev) => ({
          ...prev,
          scene: [prev.scene?.trim(), ...acceptedHints].filter(Boolean).join("\n"),
        }));
      }
      clearPrepareReview();
      return;
    }

    const next = applyPreparedChanges(script, prepareResult.changes, prepareDecisions);
    setScript(next.script);
    if (next.directionHints.length > 0) {
      setDirection((prev) => ({
        ...prev,
        scene: [prev.scene?.trim(), ...next.directionHints].filter(Boolean).join("\n"),
      }));
    }
    clearPrepareReview();
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
    clearPrepareReview();
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
        <AudioTeaser />
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
              {script.trim() ? <span>{t("audio.estimate", { time: formatShort(estimate) })}</span> : null}
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

            <textarea
              ref={textareaRef}
              value={script}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateScript(event.target.value)}
              className={`${s.editor} ${editorCollapsed ? s.editorCollapsed : ""}`}
              onFocus={() => setEditorCollapsed(false)}
              placeholder={t("audio.script_placeholder")}
              aria-label={t("audio.script_zone")}
            />

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

            <div className={s.prepareBar}>
              <button
                type="button"
                className={s.secondaryAction}
                disabled={!script.trim() || preparing}
                onClick={() => void prepareScript()}
              >
                <Wand2 size={16} aria-hidden />
                {preparing ? t("audio.prepare_loading") : t("audio.prepare")}
              </button>
              <button type="button" className={s.secondaryAction} onClick={() => setHelpOpen(true)}>
                <HelpCircle size={16} aria-hidden />
                {t("audio.help_title")}
              </button>
              {!script.trim() && <span>{t("audio.prepare_empty_hint")}</span>}
            </div>

            <div className={s.tags}>
              <Tags size={16} aria-hidden />
              {TAGS.map((tag) => (
                <button key={tag} type="button" onClick={() => insertTag(tag)}>
                  {tag}
                </button>
              ))}
            </div>
            <p className={s.tagsNote}>{t("audio.tags_english_note")}</p>

            {script.trim().length > 0 && blockingFindings.length > 0 && (
              <div className={s.lintPanel} role="alert">
                <strong><Lock size={15} aria-hidden /> {t("audio.lint_blocking")}</strong>
                {blockingFindings.map((finding) => (
                  <p key={`${finding.code}-${finding.line ?? 0}`}>{lintMessage(finding)} <button type="button" onClick={() => void prepareScript()}>{t("audio.prepare")}</button></p>
                ))}
              </div>
            )}

            {warningFindings.length > 0 && (
              <div className={s.lintWarnings}>
                <strong>{t("audio.lint_warnings")}</strong>
                {warningFindings.slice(0, 3).map((finding) => (
                  <p key={`${finding.code}-${finding.line ?? 0}`}>{lintMessage(finding)} <button type="button" onClick={() => void prepareScript()}>{t("audio.prepare")}</button></p>
                ))}
              </div>
            )}

            {prepareError && <p className={s.error}>{prepareError}</p>}

            {prepareResult && (
              <section className={s.prepareReview} aria-label={t("audio.prepare_review")}>
                <div className={s.prepareHead}>
                  <div>
                    <h3>{t("audio.prepare_review")}</h3>
                    <p>{t("audio.prepare_review_hint")}</p>
                  </div>
                  <button type="button" className={s.iconButton} onClick={clearPrepareReview} aria-label={t("common.close")}>
                    <X size={16} aria-hidden />
                  </button>
                </div>

                {prepareResult.warnings.length > 0 && (
                  <div className={s.prepareWarnings} role="alert">
                    <strong>{t("audio.prepare_warnings")}</strong>
                    {prepareResult.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </div>
                )}

                <div className={s.prepareGroups}>
                  {PREPARE_GROUPS.map((group) => {
                    const changes = prepareResult.changes
                      .map((change, index) => ({ change, index, id: changeId(change, index) }))
                      .filter(({ change }) => PREPARE_TYPE_TO_GROUP[change.type] === group);
                    if (changes.length === 0) return null;

                    return (
                      <section key={group} className={s.prepareGroup}>
                        <h4>{t(`audio.prepare_group_${group}`)} <span>{changes.length}</span></h4>
                        <div className={s.changeList}>
                          {changes.map(({ change, id }) => {
                            const parts = diffParts(change.before, change.after);
                            const decision = prepareDecisions[id];
                            return (
                              <article key={id} className={`${s.changeItem} ${decision === "accepted" ? s.changeAccepted : ""} ${decision === "rejected" ? s.changeRejected : ""}`}>
                                <div className={s.changeLine}>
                                  <span>{t("audio.prepare_line", { line: String(change.line) })}</span>
                                  <p>{change.rationale}</p>
                                </div>
                                <div className={s.inlineDiff}>
                                  <span>{parts.prefix}</span>
                                  {parts.beforeChanged && <del>{parts.beforeChanged}</del>}
                                  <span>{parts.suffix}</span>
                                  <span aria-hidden>→</span>
                                  <span>{parts.prefix}</span>
                                  {parts.afterChanged && <ins>{parts.afterChanged}</ins>}
                                  <span>{parts.suffix}</span>
                                </div>
                                <div className={s.changeActions}>
                                  <button type="button" className={decision === "accepted" ? s.choiceActive : ""} onClick={() => decidePrepareChange(id, "accepted")}>
                                    {t("audio.prepare_accept")}
                                  </button>
                                  <button type="button" className={decision === "rejected" ? s.choiceActive : ""} onClick={() => decidePrepareChange(id, "rejected")}>
                                    {t("audio.prepare_reject")}
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>

                <div className={s.prepareFooter}>
                  <button type="button" className={s.secondaryAction} onClick={acceptAllPreparedChanges}>
                    {t("audio.prepare_accept_all")}
                  </button>
                  <button type="button" className={s.confirmAction} disabled={acceptedPrepareCount === 0} onClick={applyPrepareSelection}>
                    {t("audio.prepare_apply")}
                  </button>
                </div>
              </section>
            )}

            <div className={s.scriptPreview} aria-label={t("audio.preview")}>
              {(script || t("audio.preview_empty")).split("\n").map((line, index) => {
                const label = line.match(/^([^:\n]{1,40}):/);
                return (
                  <p key={`${line}-${index}`} className={label ? s.turn : ""}>
                    {label && <strong>{label[1]}</strong>}
                    {renderHighlighted(label ? line.slice(label[0].length).trimStart() : line)}
                  </p>
                );
              })}
            </div>
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
              DIALOGUE_SLOTS.map((slot) => (
                <fieldset key={slot} className={s.speakerGroup}>
                  <legend>{speakerDisplay(slot)}</legend>
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
              ))
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

            <VoiceCasting voices={catalog} mode={mode} selected={voices} onChange={setVoices} />

            <div className={s.qualityRow}>
              <button type="button" className={s.primary} disabled={!canGenerate} onClick={() => void generate()}>
                <FileAudio size={17} aria-hidden />
                {t("audio.generate")}
              </button>
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

            <GenerationConsole job={activeJob} elapsedSeconds={elapsed} />

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
