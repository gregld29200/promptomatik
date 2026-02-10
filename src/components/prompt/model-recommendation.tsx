import { t } from "@/lib/i18n";
import s from "./model-recommendation.module.css";

interface ModelRecommendationProps {
  model: string;
  reason: string | null;
}

export function ModelRecommendation({ model, reason }: ModelRecommendationProps) {
  return (
    <div className={s.bar}>
      <span className={s.label}>{t("prompt.model_recommendation")}:</span>{" "}
      <span className={s.model}>{model}</span>
      {reason && <span className={s.reason}> — {reason}</span>}
    </div>
  );
}
