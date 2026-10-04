import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { t } from "@/lib/i18n";
import { SUPPORTED_AUDIO_TAGS } from "@/lib/audio-script-rules";
import { tagLabel } from "./script-review";
import s from "./emotion-menu.module.css";

interface EmotionMenuProps {
  disabled?: boolean;
  onInsert: (tag: string) => void;
}

// Manual emotions, out of the way until asked for: one button that opens the
// list by name ("chuchote", "soupire") and inserts the tag at the cursor.
export function EmotionMenu({ disabled = false, onInsert }: EmotionMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={s.root} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={s.trigger}
        disabled={disabled}
        aria-label={t("audio.emotion_menu_aria")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus size={16} aria-hidden />
        {t("audio.emotion_menu")}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div id={panelId} className={s.panel} role="group" aria-label={t("audio.emotion_menu_hint")}>
          <p className={s.hint}>{t("audio.emotion_menu_hint")}</p>
          <div className={s.grid}>
            {SUPPORTED_AUDIO_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                title={tag}
                onClick={() => {
                  onInsert(tag);
                  setOpen(false);
                }}
              >
                {tagLabel(tag)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
