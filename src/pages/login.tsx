import { Card, Button, Input } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import BlurText from "@/reactbits/blur-text";
import { t } from "@/lib/i18n";
import s from "./login.module.css";

export function LoginPage() {
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
              <form
                className={s.form}
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
                <Button variant="primary" type="submit" className={s.submitButton}>
                  {t("auth.login")}
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
