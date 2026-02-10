import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";

export function DashboardPage() {
  return (
    <Shell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-8)" }}>
        <h1>{t("dashboard.welcome", { name: "Greg" })}</h1>
        <Button variant="cta">{t("dashboard.new_prompt")}</Button>
      </div>
      <p style={{ color: "var(--color-text-muted)" }}>{t("dashboard.empty")}</p>
    </Shell>
  );
}
