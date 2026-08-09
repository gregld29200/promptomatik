import { useAuth } from "@/lib/auth/auth-context";
import { t } from "@/lib/i18n";
import { Zap } from "lucide-react";
import { Allowance } from "@/components/ui/allowance";

/**
 * Daily-generation counter — renders nothing for participants/admins (quota is
 * null).
 *
 * The pill itself is `Allowance`, the one primitive the Studio uses for every
 * "how much is left" figure, so this counter, the audio minutes and the
 * transcription hours read as one system rather than three.
 */
export function QuotaChip() {
  const { quota } = useAuth();
  if (!quota) return null;

  const exhausted = quota.used >= quota.limit;
  return (
    <Allowance
      variant="pill"
      icon={<Zap size={12} aria-hidden />}
      label={t("quota.reset_hint")}
      value={t("quota.chip", {
        used: String(Math.min(quota.used, quota.limit)),
        limit: String(quota.limit),
      })}
      exhausted={exhausted}
    />
  );
}
