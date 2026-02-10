import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router";
import { Shell } from "@/components/layout/shell";
import { Button, Card, Badge } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import BlurText from "@/reactbits/blur-text";
import { useAuth } from "@/lib/auth/auth-context";
import { t } from "@/lib/i18n";
import { FileText } from "lucide-react";
import * as api from "@/lib/api";
import type { Prompt, Technique } from "@/lib/api";
import s from "./dashboard.module.css";

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getPrompts().then((res) => {
      if (res.data) setPrompts(res.data.prompts);
      setLoaded(true);
    });
  }, []);

  return (
    <Shell>
      <div className={s.header}>
        <div>
          <BlurText
            text={t("dashboard.welcome", { name: user?.name ?? "" })}
            className={s.greeting}
            delay={60}
            animateBy="words"
            direction="top"
          />
          <FadeIn delay={0.3} duration={0.4} direction="up" distance={10}>
            <p className={s.greetingSub}>{t("dashboard.subtitle")}</p>
          </FadeIn>
        </div>
        <FadeIn delay={0.4} duration={0.4} direction="right" distance={16}>
          <Button variant="cta" onClick={() => navigate("/new")}>
            {t("dashboard.new_prompt")}
          </Button>
        </FadeIn>
      </div>

      {loaded && prompts.length === 0 && (
        <FadeIn delay={0.5} duration={0.6} direction="up" distance={20}>
          <div className={s.emptyState}>
            <FileText className={s.emptyIcon} strokeWidth={1.5} />
            <p className={s.emptyTitle}>{t("dashboard.empty_title")}</p>
            <p className={s.emptyText}>{t("dashboard.empty")}</p>
            <Button variant="secondary" onClick={() => navigate("/new")}>
              {t("dashboard.new_prompt")}
            </Button>
          </div>
        </FadeIn>
      )}

      {loaded && prompts.length > 0 && (
        <FadeIn delay={0.5} duration={0.6} direction="up" distance={20}>
          <div className={s.promptList}>
            {prompts.map((p) => (
              <Link key={p.id} to={`/prompt/${p.id}`} className={s.promptLink}>
                <Card variant="bordered" className={s.promptCard}>
                  <h3 className={s.promptName}>{p.name || "Untitled"}</h3>
                  <div className={s.promptTags}>
                    {p.blocks.slice(0, 3).map((b, i) => (
                      <Badge key={i} technique={b.technique as Technique}>
                        {t(`techniques.${b.technique}`)}
                      </Badge>
                    ))}
                  </div>
                  <p className={s.promptDate}>
                    {new Date(p.updated_at).toLocaleDateString()}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </FadeIn>
      )}
    </Shell>
  );
}
