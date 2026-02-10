import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import BlurText from "@/reactbits/blur-text";
import { t } from "@/lib/i18n";
import { FileText } from "lucide-react";
import s from "./dashboard.module.css";

export function DashboardPage() {
  return (
    <Shell>
      <div className={s.header}>
        <div>
          <BlurText
            text={t("dashboard.welcome", { name: "Greg" })}
            className={s.greeting}
            delay={60}
            animateBy="words"
            direction="top"
          />
          <FadeIn delay={0.3} duration={0.4} direction="up" distance={10}>
            <p className={s.greetingSub}>{t("dashboard.subtitle")}</p>
          </FadeIn>
        </div>
        <FadeIn delay={0.4} duration={0.4} direction="right" distance={16}>
          <Button variant="cta">{t("dashboard.new_prompt")}</Button>
        </FadeIn>
      </div>

      <FadeIn delay={0.5} duration={0.6} direction="up" distance={20}>
        <div className={s.emptyState}>
          <FileText className={s.emptyIcon} strokeWidth={1.5} />
          <p className={s.emptyTitle}>{t("dashboard.empty_title")}</p>
          <p className={s.emptyText}>{t("dashboard.empty")}</p>
          <Button variant="secondary">{t("dashboard.new_prompt")}</Button>
        </div>
      </FadeIn>
    </Shell>
  );
}
