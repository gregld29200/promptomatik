import { useAuth } from "@/lib/auth/auth-context";
import { t } from "@/lib/i18n";
import { Zap } from "lucide-react";
import s from "./quota-chip.module.css";

/** Daily-generation counter — renders nothing for participants/admins (quota is null). */
export function QuotaChip() {
  const { quota } = useAuth();
  if (!quota) return null;

  return (
    <span className={s.chip} data-exhausted={quota.used >= quota.limit || undefined}>
      <Zap size={12} aria-hidden />
      {t("quota.chip", { used: String(Math.min(quota.used, quota.limit)), limit: String(quota.limit) })}
    </span>
  );
}
