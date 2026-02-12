import { useMemo, useState, type FormEvent } from "react";
import { Navigate, Link, useSearchParams } from "react-router";
import { Card, Button, Input, Spinner } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import BlurText from "@/reactbits/blur-text";
import { useAuth } from "@/lib/auth/auth-context";
import { t } from "@/lib/i18n";
import * as api from "@/lib/api";
import s from "./reset-password.module.css";

export function ResetPasswordPage() {
  const { user, loading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!token) {
      setError(t("auth.reset_invalid"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.password_min"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("register.password_mismatch"));
      return;
    }

    setSubmitting(true);
    const res = await api.resetPassword(token, password);
    if (res.error) {
      setError(t("auth.reset_invalid"));
    } else {
      setDone(true);
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
            <p className={s.subtitle}>{t("auth.reset_subtitle")}</p>

            {!done ? (
              <form className={s.form} onSubmit={handleSubmit}>
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
                <Button variant="primary" type="submit" disabled={submitting}>
                  {submitting ? <Spinner size={16} /> : t("auth.reset_password")}
                </Button>
              </form>
            ) : (
              <p className={s.success}>{t("auth.reset_success")}</p>
            )}

            <p className={s.footer}>
              <Link to="/login">{t("auth.back_to_login")}</Link>
            </p>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
