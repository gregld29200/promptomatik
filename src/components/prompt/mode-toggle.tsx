import { t } from "@/lib/i18n";
import s from "./mode-toggle.module.css";

export type ViewMode = "user" | "study" | "edit";

interface ModeToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  visibleModes?: ViewMode[];
}

export function ModeToggle({ mode, onChange, visibleModes }: ModeToggleProps) {
  const allModes: { value: ViewMode; label: string }[] = [
    { value: "user", label: t("prompt.user_mode") },
    { value: "study", label: t("prompt.study_mode") },
    { value: "edit", label: t("prompt.edit_mode") },
  ];

  const modes = visibleModes
    ? allModes.filter((m) => visibleModes.includes(m.value))
    : allModes;

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
