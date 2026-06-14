import type { ReactNode } from "react";
import { Lock, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui";
import { UPGRADE_CTA_URL } from "@/lib/config";
import { t } from "@/lib/i18n";
import s from "./upgrade-gate.module.css";

interface UpgradeGateProps {
  /** Feature-specific line under the shared title, e.g. t("upgrade.feature_templates"). */
  message: string;
  /** "page" centers the panel as full-page content; "panel" renders inline. */
  variant?: "page" | "panel";
  /** When provided, renders a close action (for gates triggered by a click). */
  onDismiss?: () => void;
  /** Extra content (e.g. the "3/3 prompts saved" counter for the library cap). */
  children?: ReactNode;
}

export function UpgradeGate({ message, variant = "panel", onDismiss, children }: UpgradeGateProps) {
  const panel = (
    <div className={s.panel}>
      <div className={s.iconWrap}>
        <Lock size={20} aria-hidden />
      </div>
      <h2 className={s.title}>{t("upgrade.title")}</h2>
      <p className={s.message}>{message}</p>
      {children}
      <a href={UPGRADE_CTA_URL} target="_blank" rel="noreferrer" className={s.ctaLink}>
        <Button variant="cta">
          {t("upgrade.cta")}
          <ArrowUpRight size={16} aria-hidden />
        </Button>
      </a>
      {onDismiss && (
        <Button variant="ghost" size="small" onClick={onDismiss}>
          {t("common.close")}
        </Button>
      )}
    </div>
  );

  if (variant === "page") {
    return <div className={s.pageCenter}>{panel}</div>;
  }
  return panel;
}
