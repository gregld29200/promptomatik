import { Lightbulb } from "lucide-react";
import { t } from "@/lib/i18n";
import s from "./tips.module.css";

interface TipsProps {
  items: string[];
}

export function Tips({ items }: TipsProps) {
  if (items.length === 0) return null;

  return (
    <div className={s.container}>
      <div className={s.header}>
        <Lightbulb size={14} className={s.icon} />
        <span className={s.label}>{t("prompt.tips_title")}</span>
      </div>
      <ul className={s.list}>
        {items.map((tip, i) => (
          <li key={i} className={s.item}>{tip}</li>
        ))}
      </ul>
    </div>
  );
}
