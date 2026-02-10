import { t } from "@/lib/i18n";
import s from "./mode-toggle.module.css";

export type ViewMode = "user" | "study" | "edit";

interface ModeToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  const modes: { value: ViewMode; label: string }[] = [
    { value: "user", label: t("prompt.user_mode") },
    { value: "study", label: t("prompt.study_mode") },
    { value: "edit", label: t("prompt.edit_mode") },
  ];

  return (
    <div className={s.toggle}>
      {modes.map((m) => (
        <button
          key={m.value}
          type="button"
          className={`${s.button} ${mode === m.value ? s.active : ""}`}
          onClick={() => onChange(m.value)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
