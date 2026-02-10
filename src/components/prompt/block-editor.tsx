import { useState, useEffect } from "react";
import { BlockCard } from "./block-card";
import { AddBlockMenu } from "./add-block-menu";
import { useAutoSave, type SaveStatus } from "@/lib/hooks/use-auto-save";
import { t } from "@/lib/i18n";
import type { PromptBlock, Technique } from "@/lib/api";
import s from "./block-editor.module.css";

interface BlockEditorProps {
  promptId: string;
  blocks: PromptBlock[];
  onBlocksChange: (blocks: PromptBlock[]) => void;
}

const STATUS_LABELS: Record<SaveStatus, string> = {
  idle: "",
  saving: "common.saving",
  saved: "common.saved",
  error: "common.error",
};

export function BlockEditor({
  promptId,
  blocks,
  onBlocksChange,
}: BlockEditorProps) {
  const [localBlocks, setLocalBlocks] = useState(() =>
    [...blocks].sort((a, b) => a.order - b.order)
  );

  const saveStatus = useAutoSave(promptId, localBlocks);

  // Sync upward when local changes
  useEffect(() => {
    onBlocksChange(localBlocks);
  }, [localBlocks, onBlocksChange]);

  function updateBlock(index: number, content: string) {
    setLocalBlocks((prev) =>
      prev.map((b, i) => (i === index ? { ...b, content } : b))
    );
  }

  function moveUp(index: number) {
    if (index === 0) return;
    setLocalBlocks((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next.map((b, i) => ({ ...b, order: i + 1 }));
    });
  }

  function moveDown(index: number) {
    if (index === localBlocks.length - 1) return;
    setLocalBlocks((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next.map((b, i) => ({ ...b, order: i + 1 }));
    });
  }

  function deleteBlock(index: number) {
    setLocalBlocks((prev) =>
      prev.filter((_, i) => i !== index).map((b, i) => ({ ...b, order: i + 1 }))
    );
  }

  function addBlock(technique: Technique) {
    const newBlock: PromptBlock = {
      technique,
      content: "",
      annotation: "",
      order: localBlocks.length + 1,
    };
    setLocalBlocks((prev) => [...prev, newBlock]);
  }

  const statusKey = STATUS_LABELS[saveStatus];

  return (
    <div className={s.editor}>
      {statusKey && (
        <p
          className={`${s.status} ${saveStatus === "error" ? s.statusError : ""}`}
        >
          {t(statusKey)}
        </p>
      )}

      <div className={s.blocks}>
        {localBlocks.map((block, i) => (
          <BlockCard
            key={`${block.technique}-${i}`}
            block={block}
            index={i}
            total={localBlocks.length}
            onContentChange={(content) => updateBlock(i, content)}
            onMoveUp={() => moveUp(i)}
            onMoveDown={() => moveDown(i)}
            onDelete={() => deleteBlock(i)}
          />
        ))}
      </div>

      <AddBlockMenu onAdd={addBlock} />
    </div>
  );
}
