import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Clock, Copy, FileAudio, HelpCircle, Lock, Tags, Wand2, X } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { UpgradeGate } from "@/components/upgrade-gate";
import { GenerationConsole } from "@/components/audio/generation-console";
import { VoiceCasting } from "@/components/audio/voice-casting";
import { WaveformPlayer } from "@/components/audio/waveform-player";
import { useAuth } from "@/lib/auth/auth-context";
import { getLanguage, t } from "@/lib/i18n";
import * as api from "@/lib/api";
import { SUPPORTED_AUDIO_TAGS, lintAudioScript } from "@/lib/audio-script-rules";
import type { AudioDirection, AudioJob, AudioMode, AudioQuality, AudioVoice, CefrLevel } from "@/lib/api";
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

const EXAMPLE_FR = `Locuteur 1: Bonjour, je cherche une salle pour une réunion jeudi matin.\nLocuteur 2: Bien sûr. Vous attendez combien de personnes ?\nLocuteur 1: Huit personnes, avec un projecteur si possible.\nLocuteur 2: La salle Camélia est libre à 10 heures. Je vous la réserve ?`;
const EXAMPLE_EN = `Speaker 1: Good morning, I need to move my appointment to Friday.\nSpeaker 2: No problem. Would 2:30 work for you?\nSpeaker 1: Yes, that is perfect. Could you send me a confirmation?\nSpeaker 2: Of course. You will receive it in a few minutes.`;

const DIRECTION_LABELS: Record<string, string> = {
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
};

const STATUS_LABELS: Record<string, string> = {
  queued: "En attente",
  generating: "En régie",
  assembling: "Assemblage",
  ready: "Prêt",
  failed: "Échec",
};

const PREPARE_GROUP_LABELS: Record<(typeof PREPARE_GROUPS)[number], string> = {
  speaker_rename: "Renommages de locuteurs",
  tag_added: "Tags proposés",
  direction_hint: "Direction proposée",
  cleanup: "Nettoyages",
};

const PREPARE_TYPE_TO_GROUP: Record<api.AudioPrepareChange["type"], (typeof PREPARE_GROUPS)[number]> = {
  speaker_rename: "speaker_rename",
  tag_added: "tag_added",
  stage_direction_converted: "tag_added",
  direction_hint: "direction_hint",
  removed_stage_direction: "cleanup",
  cleanup: "cleanup",
};

function stripTags(text: string) {
  return text.replace(/\[[^\]]+\]/g, " ");
}

function estimateSeconds(script: string) {
  const words = stripTags(script).trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / 2.5);
}

function formatQuota(seconds: number) {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  return t("audio.quota_minutes", { minutes: String(minutes) });
}

function formatShort(seconds: number) {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return minutes > 0 ? `${minutes} min ${rest}s` : `${rest}s`;
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
  return DIRECTION_LABELS[value] ?? value;
}

function localeForDates() {
  return getLanguage() === "fr" ? "fr-FR" : "en-US";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(localeForDates(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function scriptTitle(script: string) {
  const clean = stripTags(script)
    .replace(/^(Speaker|Locuteur)\s+\d+\s*:/gim, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return t("audio.untitled");
  const words = clean.split(" ").slice(0, 8).join(" ");
  return clean.split(" ").length > 8 ? `${words}...` : words;
}

function qualityLabel(quality: AudioQuality) {
  return quality === "final" ? t("audio.final") : t("audio.draft");
}

function modeLabel(mode: AudioMode) {
  return mode === "dialogue" ? t("audio.dialogue") : t("audio.monologue");
}

export function AudioStudioPage() {
  const { isParticipant } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mode, setMode] = useState<AudioMode>("dialogue");
  const [quality, setQuality] = useState<AudioQuality>("final");
  const [script, setScript] = useState("");
  const [direction, setDirection] = useState<AudioDirection>({
    level: "B1",
    accent: "Neutral international",
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
    const [quotaRes, voicesRes, jobsRes] = await Promise.all([
      api.getAudioQuota(),
      api.getAudioVoices(),
      api.getAudioJobs(8),
    ]);
    if (quotaRes.data) setQuota(quotaRes.data);
    if (voicesRes.data) setCatalog(voicesRes.data.voices);
    if (jobsRes.data) setHistory(jobsRes.data.jobs);
    setHistoryLoading(false);
  }

  function updateDirection<Key extends keyof AudioDirection>(key: Key, value: AudioDirection[Key]) {
    setDirection((prev) => ({ ...prev, [key]: value }));
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
      setError(res.error.code === "audio_quota_exceeded" ? t("audio.quota_blocked") : res.error.error);
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
    setQuality(job.quality);
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
          <div className={s.quota} aria-live="polite">
            <Clock size={18} aria-hidden />
            <strong>
              {quota ? formatQuota(quota.includedRemaining) : t("audio.quota_loading")}
              {quota && quota.credits > 0
                ? ` ${t("audio.quota_credits", { minutes: String(Math.max(1, Math.floor(quota.credits / 60))) })}`
                : null}
            </strong>
            <span>{t("audio.quota_reset")}</span>
          </div>
        </header>

        <div className={s.zones}>
          <section className={s.zone}>
            <div className={s.zoneTitle}>
              <h2>{t("audio.script_zone")}</h2>
              <span>{t("audio.estimate", { time: formatShort(estimate) })}</span>
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
              className={s.editor}
              placeholder={t("audio.script_placeholder")}
              aria-label={t("audio.script_zone")}
            />

            {!script.trim() && (
              <div className={s.emptyTools}>
                <span>{t("audio.empty_script")}</span>
                <button type="button" onClick={() => updateScript(EXAMPLE_FR)}>FR</button>
                <button type="button" onClick={() => updateScript(EXAMPLE_EN)}>EN</button>
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

            {blockingFindings.length > 0 && (
              <div className={s.lintPanel} role="alert">
                <strong><Lock size={15} aria-hidden /> {t("audio.lint_blocking")}</strong>
                {blockingFindings.map((finding) => (
                  <p key={`${finding.code}-${finding.line ?? 0}`}>{finding.message} <button type="button" onClick={() => void prepareScript()}>{finding.remedy}</button></p>
                ))}
              </div>
            )}

            {warningFindings.length > 0 && (
              <div className={s.lintWarnings}>
                <strong>{t("audio.lint_warnings")}</strong>
                {warningFindings.slice(0, 3).map((finding) => (
                  <p key={`${finding.code}-${finding.line ?? 0}`}>{finding.message} <button type="button" onClick={() => void prepareScript()}>{finding.remedy}</button></p>
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
                        <h4>{PREPARE_GROUP_LABELS[group]} <span>{changes.length}</span></h4>
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
            </div>

            <label className={s.field}>
              <span>{t("audio.level")}</span>
              <select value={direction.level} onChange={(event) => updateDirection("level", event.target.value as CefrLevel)}>
                {LEVELS.map((level) => <option key={level}>{level}</option>)}
              </select>
            </label>
            <label className={s.field}>
              <span>{t("audio.accent")}</span>
              <select value={direction.accent} onChange={(event) => updateDirection("accent", event.target.value)}>
                {ACCENTS.map((accent) => <option key={accent} value={accent}>{directionLabel(accent)}</option>)}
              </select>
            </label>
            <label className={s.field}>
              <span>{t("audio.pace")}</span>
              <select value={direction.pace} onChange={(event) => updateDirection("pace", event.target.value)}>
                {PACES.map((pace) => <option key={pace} value={pace}>{directionLabel(pace)}</option>)}
              </select>
            </label>
            <label className={s.field}>
              <span>{t("audio.style")}</span>
              <select value={direction.style} onChange={(event) => updateDirection("style", event.target.value)}>
                {STYLES.map((style) => <option key={style} value={style}>{directionLabel(style)}</option>)}
              </select>
            </label>
            <label className={s.field}>
              <span>{t("audio.scene")}</span>
              <textarea
                value={direction.scene ?? ""}
                onChange={(event) => updateDirection("scene", event.target.value)}
                placeholder={t("audio.scene_placeholder")}
              />
            </label>
          </section>

          <section className={s.zone}>
            <div className={s.zoneTitle}>
              <h2>{t("audio.booth_zone")}</h2>
              <span>{quality === "final" ? t("audio.final") : t("audio.draft")}</span>
            </div>

            <VoiceCasting voices={catalog} mode={mode} selected={voices} onChange={setVoices} />

            <div className={s.qualityRow}>
              <div className={s.segmented} aria-label={t("audio.quality")}>
                {(["draft", "final"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={quality === option ? s.segmentedActive : ""}
                    onClick={() => setQuality(option)}
                  >
                    {option === "draft" ? t("audio.draft") : t("audio.final")}
                  </button>
                ))}
              </div>
              <button type="button" className={s.primary} disabled={!canGenerate} onClick={() => void generate()}>
                <FileAudio size={17} aria-hidden />
                {t("audio.generate")}
              </button>
            </div>

            {quotaBlocked && (
              <p className={s.warning}>
                {t("audio.quota_blocked")}{" "}
                <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t("audio.quota_blocked_mail_subject"))}`}>
                  {t("audio.quota_blocked_cta")}
                </a>
              </p>
            )}
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
            <h2>{t("audio.history")}</h2>
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
              {history.map((job) => (
                <button key={job.id} type="button" onClick={() => void duplicateSettings(job)} className={s.historyRow}>
                  <span className={s.historyTitle}>{scriptTitle(job.script)}</span>
                  <span className={s.historyMeta}>{modeLabel(job.mode)} · {qualityLabel(job.quality)}</span>
                  <strong>{formatShort(job.actualSeconds ?? job.estimatedSeconds)}</strong>
                  <span className={s.historyStatus}>{STATUS_LABELS[job.status] ?? job.status}</span>
                  <small>{t("audio.expires_on", { date: formatDate(job.expiresAt) })}</small>
                  <Copy size={15} aria-hidden />
                </button>
              ))}
            </div>
          )}
        </section>

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
              <ul className={s.helpList}>
                <li>{t("audio.help_speakers")}</li>
                <li>{t("audio.help_tags")}</li>
                <li>{t("audio.help_stage")}</li>
                <li>{t("audio.help_direction")}</li>
                <li>{t("audio.help_dictation")}</li>
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
