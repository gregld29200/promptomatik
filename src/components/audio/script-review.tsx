import { Fragment, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { t } from "@/lib/i18n";
import {
  reviewSegments,
  tagSlug,
  type InlineSuggestion,
  type SuggestionDecision,
} from "@/lib/audio-suggestions";
import s from "./script-review.module.css";

export function tagLabel(tag: string): string {
  const key = `audio.tag_label.${tagSlug(tag)}`;
  const label = t(key);
  return label === key ? tag : label;
}

interface ScriptReviewProps {
  script: string;
  suggestions: InlineSuggestion[];
  warnings: string[];
  decisions: Record<string, SuggestionDecision>;
  onDecide: (id: string, decision: SuggestionDecision | null) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onApply: () => void;
  onCancel: () => void;
}

// The studio script, frozen, with each suggestion shown where it applies:
// emotion tags as chips, fixes as struck-out / inserted text. Nothing changes
// in the script until the teacher applies the accepted suggestions.
export function ScriptReview({
  script,
  suggestions,
  warnings,
  decisions,
  onDecide,
  onAcceptAll,
  onRejectAll,
  onApply,
  onCancel,
}: ScriptReviewProps) {
  const [openReason, setOpenReason] = useState<string | null>(null);
  const pending = suggestions.filter((suggestion) => !decisions[suggestion.id]).length;
  const accepted = suggestions.filter((suggestion) => decisions[suggestion.id] === "accepted").length;

  function describe(suggestion: InlineSuggestion, original: string): string {
    if (suggestion.kind === "tag" && suggestion.tag) return tagLabel(suggestion.tag);
    if (suggestion.scene) return t("audio.review_to_scene", { text: original.trim() });
    return t("audio.review_fix", { before: original.trim() || "∅", after: suggestion.insert.trim() || "∅" });
  }

  function actions(suggestion: InlineSuggestion, original: string) {
    const decision = decisions[suggestion.id];
    const name = describe(suggestion, original);
    if (decision) {
      return (
        <button
          type="button"
          className={s.iconAction}
          onClick={() => onDecide(suggestion.id, null)}
          aria-label={t("audio.review_undo", { name })}
          title={t("audio.review_undo", { name })}
        >
          <RotateCcw size={13} aria-hidden />
        </button>
      );
    }
    return (
      <>
        <button
          type="button"
          className={`${s.iconAction} ${s.accept}`}
          onClick={() => onDecide(suggestion.id, "accepted")}
          aria-label={t("audio.review_accept", { name })}
          title={t("audio.review_accept", { name })}
        >
          <Check size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={`${s.iconAction} ${s.reject}`}
          onClick={() => onDecide(suggestion.id, "rejected")}
          aria-label={t("audio.review_reject", { name })}
          title={t("audio.review_reject", { name })}
        >
          <X size={14} aria-hidden />
        </button>
      </>
    );
  }

  function reasonOf(suggestion: InlineSuggestion): string {
    return suggestion.reason || (suggestion.fixType === "speaker_rename" ? t("audio.review_reason_speaker") : "");
  }
  const opened = suggestions.find((suggestion) => suggestion.id === openReason);

  function renderSuggestion(suggestion: InlineSuggestion, original: string) {
    const decision = decisions[suggestion.id];
    const toggleReason = () => setOpenReason((current) => (current === suggestion.id ? null : suggestion.id));

    if (suggestion.kind === "tag" && suggestion.tag) {
      const state = decision === "accepted" ? s.chipAccepted : decision === "rejected" ? s.chipRejected : "";
      return (
        <span className={`${s.chip} ${state}`}>
          <button
            type="button"
            className={s.chipLabel}
            onClick={toggleReason}
            aria-expanded={openReason === suggestion.id}
            title={reasonOf(suggestion) || suggestion.tag}
          >
            {tagLabel(suggestion.tag)}
          </button>
          {actions(suggestion, original)}
        </span>
      );
    }

    if (decision === "accepted") {
      return (
        <span className={s.fixDone}>
          {suggestion.insert}
          {actions(suggestion, original)}
        </span>
      );
    }
    if (decision === "rejected") {
      return (
        <span className={s.fixDone}>
          {original}
          {actions(suggestion, original)}
        </span>
      );
    }
    return (
      <span className={s.fix}>
        <button type="button" className={s.fixText} onClick={toggleReason} aria-expanded={openReason === suggestion.id}>
          {original && <del>{original}</del>}
          {suggestion.scene
            ? <ins>{t("audio.review_scene_short")}</ins>
            : suggestion.insert && <ins>{suggestion.insert}</ins>}
        </button>
        {actions(suggestion, original)}
      </span>
    );
  }

  return (
    <section className={s.review} aria-label={t("audio.review_title")}>
      <header className={s.head}>
        <div>
          <h3>{t("audio.review_title")}</h3>
          <p>{suggestions.length > 0 ? t("audio.review_hint") : t("audio.review_none")}</p>
        </div>
        <span className={s.count} aria-live="polite">
          {t("audio.review_pending", { count: String(pending) })}
        </span>
      </header>

      {warnings.length > 0 && (
        <div className={s.warnings} role="alert">
          {warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}

      <div className={s.text}>
        {reviewSegments(script, suggestions).map((segment, index) => (
          <Fragment key={segment.kind === "text" ? `t-${index}` : segment.suggestion.id}>
            {segment.kind === "text" ? segment.text : renderSuggestion(segment.suggestion, segment.original)}
          </Fragment>
        ))}
      </div>

      <p className={s.reason} aria-live="polite">
        {opened ? `${opened.kind === "tag" && opened.tag ? tagLabel(opened.tag) : t("audio.review_why_fix")} — ${reasonOf(opened) || t("audio.review_no_reason")}` : t("audio.review_why_hint")}
      </p>

      <footer className={s.footer}>
        {suggestions.length > 0 && (
          <>
            <button type="button" className={s.secondary} onClick={onAcceptAll} disabled={pending === 0}>
              {t("audio.review_accept_all")}
            </button>
            <button type="button" className={s.secondary} onClick={onRejectAll} disabled={pending === 0}>
              {t("audio.review_reject_all")}
            </button>
          </>
        )}
        <span className={s.spacer} />
        <button type="button" className={s.secondary} onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="button" className={s.primary} onClick={onApply} disabled={accepted === 0}>
          {t("audio.review_apply", { count: String(accepted) })}
        </button>
      </footer>
    </section>
  );
}
