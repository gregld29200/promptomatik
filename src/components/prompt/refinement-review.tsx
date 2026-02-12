import { Badge } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { PromptBlock, RefinementChange, Technique } from "@/lib/api";
import s from "./refinement-review.module.css";

interface RefinementReviewProps {
  blocks: PromptBlock[];
  changes: RefinementChange[];
}

function getChangeType(
  technique: Technique,
  changes: RefinementChange[]
): RefinementChange["type"] | "unchanged" {
  const change = changes.find((c) => c.technique === technique);
  return change?.type ?? "unchanged";
}

function getChangeReason(
  technique: Technique,
  changes: RefinementChange[]
): string | null {
  const change = changes.find((c) => c.technique === technique);
  return change?.reason ?? null;
}

const changeLabels: Record<RefinementChange["type"] | "unchanged", string> = {
  modified: "refinement.change_modified",
  added: "refinement.change_added",
  removed: "refinement.change_removed",
  unchanged: "refinement.change_unchanged",
};

export function RefinementReview({ blocks, changes }: RefinementReviewProps) {
  const sorted = [...blocks].sort((a, b) => a.order - b.order);

  // Include removed blocks from changes that aren't in the blocks array
  const removedTechniques = changes
    .filter((c) => c.type === "removed")
    .map((c) => c.technique);

  return (
    <div className={s.blocks}>
      {sorted.map((block, i) => {
        const changeType = getChangeType(block.technique, changes);
        const reason = getChangeReason(block.technique, changes);
        const blockClass = [s.block, s[changeType]].filter(Boolean).join(" ");

        return (
          <div
            key={i}
            className={blockClass}
            style={{
              borderLeftColor: `var(--technique-${block.technique.replace("_", "-")})`,
            }}
          >
            <div className={s.header}>
              <Badge technique={block.technique as Technique}>
                {t(`techniques.${block.technique}`)}
              </Badge>
              <span className={`${s.changeBadge} ${s[changeType]}`}>
                {t(changeLabels[changeType])}
              </span>
            </div>
            <p className={s.content}>{block.content}</p>
            {reason && <p className={s.reason}>{reason}</p>}
          </div>
        );
      })}
      {removedTechniques
        .filter((tech) => !sorted.some((b) => b.technique === tech))
        .map((tech) => {
          const reason = getChangeReason(tech, changes);
          return (
            <div
              key={`removed-${tech}`}
              className={`${s.block} ${s.removed}`}
              style={{
                borderLeftColor: `var(--technique-${tech.replace("_", "-")})`,
              }}
            >
              <div className={s.header}>
                <Badge technique={tech as Technique}>
                  {t(`techniques.${tech}`)}
                </Badge>
                <span className={`${s.changeBadge} ${s.removed}`}>
                  {t("refinement.change_removed")}
                </span>
              </div>
              <p className={s.content}>
                <em>{t("refinement.change_removed")}</em>
              </p>
              {reason && <p className={s.reason}>{reason}</p>}
            </div>
          );
        })}
    </div>
  );
}
