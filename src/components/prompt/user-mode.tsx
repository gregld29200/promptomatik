import type { PromptBlock } from "@/lib/api";
import s from "./user-mode.module.css";

interface UserModeProps {
  blocks: PromptBlock[];
}

export function UserMode({ blocks }: UserModeProps) {
  const sorted = [...blocks].sort((a, b) => a.order - b.order);
  const prose = sorted.map((b) => b.content).join("\n\n");

  return (
    <div className={s.prose}>
      {prose.split("\n\n").map((paragraph, i) => (
        <p key={i}>{paragraph}</p>
      ))}
    </div>
  );
}
