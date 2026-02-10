import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { Card, Button, Input, Spinner } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import BlurText from "@/reactbits/blur-text";
import { useAuth } from "@/lib/auth/auth-context";
import { t } from "@/lib/i18n";
import s from "./login.module.css";

export function LoginPage() {
  const { user, loading: authLoading, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Already logged in — redirect to dashboard
  if (authLoading) {
    return (
      <div className={s.page}>
        <Spinner size={28} />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const err = await login(email, password);
    if (err) {
      setError(t("auth.invalid_credentials"));
    }
    setSubmitting(false);
  }

  return (
    <div className={s.page}>
      <div className={s.container}>
        <FadeIn delay={0} duration={0.6} blur>
          <Card className={s.card} variant="elevated">
            <div className={s.accent} />
            <BlurText
              text="Promptomatic"
              className={s.heading}
              delay={80}
              animateBy="letters"
              direction="top"
            />
            <FadeIn delay={0.4} duration={0.4} direction="up" distance={12}>
              <p className={s.subtitle}>{t("auth.login_subtitle")}</p>
            </FadeIn>
            <FadeIn delay={0.5} duration={0.5} direction="up" distance={16}>
              <form className={s.form} onSubmit={handleSubmit}>
                <Input
                  label={t("auth.email")}
                  type="email"
                  placeholder="nom@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Input
                  label={t("auth.password")}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                {error && <p className={s.error}>{error}</p>}
                <Button
                  variant="primary"
                  type="submit"
                  className={s.submitButton}
                  disabled={submitting}
                >
                  {submitting ? <Spinner size={16} /> : t("auth.login")}
                </Button>
              </form>
            </FadeIn>
            <FadeIn delay={0.7} duration={0.4} direction="none">
              <div className={s.divider}>{t("auth.invite_only")}</div>
              <p className={s.footer}>
                {t("auth.contact_admin")}
              </p>
            </FadeIn>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
