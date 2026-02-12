import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams, Link } from "react-router";
import { Card, Button, Input, Spinner } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import BlurText from "@/reactbits/blur-text";
import { useAuth } from "@/lib/auth/auth-context";
import { t } from "@/lib/i18n";
import s from "./register.module.css";

export function RegisterPage() {
  const { user, loading: authLoading, register } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  if (!token) {
    return (
      <div className={s.page}>
        <div className={s.container}>
          <Card className={s.card} variant="elevated">
            <div className={s.accent} />
            <h1 className={s.heading}>Promptomatik</h1>
            <p className={s.subtitle}>{t("auth.invite_invalid")}</p>
            <div className={s.footer}>
              <Link to="/login">{t("auth.login")}</Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError(t("auth.password_min"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("register.password_mismatch"));
      return;
    }

    setSubmitting(true);
    const err = await register(token, name, password);
    if (err) {
      if (err.status === 400) {
        setError(
          err.error.includes("expired")
            ? t("auth.invite_expired")
            : err.error.includes("used")
              ? t("register.invite_used")
              : t("auth.invite_invalid")
        );
      } else {
        setError(t("common.error"));
      }
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
              text="Promptomatik"
              className={s.heading}
              delay={80}
              animateBy="letters"
              direction="top"
            />
            <FadeIn delay={0.4} duration={0.4} direction="up" distance={12}>
              <p className={s.subtitle}>{t("register.subtitle")}</p>
            </FadeIn>
            <FadeIn delay={0.5} duration={0.5} direction="up" distance={16}>
              <form className={s.form} onSubmit={handleSubmit}>
                <Input
                  label={t("auth.name")}
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <Input
                  label={t("auth.password")}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <Input
                  label={t("register.confirm_password")}
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
                {error && <p className={s.error}>{error}</p>}
                <Button
                  variant="primary"
                  type="submit"
                  className={s.submitButton}
                  disabled={submitting}
                >
                  {submitting ? <Spinner size={16} /> : t("auth.register")}
                </Button>
              </form>
            </FadeIn>
            <FadeIn delay={0.7} duration={0.4} direction="none">
              <div className={s.footer}>
                <Link to="/login">{t("register.already_have_account")}</Link>
              </div>
            </FadeIn>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
