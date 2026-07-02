import { useRef, useState } from "react";
import { Play, Volume2 } from "lucide-react";
import type { AudioMode, AudioVoice } from "@/lib/api";
import { getLanguage, t } from "@/lib/i18n";
import s from "./voice-casting.module.css";

// Display-only FR transforms; the backend descriptor values are the EN labels.
const DESCRIPTORS_FR: Record<string, string> = {
  Bright: "Claire",
  Upbeat: "Enjouée",
  Informative: "Informative",
  Firm: "Ferme",
  Excitable: "Énergique",
  Youthful: "Jeune",
  Breezy: "Légère",
  "Easy-going": "Décontractée",
  Breathy: "Soufflée",
  Clear: "Nette",
  Smooth: "Douce",
  Gravelly: "Rauque",
  Soft: "Tendre",
  Even: "Régulière",
  Mature: "Mature",
  Forward: "Directe",
  Friendly: "Amicale",
  Casual: "Informelle",
  Gentle: "Délicate",
  Lively: "Vivante",
  Knowledgeable: "Experte",
  Warm: "Chaleureuse",
};

interface VoiceCastingProps {
  voices: AudioVoice[];
  mode: AudioMode;
  selected: Record<string, string>;
  onChange: (voices: Record<string, string>) => void;
}

function slotsForMode(mode: AudioMode) {
  return mode === "dialogue" ? ["Speaker 1", "Speaker 2"] : ["solo"];
}

function slotLabel(slot: string) {
  if (slot === "solo") return t("audio.narrator");
  const n = slot.match(/^Speaker\s+(\d+)$/i)?.[1];
  return n ? t("audio.speaker_n", { n }) : slot;
}

function descriptorLabel(descriptor: string) {
  return getLanguage() === "fr" ? (DESCRIPTORS_FR[descriptor] ?? descriptor) : descriptor;
}

export function VoiceCasting({ voices, mode, selected, onChange }: VoiceCastingProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [targetSlot, setTargetSlot] = useState(slotsForMode(mode)[0]);
  const slots = slotsForMode(mode);

  function selectVoice(name: string) {
    const slot = slots.includes(targetSlot) ? targetSlot : slots[0];
    onChange({ ...selected, [slot]: name });
    setTargetSlot(slots[(slots.indexOf(slot) + 1) % slots.length]);
  }

  async function preview(voice: AudioVoice) {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    const audio = new Audio(voice.previewUrl);
    audioRef.current = audio;
    setActivePreview(voice.name);
    audio.addEventListener("ended", () => setActivePreview(null), { once: true });
    audio.addEventListener("error", () => setActivePreview(null), { once: true });
    await audio.play().catch(() => setActivePreview(null));
  }

  return (
    <div className={s.casting}>
      <div className={s.slots} aria-label={t("audio.voice_slots_aria")}>
        {slots.map((slot) => {
          const selectedVoice = voices.find((voice) => voice.name === selected[slot]);
          return (
            <button
              key={slot}
              type="button"
              className={`${s.slot} ${targetSlot === slot ? s.slotActive : ""}`}
              onClick={() => setTargetSlot(slot)}
              aria-pressed={targetSlot === slot}
            >
              <span>{slotLabel(slot)}</span>
              <strong>{selectedVoice?.name ?? t("audio.voice_to_choose")}</strong>
              {selectedVoice && <small>{descriptorLabel(selectedVoice.descriptor)}</small>}
            </button>
          );
        })}
      </div>

      <div className={s.grid} aria-label={t("audio.voice_catalog_aria")}>
        {voices.map((voice) => {
          const isSelected = Object.values(selected).includes(voice.name);
          const isPreviewing = activePreview === voice.name;

          return (
            <article key={voice.name} className={`${s.card} ${isSelected ? s.selected : ""}`}>
              <button
                type="button"
                className={s.selectButton}
                onClick={() => selectVoice(voice.name)}
                aria-label={t("audio.voice_select_aria", { name: voice.name })}
              >
                <span className={s.name}>{voice.name}</span>
                <span className={s.descriptor}>{descriptorLabel(voice.descriptor)}</span>
                {isSelected && <span className={s.dot} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className={s.preview}
                onClick={() => void preview(voice)}
                aria-label={t("audio.voice_preview_aria", { name: voice.name })}
                title={t("audio.voice_preview_aria", { name: voice.name })}
              >
                {isPreviewing ? <Volume2 size={16} aria-hidden /> : <Play size={16} aria-hidden />}
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
