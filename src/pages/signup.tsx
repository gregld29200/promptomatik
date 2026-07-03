import { useState, type FormEvent } from "react";
import { Navigate, Link } from "react-router";
import { Card, Button, Input, Spinner } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import BlurText from "@/reactbits/blur-text";
import { useAuth } from "@/lib/auth/auth-context";
import { SUPPORTED_LANGUAGES, t, useLanguage, type Language } from "@/lib/i18n";
import * as api from "@/lib/api";
import s from "./signup.module.css";

export function SignupPage() {
  const { user, loading: authLoading } = useAuth();
  const [lang, setLang] = useLanguage();
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
    return <Navigate to="/prompts" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const res = await api.signup(email.trim(), lang);
    if (res.error) {
      setError(
        res.error.status === 429
          ? t("signup.rate_limited")
          : res.error.status === 400
            ? t("signup.invalid_email")
            : t("common.error")
      );
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
            <p className={s.subtitle}>
              <strong>{t("signup.title")}</strong>
              <br />
              {t("signup.subtitle")}
            </p>

            {!done ? (
              <form className={s.form} onSubmit={handleSubmit}>
                <Input
                  label={t("signup.email_label")}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <div className={s.langRow}>
                  <span className={s.langLabel}>{t("signup.language_label")}</span>
                  {SUPPORTED_LANGUAGES.map((option: Language) => (
                    <button
                      key={option}
                      type="button"
                      className={`${s.langBtn} ${lang === option ? s.langBtnActive : ""}`}
                      onClick={() => setLang(option)}
                    >
                      {t(`common.lang_${option}`)}
                    </button>
                  ))}
                </div>
                <p className={s.consent}>{t("signup.consent")}</p>
                {error && <p className={s.error}>{error}</p>}
                <Button variant="cta" type="submit" disabled={submitting}>
                  {submitting ? <Spinner size={16} /> : t("signup.submit")}
                </Button>
              </form>
            ) : (
              <div className={s.success}>
                <p>
                  <strong>{t("signup.success_title")}</strong>
                </p>
                <p>{t("signup.success_body")}</p>
              </div>
            )}

            <p className={s.footer}>
              <Link to="/login">{t("signup.login_link")}</Link>
            </p>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
