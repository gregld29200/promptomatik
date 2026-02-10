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
  const [freetext, setFreetext] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  function handleOption(option: string) {
    setSelected(option);
    onAnswer(question.field, option);
  }

  function handleFreetext() {
    if (freetext.trim()) {
      setSelected(null);
      onAnswer(question.field, freetext.trim());
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleFreetext();
    }
  }

  return (
    <div className={s.card}>
      <p className={s.question}>{question.question}</p>
      <div className={s.options}>
        {question.options.map((option) => (
          <Button
            key={option}
            variant={selected === option ? "primary" : "secondary"}
            size="small"
            onClick={() => handleOption(option)}
            type="button"
          >
            {option}
          </Button>
        ))}
      </div>
      {question.allow_freetext && (
        <div className={s.freetext}>
          <input
            type="text"
            className={s.input}
            placeholder={t("interview.or_type")}
            value={freetext}
            onChange={(e) => setFreetext(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleFreetext}
          />
        </div>
      )}
    </div>
  );
}
