import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { Shell } from "@/components/layout/shell";
import { Button, Badge, Spinner } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import { UserMode } from "@/components/prompt/user-mode";
import { StudyMode } from "@/components/prompt/study-mode";
import { ModeToggle, type ViewMode } from "@/components/prompt/mode-toggle";
import { Tips } from "@/components/prompt/tips";
import { CopyButton } from "@/components/prompt/copy-button";
import { useAuth } from "@/lib/auth/auth-context";
import { UpgradeGate } from "@/components/upgrade-gate";
import { t } from "@/lib/i18n";
import { ArrowLeft } from "lucide-react";
import * as api from "@/lib/api";
import type { Template } from "@/lib/api";
import s from "./template-detail.module.css";

export function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isParticipant } = useAuth();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [mode, setMode] = useState<ViewMode>("user");
  const [using, setUsing] = useState(false);

  useEffect(() => {
    if (!id || !isParticipant) return;
    api.getTemplate(id).then((res) => {
      if (res.data) {
        setTemplate(res.data.template);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    });
  }, [id, isParticipant]);

  async function handleUse() {
    if (!id) return;
    setUsing(true);
    const res = await api.useTemplate(id);
    if (res.data) {
      navigate(`/prompts/${res.data.prompt.id}`);
    }
    setUsing(false);
  }

  const copyText = template
    ? template.blocks
        .sort((a, b) => a.order - b.order)
        .map((b) => b.content)
        .join("\n\n")
    : "";

  if (!isParticipant) {
    return (
      <Shell>
        <UpgradeGate variant="page" message={t("upgrade.feature_templates")} />
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell>
        <div className={s.center}>
          <Spinner size={28} />
        </div>
      </Shell>
    );
  }

  if (notFound || !template) {
    return (
      <Shell>
        <div className={s.center}>
          <p className={s.notFoundTitle}>{t("prompt.not_found")}</p>
          <p className={s.notFoundSub}>{t("prompt.not_found_sub")}</p>
          <Button variant="secondary" onClick={() => navigate("/prompts/templates")}>
            {t("templates.back")}
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <FadeIn duration={0.5} direction="up" distance={16}>
        <div className={s.page}>
          <Link to="/prompts/templates" className={s.backLink}>
            <ArrowLeft size={16} />
            {t("templates.back")}
          </Link>

          <div className={s.header}>
            {template.template_card?.theme && (
              <p className={s.theme}>{t(`themes.${template.template_card.theme}`)}</p>
            )}
            <h1 className={s.title}>{template.template_card?.need ?? template.name}</h1>
            {template.template_card && <p className={s.lead}>{template.template_card.when}</p>}
            <p className={s.author}>
              {template.template_kind === "community"
                ? t("templates.by", { name: template.author_name ?? "" })
                : t("templates.kind_official")}
            </p>
          </div>

          {template.tags.length > 0 && (
            <div className={s.tagBar}>
              {template.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          )}

          <div className={s.actions}>
            <ModeToggle
              mode={mode}
              onChange={setMode}
              visibleModes={["user", "study"]}
            />
            <CopyButton text={copyText} />
          </div>

          {template.template_card && (
            <section className={s.fiche} aria-label={t("template_card.title")}>
              <div>
                <h2 className={s.ficheTitle}>{t("template_card.why")}</h2>
                <p className={s.ficheText}>{template.template_card.why}</p>
              </div>
              <div>
                <h2 className={s.ficheTitle}>{t("template_card.adapt")}</h2>
                <ul className={s.ficheList}>
                  {template.template_card.adapt.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <p className={s.ficheOrigin}>{t("template_card.original_name", { name: template.name })}</p>
            </section>
          )}

          {template.tips.length > 0 && <Tips items={template.tips} />}

          <div className={s.content}>
            {mode === "user" && <UserMode blocks={template.blocks} />}
            {mode === "study" && <StudyMode blocks={template.blocks} />}
          </div>

          <div className={s.footer}>
            <Button variant="cta" disabled={using} onClick={handleUse}>
              {using ? <Spinner size={16} /> : t("templates.use")}
            </Button>
          </div>
        </div>
      </FadeIn>
    </Shell>
  );
}
