import { useState, type FormEvent } from "react";
import { Navigate, Link } from "react-router";
import { Card, Button, Input, Spinner } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import BlurText from "@/reactbits/blur-text";
import { useAuth } from "@/lib/auth/auth-context";
import { t } from "@/lib/i18n";
import * as api from "@/lib/api";
import s from "./forgot-password.module.css";

export function ForgotPasswordPage() {
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
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
    setSubmitting(true);

    const res = await api.forgotPassword(email.trim());
    if (res.error) {
      setError(res.error.error);
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
            <p className={s.subtitle}>{t("auth.forgot_subtitle")}</p>

            {!done ? (
              <form className={s.form} onSubmit={handleSubmit}>
                <Input
                  label={t("auth.email")}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                {error && <p className={s.error}>{error}</p>}
                <Button variant="primary" type="submit" disabled={submitting}>
                  {submitting ? <Spinner size={16} /> : t("auth.send_reset_link")}
                </Button>
              </form>
            ) : (
              <p className={s.success}>{t("auth.forgot_sent")}</p>
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
