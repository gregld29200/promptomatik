import { useEffect, useState } from "react";
import { Button, Input, Textarea, Spinner } from "@/components/ui";
import { t } from "@/lib/i18n";
import * as api from "@/lib/api";
import type { TemplateCard } from "@/lib/api";
import s from "./template-card-editor.module.css";

interface TemplateCardEditorProps {
  promptId: string;
  /** The stored card, if any. When null a draft is requested from the LLM on mount. */
  card: TemplateCard | null;
  /** Label of the final action, e.g. "Publier". The card is saved first, then this runs. */
  confirmLabel: string;
  /** Runs after the card is saved. Return an error message to show, or null on success. */
  onConfirm: (card: TemplateCard) => Promise<string | null>;
  onCancel: () => void;
}

interface Draft {
  need: string;
  when: string;
  why: string;
  adapt: string;
}

function toDraft(card: TemplateCard | null): Draft {
  return {
    need: card?.need ?? "",
    when: card?.when ?? "",
    why: card?.why ?? "",
    adapt: card?.adapt.join("\n") ?? "",
  };
}

function fromDraft(draft: Draft): TemplateCard | null {
  const need = draft.need.trim();
  const when = draft.when.trim();
  const why = draft.why.trim();
  const adapt = draft.adapt
    .split("\n")
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
  if (!need || !when || !why || adapt.length === 0) return null;
  return { need, when, why, adapt };
}

/**
 * Admin review of a template's card before it goes live.
 * Sequence: draft (LLM) → admin edits → save → confirm action (publish / approve).
 */
export function TemplateCardEditor({ promptId, card, confirmLabel, onConfirm, onCancel }: TemplateCardEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(card));
  const [generating, setGenerating] = useState(card === null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setError(null);
    const res = await api.generateTemplateCard(promptId);
    if (res.data) {
      setDraft(toDraft(res.data.card));
    } else {
      setError(t("template_card.generate_failed"));
    }
    setGenerating(false);
  }

  useEffect(() => {
    if (card === null) void generate();
    // Only on mount: a stored card is the admin's, never overwritten silently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm() {
    const next = fromDraft(draft);
    if (!next) {
      setError(t("template_card.incomplete"));
      return;
    }
    setBusy(true);
    setError(null);
    const saved = await api.saveTemplateCard(promptId, next);
    if (saved.error) {
      setError(saved.error.error);
      setBusy(false);
      return;
    }
    const confirmError = await onConfirm(saved.data.card);
    if (confirmError) setError(confirmError);
    setBusy(false);
  }

  const update = (field: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <section className={s.editor} aria-labelledby={`card-editor-${promptId}`}>
      <div className={s.head}>
        <div>
          <h2 id={`card-editor-${promptId}`} className={s.title}>
            {t("template_card.title")}
          </h2>
          <p className={s.intro}>{t("template_card.intro")}</p>
        </div>
        <Button variant="ghost" size="small" onClick={generate} disabled={generating || busy}>
          {t("template_card.regenerate")}
        </Button>
      </div>

      {generating ? (
        <p className={s.generating} role="status">
          <Spinner size={16} /> {t("template_card.generating")}
        </p>
      ) : (
        <div className={s.fields}>
          <Input
            id={`card-need-${promptId}`}
            label={t("template_card.need")}
            hint={t("template_card.need_hint")}
            value={draft.need}
            onChange={update("need")}
            maxLength={120}
          />
          <Textarea
            id={`card-when-${promptId}`}
            label={t("template_card.when")}
            hint={t("template_card.when_hint")}
            value={draft.when}
            onChange={update("when")}
            rows={3}
          />
          <Textarea
            id={`card-why-${promptId}`}
            label={t("template_card.why")}
            hint={t("template_card.why_hint")}
            value={draft.why}
            onChange={update("why")}
            rows={2}
          />
          <Textarea
            id={`card-adapt-${promptId}`}
            label={t("template_card.adapt")}
            hint={t("template_card.adapt_hint")}
            value={draft.adapt}
            onChange={update("adapt")}
            rows={4}
          />
        </div>
      )}

      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}

      <div className={s.actions}>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t("template_card.cancel")}
        </Button>
        <Button variant="cta" onClick={handleConfirm} disabled={busy || generating}>
          {busy ? <Spinner size={14} /> : confirmLabel}
        </Button>
      </div>
    </section>
  );
}
