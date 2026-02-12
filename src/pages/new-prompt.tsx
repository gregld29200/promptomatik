import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Shell } from "@/components/layout/shell";
import { Button, Card, Spinner, Badge } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import BlurText from "@/reactbits/blur-text";
import { QuestionCard } from "@/components/interview/question-card";
import { useInterview } from "@/lib/hooks/use-interview";
import { Tips } from "@/components/prompt/tips";
import { t } from "@/lib/i18n";
import * as api from "@/lib/api";
import type { Technique } from "@/lib/api";
import s from "./new-prompt.module.css";

export function NewPromptPage() {
  const spriteSrc = "/lightbulb-sprite.png";
  const navigate = useNavigate();
  const {
    step,
    intent,
    questions,
    answers,
    result,
    error,
    submitText,
    answerQuestion,
    submitAnswers,
    reset,
  } = useInterview();

  const [text, setText] = useState("");
  const [currentQ, setCurrentQ] = useState(0);
  const [saving, setSaving] = useState(false);
  const [spriteReady, setSpriteReady] = useState(false);

  useEffect(() => {
    if (step === "questions") {
      setCurrentQ(0);
    }
  }, [step, questions.length]);

  function handleSubmitText(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length >= 20) {
      submitText(text.trim());
    }
  }

  function handleAnswer(field: string, value: string) {
    answerQuestion(field, value);
    // Move to next question after a brief pause
    setTimeout(() => {
      if (currentQ < questions.length - 1) {
        setCurrentQ((prev) => prev + 1);
      }
    }, 300);
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    const res = await api.createPrompt({
      name: result.name,
      blocks: result.blocks,
      tips: result.tips || [],
      source_type: result.source_type,
      tags: result.suggested_tags,
    });
    setSaving(false);
    if (res.data) {
      navigate(`/prompt/${res.data.prompt.id}`);
    }
  }

  const allAnswered =
    questions.length > 0 &&
    questions.every((q) => answers[q.field] !== undefined);

  return (
    <Shell>
      <div className={s.page}>
        {/* Input Step */}
        {step === "input" && (
          <FadeIn duration={0.5} direction="up" distance={20}>
            <div className={s.center}>
              <BlurText
                text={t("interview.title")}
                className={s.title}
                delay={60}
                animateBy="words"
                direction="top"
              />
              <p className={s.subtitle}>{t("interview.subtitle")}</p>
              <form onSubmit={handleSubmitText} className={s.form}>
                <textarea
                  className={s.textarea}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t("interview.placeholder")}
                  rows={5}
                  data-onboard="request-text"
                />
                {text.length > 0 && text.trim().length < 20 && (
                  <p className={s.hint}>{t("interview.min_length")}</p>
                )}
                <Button
                  variant="cta"
                  size="large"
                  type="submit"
                  disabled={text.trim().length < 20}
                  data-onboard="submit-request"
                >
                  {t("interview.submit")}
                </Button>
              </form>
            </div>
          </FadeIn>
        )}

        {/* Analyzing Step */}
        {step === "analyzing" && (
          <FadeIn duration={0.4} direction="up" distance={16}>
            <div className={s.loading}>
              {/* Drop the sprite sheet at public/lightbulb-sprite.png (4 columns x 2 rows). */}
              <img
                src={spriteSrc}
                alt=""
                aria-hidden="true"
                className={s.spritePreload}
                onLoad={() => setSpriteReady(true)}
                onError={() => setSpriteReady(false)}
              />
              <div className={s.animationWrap} aria-hidden="true">
                {spriteReady ? (
                  <div className={s.lightbulbSprite} />
                ) : (
                  <Spinner size={32} />
                )}
              </div>
              <p className={s.loadingTitle}>{t("interview.analyzing")}</p>
              <p className={s.loadingSub}>{t("interview.analyzing_sub")}</p>
            </div>
          </FadeIn>
        )}

        {/* Questions Step */}
        {step === "questions" && (
          <FadeIn duration={0.4} direction="up" distance={16}>
            <div className={s.center}>
              <h2 className={s.sectionTitle}>
                {t("interview.questions_title")}
              </h2>
              <p className={s.subtitle}>{t("interview.questions_sub")}</p>

              {intent && (
                <Card variant="bordered" className={s.summaryCard}>
                  <p className={s.summaryLabel}>{t("interview.summary")}</p>
                  <p className={s.summaryText}>{intent.summary}</p>
                </Card>
              )}

              <div className={s.questionsArea}>
                <p className={s.progress}>
                  {t("interview.question_of", {
                    current: String(currentQ + 1),
                    total: String(questions.length),
                  })}
                </p>
                <FadeIn
                  key={questions[currentQ]?.id}
                  duration={0.3}
                  direction="right"
                  distance={12}
                >
                  {questions[currentQ] && (
                    <QuestionCard
                      question={questions[currentQ]}
                      onAnswer={handleAnswer}
                    />
                  )}
                </FadeIn>
              </div>

              {allAnswered && (
                <FadeIn duration={0.3} direction="up" distance={10}>
                  <Button
                    variant="cta"
                    size="large"
                    onClick={submitAnswers}
                  >
                    {t("interview.submit")}
                  </Button>
                </FadeIn>
              )}
            </div>
          </FadeIn>
        )}

        {/* Assembling Step */}
        {step === "assembling" && (
          <FadeIn duration={0.4} direction="up" distance={16}>
            <div className={s.loading}>
              <Spinner size={32} />
              <p className={s.loadingTitle}>{t("interview.assembling")}</p>
              <p className={s.loadingSub}>{t("interview.assembling_sub")}</p>
            </div>
          </FadeIn>
        )}

        {/* Done Step */}
        {step === "done" && result && (
          <FadeIn duration={0.5} direction="up" distance={20}>
            <div className={s.center}>
              <h2 className={s.sectionTitle}>{t("interview.done_title")}</h2>
              <p className={s.subtitle}>{t("interview.done_sub")}</p>

              <Card variant="ruled" className={s.resultCard}>
                <h3 className={s.resultName}>{result.name}</h3>
                <div className={s.resultBlocks}>
                  {result.blocks
                    .sort((a, b) => a.order - b.order)
                    .map((block, i) => (
                      <div key={i} className={s.resultBlock}>
                        <Badge technique={block.technique as Technique}>
                          {t(`techniques.${block.technique}`)}
                        </Badge>
                        <p className={s.blockContent}>{block.content}</p>
                      </div>
                    ))}
                </div>
                {result.tips && result.tips.length > 0 && (
                  <Tips items={result.tips} />
                )}
              </Card>

              <div className={s.actions}>
                <Button
                  variant="cta"
                  size="large"
                  onClick={handleSave}
                  disabled={saving}
                  data-onboard="save-prompt"
                >
                  {saving ? t("common.saving") : t("interview.save_prompt")}
                </Button>
                <Button variant="ghost" onClick={reset}>
                  {t("interview.start_over")}
                </Button>
              </div>
            </div>
          </FadeIn>
        )}

        {/* Error Step */}
        {step === "error" && (
          <FadeIn duration={0.4} direction="up" distance={16}>
            <div className={s.loading}>
              <p className={s.errorText}>{error || t("common.error")}</p>
              <div className={s.actions}>
                <Button variant="primary" onClick={reset}>
                  {t("common.retry")}
                </Button>
              </div>
            </div>
          </FadeIn>
        )}
      </div>
    </Shell>
  );
}
