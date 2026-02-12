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
import { t } from "@/lib/i18n";
import { ArrowLeft } from "lucide-react";
import * as api from "@/lib/api";
import type { Template } from "@/lib/api";
import s from "./template-detail.module.css";

export function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [mode, setMode] = useState<ViewMode>("user");
  const [using, setUsing] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getTemplate(id).then((res) => {
      if (res.data) {
        setTemplate(res.data.template);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    });
  }, [id]);

  async function handleUse() {
    if (!id) return;
    setUsing(true);
    const res = await api.useTemplate(id);
    if (res.data) {
      navigate(`/prompt/${res.data.prompt.id}`);
    }
    setUsing(false);
  }

  const copyText = template
    ? template.blocks
        .sort((a, b) => a.order - b.order)
        .map((b) => b.content)
        .join("\n\n")
    : "";

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
          <Button variant="secondary" onClick={() => navigate("/templates")}>
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
          <Link to="/templates" className={s.backLink}>
            <ArrowLeft size={16} />
            {t("templates.back")}
          </Link>

          <div className={s.header}>
            <h1 className={s.title}>{template.name}</h1>
            <p className={s.author}>
              {t("templates.by", { name: template.author_name ?? "" })}
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
