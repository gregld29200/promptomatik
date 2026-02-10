import { useState } from "react";
import { Button, Badge } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { Technique } from "@/lib/api";
import { Plus } from "lucide-react";
import s from "./add-block-menu.module.css";

const TECHNIQUES: Technique[] = [
  "role",
  "context",
  "examples",
  "constraints",
  "steps",
  "think_first",
];

interface AddBlockMenuProps {
  onAdd: (technique: Technique) => void;
}

export function AddBlockMenu({ onAdd }: AddBlockMenuProps) {
  const [open, setOpen] = useState(false);

  function handleSelect(technique: Technique) {
    onAdd(technique);
    setOpen(false);
  }

  return (
    <div className={s.wrapper}>
      {!open && (
        <Button
          variant="secondary"
          size="small"
          onClick={() => setOpen(true)}
          type="button"
        >
          <Plus size={14} /> {t("prompt.add_block")}
        </Button>
      )}
      {open && (
        <div className={s.menu}>
          {TECHNIQUES.map((tech) => (
            <button
              key={tech}
              type="button"
              className={s.option}
              onClick={() => handleSelect(tech)}
            >
              <Badge technique={tech}>{t(`techniques.${tech}`)}</Badge>
            </button>
          ))}
          <button
            type="button"
            className={s.cancel}
            onClick={() => setOpen(false)}
          >
            {t("common.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
