import { useMemo, useState, type FormEvent } from "react";
import { Navigate, Link, useSearchParams } from "react-router";
import { Card, Button, Input, Spinner } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import BlurText from "@/reactbits/blur-text";
import { useAuth } from "@/lib/auth/auth-context";
import { t } from "@/lib/i18n";
import * as api from "@/lib/api";
import { isExternalReturnUrl, safeReturnUrl } from "../../shared/return-url";
import s from "./reset-password.module.css";

export function ResetPasswordPage() {
  const { user, loading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const next = safeReturnUrl(searchParams.get("next"));
  const loginPath = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
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
    return <Navigate to={loginPath} replace />;
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
      if (res.error.code === "RESET_TOKEN_EXPIRED") {
        setError(t("auth.reset_expired"));
      } else if (res.error.code === "RESET_TOKEN_USED") {
        setError(t("auth.reset_used"));
      } else {
        setError(t("auth.reset_invalid"));
      }
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
              text="TeachInspire"
              className={s.heading}
              delay={80}
              animateBy="letters"
              direction="top"
            />
            <p className={s.studioTag} translate="no">
              Studio
            </p>
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
              <>
                <p className={s.success}>{t("auth.reset_success")}</p>
                {next && isExternalReturnUrl(next) ? (
                  <a href={next} className={s.continueLink}>
                    {t("auth.reset_continue")}
                  </a>
                ) : (
                  <Link to={loginPath} className={s.continueLink}>
                    {t("auth.login")}
                  </Link>
                )}
              </>
            )}

            <p className={s.footer}>
              <Link to={loginPath}>{t("auth.back_to_login")}</Link>
            </p>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
