import { useState } from "react";
import { Button, Spinner, Textarea } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import { RefinementReview } from "./refinement-review";
import { t } from "@/lib/i18n";
import { ChevronDown, ChevronUp } from "lucide-react";
import * as api from "@/lib/api";
import type { PromptBlock, RefinedPrompt } from "@/lib/api";
import s from "./refinement-flow.module.css";

interface RefinementFlowProps {
  promptId: string;
  language: string;
  onAccept: (blocks: PromptBlock[], tips: string[]) => void;
  onDiscard: () => void;
}

type Step = "form" | "loading" | "review";

const ISSUE_TYPES = [
  "too_complex",
  "too_simple",
  "wrong_format",
  "off_topic",
  "other",
] as const;

export function RefinementFlow({
  promptId,
  language,
  onAccept,
  onDiscard,
}: RefinementFlowProps) {
  const [step, setStep] = useState<Step>("form");
  const [issueType, setIssueType] = useState<string>("");
  const [description, setDescription] = useState("");
  const [outputSample, setOutputSample] = useState("");
  const [showOutput, setShowOutput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refined, setRefined] = useState<RefinedPrompt | null>(null);

  async function handleSubmit() {
    if (!issueType) return;

    setError(null);
    setStep("loading");

    const res = await api.refinePrompt(
      promptId,
      issueType,
      description.trim() || null,
      outputSample.trim() || null,
      language
    );

    if (res.error) {
      setError(res.error.error);
      setStep("form");
      return;
    }

    setRefined(res.data.refined);
    setStep("review");
  }

  if (step === "loading") {
    return (
      <div className={s.panel}>
        <FadeIn duration={0.4} direction="up" distance={12}>
          <div className={s.loadingCenter}>
            <Spinner size={28} />
            <p className={s.loadingText}>{t("refinement.analyzing")}</p>
            <p className={s.loadingSub}>{t("refinement.analyzing_sub")}</p>
          </div>
        </FadeIn>
      </div>
    );
  }

  if (step === "review" && refined) {
    return (
      <div className={s.panel}>
        <FadeIn duration={0.5} direction="up" distance={16}>
          <div>
            <h2 className={s.heading}>{t("refinement.review_title")}</h2>
            <p className={s.subtitle}>{t("refinement.review_sub")}</p>
          </div>
          <RefinementReview
            blocks={refined.blocks}
            changes={refined.changes}
          />
          <div className={s.actions}>
            <Button
              onClick={() =>
                onAccept(
                  refined.blocks,
                  refined.tips || []
                )
              }
            >
              {t("refinement.accept")}
            </Button>
            <Button variant="ghost" onClick={onDiscard}>
              {t("refinement.discard")}
            </Button>
          </div>
        </FadeIn>
      </div>
    );
  }

  // Step: form
  return (
    <div className={s.panel}>
      <FadeIn duration={0.4} direction="up" distance={12}>
        <div>
          <h2 className={s.heading}>{t("refinement.title")}</h2>
          <p className={s.subtitle}>{t("refinement.subtitle")}</p>
        </div>

        <div>
          <span className={s.chipLabel}>{t("refinement.issue_type")}</span>
          <div className={s.chips}>
            {ISSUE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className={`${s.chip} ${issueType === type ? s.selected : ""}`}
                onClick={() => setIssueType(type)}
              >
                {t(`refinement.issue_${type}`)}
              </button>
            ))}
          </div>
        </div>

        <Textarea
          label={t("refinement.describe_label")}
          placeholder={t("refinement.describe_placeholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />

        <div>
          <button
            type="button"
            className={s.toggleBtn}
            onClick={() => setShowOutput(!showOutput)}
          >
            {showOutput ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {t("refinement.output_label")}
          </button>
          {showOutput && (
            <div style={{ marginTop: "var(--space-2)" }}>
              <Textarea
                placeholder={t("refinement.output_placeholder")}
                value={outputSample}
                onChange={(e) => setOutputSample(e.target.value)}
                rows={5}
              />
            </div>
          )}
        </div>

        {error && <p className={s.error}>{error}</p>}

        <div className={s.actions}>
          <Button onClick={handleSubmit} disabled={!issueType}>
            {t("refinement.submit")}
          </Button>
          <Button variant="ghost" onClick={onDiscard}>
            {t("refinement.discard")}
          </Button>
        </div>
      </FadeIn>
    </div>
  );
}
