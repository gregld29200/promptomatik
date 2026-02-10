import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { Shell } from "@/components/layout/shell";
import { Button, Spinner } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import { ModeToggle, type ViewMode } from "@/components/prompt/mode-toggle";
import { UserMode } from "@/components/prompt/user-mode";
import { StudyMode } from "@/components/prompt/study-mode";
import { BlockEditor } from "@/components/prompt/block-editor";
import { CopyButton } from "@/components/prompt/copy-button";
import { ModelRecommendation } from "@/components/prompt/model-recommendation";
import { t } from "@/lib/i18n";
import * as api from "@/lib/api";
import type { Prompt, PromptBlock } from "@/lib/api";
import s from "./prompt-view.module.css";

export function PromptViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [mode, setMode] = useState<ViewMode>("user");

  useEffect(() => {
    if (!id) return;
    api.getPrompt(id).then((res) => {
      if (res.data) {
        setPrompt(res.data.prompt);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    });
  }, [id]);

  function handleBlocksChange(blocks: PromptBlock[]) {
    if (!prompt) return;
    setPrompt({ ...prompt, blocks });
  }

  const copyText = prompt
    ? prompt.blocks
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

  if (notFound || !prompt) {
    return (
      <Shell>
        <div className={s.center}>
          <p className={s.notFoundTitle}>{t("prompt.not_found")}</p>
          <p className={s.notFoundSub}>{t("prompt.not_found_sub")}</p>
          <Button variant="secondary" onClick={() => navigate("/dashboard")}>
            {t("prompt.back_to_dashboard")}
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <FadeIn duration={0.5} direction="up" distance={16}>
        <div className={s.page}>
          <div className={s.header}>
            <div>
              <h1 className={s.title}>{prompt.name || "Untitled"}</h1>
            </div>
            <div className={s.headerActions}>
              <CopyButton text={copyText} />
              <ModeToggle mode={mode} onChange={setMode} />
            </div>
          </div>

          {prompt.model_recommendation && (
            <ModelRecommendation
              model={prompt.model_recommendation}
              reason={prompt.model_recommendation_reason}
            />
          )}

          <div className={s.content}>
            {mode === "user" && <UserMode blocks={prompt.blocks} />}
            {mode === "study" && <StudyMode blocks={prompt.blocks} />}
            {mode === "edit" && (
              <BlockEditor
                promptId={prompt.id}
                blocks={prompt.blocks}
                onBlocksChange={handleBlocksChange}
              />
            )}
          </div>

          <div className={s.footer}>
            <Button variant="ghost" onClick={() => navigate("/dashboard")}>
              {t("common.back")}
            </Button>
          </div>
        </div>
      </FadeIn>
    </Shell>
  );
}
