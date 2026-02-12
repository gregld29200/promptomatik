import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { Shell } from "@/components/layout/shell";
import { Button, Badge, Spinner } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import { ModeToggle, type ViewMode } from "@/components/prompt/mode-toggle";
import { UserMode } from "@/components/prompt/user-mode";
import { StudyMode } from "@/components/prompt/study-mode";
import { BlockEditor } from "@/components/prompt/block-editor";
import { CopyButton } from "@/components/prompt/copy-button";
import { Tips } from "@/components/prompt/tips";
import { RefinementFlow } from "@/components/prompt/refinement-flow";
import { t, getLanguage } from "@/lib/i18n";
import { useAuth } from "@/lib/auth/auth-context";
import { Copy, Trash2, X, Pencil } from "lucide-react";
import * as api from "@/lib/api";
import type { Prompt, PromptBlock } from "@/lib/api";
import s from "./prompt-view.module.css";

export function PromptViewPage() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [mode, setMode] = useState<ViewMode>("user");
  const [refining, setRefining] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [submittingTemplate, setSubmittingTemplate] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [templateActionLoading, setTemplateActionLoading] = useState<"publish" | "unpublish" | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    api.getPrompt(id).then((res) => {
      if (res.data) {
        setPrompt(res.data.prompt);
        setNameValue(res.data.prompt.name);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  function handleBlocksChange(blocks: PromptBlock[]) {
    if (!prompt) return;
    setPrompt({ ...prompt, blocks });
  }

  async function saveName() {
    if (!prompt || !id) return;
    const trimmed = nameValue.trim();
    if (trimmed === prompt.name) {
      setEditingName(false);
      return;
    }
    const res = await api.updatePrompt(id, { name: trimmed });
    if (res.data?.prompt) {
      setPrompt(res.data.prompt);
      setNameValue(res.data.prompt.name);
    }
    setEditingName(false);
  }

  function handleNameKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveName();
    } else if (e.key === "Escape") {
      setNameValue(prompt?.name ?? "");
      setEditingName(false);
    }
  }

  async function addTag() {
    if (!prompt || !id) return;
    const tag = tagInput.trim();
    if (!tag || prompt.tags.includes(tag)) {
      setTagInput("");
      return;
    }
    const newTags = [...prompt.tags, tag];
    const res = await api.updatePrompt(id, { tags: newTags });
    if (res.data?.prompt) setPrompt(res.data.prompt);
    setTagInput("");
  }

  async function removeTag(tag: string) {
    if (!prompt || !id) return;
    const newTags = prompt.tags.filter((t) => t !== tag);
    const res = await api.updatePrompt(id, { tags: newTags });
    if (res.data?.prompt) setPrompt(res.data.prompt);
  }

  function handleTagKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  }

  async function handleDelete() {
    if (!id) return;
    if (!window.confirm(t("prompt.delete_confirm"))) return;
    const res = await api.deletePrompt(id);
    if (res.data) navigate("/dashboard");
  }

  async function handleDuplicate() {
    if (!id) return;
    const res = await api.duplicatePrompt(id);
    if (res.data) navigate(`/prompt/${res.data.prompt.id}`);
  }

  async function handleSubmitTemplate() {
    if (!id) return;
    setSubmittingTemplate(true);
    setSubmitMessage(null);

    const res = await api.submitPromptTemplate(id);
    if (res.data?.prompt) {
      setPrompt(res.data.prompt);
      setSubmitMessage(t("prompt.submit_success"));
    } else if (res.error) {
      setSubmitMessage(res.error.error);
    }

    setSubmittingTemplate(false);
  }

  async function handlePublishOfficialTemplate() {
    if (!id) return;
    setTemplateActionLoading("publish");
    setSubmitMessage(null);
    const res = await api.publishTemplate(id);
    if (res.data) {
      const refreshed = await api.getPrompt(id);
      if (refreshed.data?.prompt) {
        setPrompt(refreshed.data.prompt);
      }
      setSubmitMessage(t("prompt.publish_success"));
    } else if (res.error) {
      setSubmitMessage(res.error.error);
    }
    setTemplateActionLoading(null);
  }

  async function handleUnpublishOfficialTemplate() {
    if (!id) return;
    setTemplateActionLoading("unpublish");
    setSubmitMessage(null);
    const res = await api.unpublishTemplate(id);
    if (res.data) {
      const refreshed = await api.getPrompt(id);
      if (refreshed.data?.prompt) {
        setPrompt(refreshed.data.prompt);
      }
      setSubmitMessage(t("prompt.unpublish_success"));
    } else if (res.error) {
      setSubmitMessage(res.error.error);
    }
    setTemplateActionLoading(null);
  }

  const copyText = prompt
    ? prompt.blocks
        .sort((a, b) => a.order - b.order)
        .map((b) => b.content)
        .join("\n\n")
    : "";
  const canSubmitCommunity = !!prompt && prompt.template_status !== "pending" && !prompt.is_template;
  const isAdmin = user?.role === "admin";
  const submitBtnLabel = prompt?.template_status === "pending"
    ? t("prompt.pending_review")
    : prompt?.template_status === "rejected"
      ? t("prompt.resubmit_community")
      : t("prompt.submit_community");

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
            <div className={s.titleArea}>
              {editingName ? (
                <input
                  ref={nameInputRef}
                  type="text"
                  className={s.titleInput}
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onBlur={saveName}
                  onKeyDown={handleNameKeyDown}
                  placeholder={t("prompt.name_placeholder")}
                />
              ) : (
                <button
                  type="button"
                  className={s.titleButton}
                  onClick={() => setEditingName(true)}
                  title={t("prompt.edit_name")}
                >
                  <h1 className={s.title}>{prompt.name || "Untitled"}</h1>
                  <Pencil size={14} className={s.titleEditIcon} />
                </button>
              )}
            </div>
            {!refining && (
              <div className={s.headerActions}>
                {isAdmin && !prompt.is_template && (
                  <Button
                    variant="cta"
                    onClick={handlePublishOfficialTemplate}
                    disabled={templateActionLoading !== null}
                  >
                    {templateActionLoading === "publish" ? <Spinner size={14} /> : t("prompt.publish_official")}
                  </Button>
                )}
                {isAdmin && prompt.is_template && (
                  <Button
                    variant="secondary"
                    onClick={handleUnpublishOfficialTemplate}
                    disabled={templateActionLoading !== null}
                  >
                    {templateActionLoading === "unpublish" ? <Spinner size={14} /> : t("prompt.unpublish_official")}
                  </Button>
                )}
                <Button variant="ghost" onClick={handleDuplicate}>
                  <Copy size={14} />
                  <span>{t("prompt.duplicate")}</span>
                </Button>
                <Button variant="ghost" className={s.dangerBtn} onClick={handleDelete}>
                  <Trash2 size={14} />
                  <span>{t("prompt.delete")}</span>
                </Button>
                <CopyButton text={copyText} />
                <ModeToggle mode={mode} onChange={setMode} />
              </div>
            )}
          </div>

          <div className={s.tagBar}>
            {prompt.tags.map((tag) => (
              <span key={tag} className={s.tag}>
                <Badge>{tag}</Badge>
                <button
                  type="button"
                  className={s.tagRemove}
                  onClick={() => removeTag(tag)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              type="text"
              className={s.tagInput}
              placeholder={t("prompt.add_tag")}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => { if (tagInput.trim()) addTag(); }}
            />
          </div>

          {prompt.tips.length > 0 && <Tips items={prompt.tips} />}

          <div className={s.content}>
            {refining ? (
              <RefinementFlow
                promptId={prompt.id}
                language={getLanguage()}
                onAccept={async (blocks, tips) => {
                  if (!id) return;
                  const res = await api.updatePrompt(id, {
                    blocks,
                    tips,
                  });
                  if (res.data?.prompt) {
                    setPrompt(res.data.prompt);
                  }
                  setRefining(false);
                }}
                onDiscard={() => setRefining(false)}
              />
            ) : (
              <>
                {mode === "user" && <UserMode blocks={prompt.blocks} />}
                {mode === "study" && <StudyMode blocks={prompt.blocks} />}
                {mode === "edit" && (
                  <BlockEditor
                    promptId={prompt.id}
                    blocks={prompt.blocks}
                    onBlocksChange={handleBlocksChange}
                  />
                )}
              </>
            )}
          </div>

          <div className={s.footer}>
            <div className={s.footerLeft}>
              <Button variant="ghost" onClick={() => navigate("/dashboard")}>
                {t("common.back")}
              </Button>
              {!prompt.is_template && !isAdmin && (
                <Button
                  variant="secondary"
                  onClick={handleSubmitTemplate}
                  disabled={!canSubmitCommunity || submittingTemplate}
                >
                  {submittingTemplate ? <Spinner size={14} /> : submitBtnLabel}
                </Button>
              )}
            </div>
            <div className={s.footerRight}>
              {!refining && (
                <Button
                  variant="ghost"
                  className={s.refineBtn}
                  onClick={() => setRefining(true)}
                >
                  {t("prompt.result_not_good")}
                </Button>
              )}
            </div>
          </div>
          {submitMessage && (
            <p className={s.submitMessage}>{submitMessage}</p>
          )}
        </div>
      </FadeIn>
    </Shell>
  );
}
