import { Badge } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { PromptBlock, Technique } from "@/lib/api";
import { ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import s from "./block-card.module.css";

interface BlockCardProps {
  block: PromptBlock;
  index: number;
  total: number;
  onContentChange: (content: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

export function BlockCard({
  block,
  index,
  total,
  onContentChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: BlockCardProps) {
  return (
    <div
      className={s.card}
      style={{
        borderLeftColor: `var(--technique-${block.technique.replace("_", "-")})`,
      }}
    >
      <div className={s.header}>
        <Badge technique={block.technique as Technique}>
          {t(`techniques.${block.technique}`)}
        </Badge>
        <div className={s.actions}>
          <button
            type="button"
            className={s.iconBtn}
            onClick={onMoveUp}
            disabled={index === 0}
            title={t("prompt.move_up")}
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            className={s.iconBtn}
            onClick={onMoveDown}
            disabled={index === total - 1}
            title={t("prompt.move_down")}
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            className={`${s.iconBtn} ${s.danger}`}
            onClick={onDelete}
            title={t("prompt.delete_block")}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <textarea
        className={s.textarea}
        value={block.content}
        onChange={(e) => onContentChange(e.target.value)}
        placeholder={t("prompt.block_content")}
        rows={4}
      />
    </div>
  );
}
