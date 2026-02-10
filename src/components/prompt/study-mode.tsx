import { Badge } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { PromptBlock, Technique } from "@/lib/api";
import s from "./study-mode.module.css";

interface StudyModeProps {
  blocks: PromptBlock[];
}

export function StudyMode({ blocks }: StudyModeProps) {
  const sorted = [...blocks].sort((a, b) => a.order - b.order);

  return (
    <div className={s.blocks}>
      {sorted.map((block, i) => (
        <div
          key={i}
          className={s.block}
          style={{
            borderLeftColor: `var(--technique-${block.technique.replace("_", "-")})`,
          }}
        >
          <div className={s.header}>
            <Badge technique={block.technique as Technique}>
              {t(`techniques.${block.technique}`)}
            </Badge>
          </div>
          <p className={s.content}>{block.content}</p>
          {block.annotation && (
            <p className={s.annotation}>{block.annotation}</p>
          )}
        </div>
      ))}
    </div>
  );
}
