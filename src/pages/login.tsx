import { Card, Button, Input } from "@/components/ui";
import { t } from "@/lib/i18n";

export function LoginPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--color-bg)",
      }}
    >
      <Card style={{ width: "100%", maxWidth: 400 }}>
        <h2 style={{ marginBottom: "var(--space-6)" }}>Promptomatic</h2>
        <form
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
          onSubmit={(e) => e.preventDefault()}
        >
          <Input
            label={t("auth.email")}
            type="email"
            placeholder="nom@example.com"
            autoComplete="email"
          />
          <Input
            label={t("auth.password")}
            type="password"
            autoComplete="current-password"
          />
          <Button variant="primary" type="submit" style={{ width: "100%", marginTop: "var(--space-2)" }}>
            {t("auth.login")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
