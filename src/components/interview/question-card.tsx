import { useState } from "react";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { InterviewQuestion } from "@/lib/api";
import s from "./question-card.module.css";

interface QuestionCardProps {
  question: InterviewQuestion;
  onAnswer: (field: string, value: string) => void;
}

export function QuestionCard({ question, onAnswer }: QuestionCardProps) {
  const allowOther = question.allow_other ?? question.allow_freetext ?? false;
  const multi = question.multi_select ?? false;

  const [otherText, setOtherText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedMany, setSelectedMany] = useState<Set<string>>(new Set());

  function handleOption(value: string) {
    if (multi) {
      setSelectedMany((prev) => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
      return;
    }
    setSelected(value);
    onAnswer(question.field, value);
  }

  function submitMulti() {
    const parts: string[] = Array.from(selectedMany);
    const other = otherText.trim();
    if (allowOther && other) parts.push(other);
    const joined = parts.join(", ").trim();
    if (!joined) return;
    onAnswer(question.field, joined);
  }

  function handleOtherCommit() {
    const other = otherText.trim();
    if (!allowOther || !other) return;
    if (multi) return; // commit happens via submitMulti
    setSelected(null);
    onAnswer(question.field, other);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      multi ? submitMulti() : handleOtherCommit();
    }
  }

  return (
    <div className={s.card} data-onboard="question-card">
      <p className={s.question}>{question.question}</p>
      <div className={s.options}>
        {question.options.map((opt) => (
          <Button
            key={opt.value}
            variant={
              multi
                ? selectedMany.has(opt.value) ? "primary" : "secondary"
                : selected === opt.value ? "primary" : "secondary"
            }
            size="small"
            onClick={() => handleOption(opt.value)}
            type="button"
          >
            {opt.label}
          </Button>
        ))}
      </div>
      {allowOther && (
        <div className={s.freetext}>
          <input
            type="text"
            className={s.input}
            placeholder={question.other_placeholder || t("interview.or_type")}
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleOtherCommit}
          />
        </div>
      )}

      {multi && (
        <div className={s.footer}>
          <Button
            variant="cta"
            size="small"
            type="button"
            onClick={submitMulti}
            disabled={selectedMany.size === 0 && !otherText.trim()}
          >
            {t("common.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
