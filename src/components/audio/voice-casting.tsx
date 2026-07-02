import { useRef, useState } from "react";
import { Play, Volume2 } from "lucide-react";
import type { AudioMode, AudioVoice } from "@/lib/api";
import s from "./voice-casting.module.css";

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
  if (slot === "solo") return "Narrateur";
  return slot.replace(/^Speaker\s+(\d+)$/i, "Locuteur $1");
}

function descriptorLabel(descriptor: string) {
  return DESCRIPTORS_FR[descriptor] ?? descriptor;
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
      <div className={s.slots} aria-label="Attribution des voix">
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
              <strong>{selectedVoice?.name ?? "À choisir"}</strong>
              {selectedVoice && <small>{descriptorLabel(selectedVoice.descriptor)}</small>}
            </button>
          );
        })}
      </div>

      <div className={s.grid} aria-label="Catalogue de voix">
        {voices.map((voice) => {
          const isSelected = Object.values(selected).includes(voice.name);
          const isPreviewing = activePreview === voice.name;

          return (
            <article key={voice.name} className={`${s.card} ${isSelected ? s.selected : ""}`}>
              <button
                type="button"
                className={s.selectButton}
                onClick={() => selectVoice(voice.name)}
                aria-label={`Choisir ${voice.name}`}
              >
                <span className={s.name}>{voice.name}</span>
                <span className={s.descriptor}>{descriptorLabel(voice.descriptor)}</span>
                {isSelected && <span className={s.dot} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className={s.preview}
                onClick={() => void preview(voice)}
                aria-label={`Écouter ${voice.name}`}
                title={`Écouter ${voice.name}`}
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
