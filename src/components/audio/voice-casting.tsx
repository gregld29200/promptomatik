import { useRef, useState } from "react";
import { Play, Volume2 } from "lucide-react";
import type { AudioMode, AudioVoice, AudioVoiceGender, AudioVoiceTone } from "@/lib/api";
import { getLanguage, t, type Language } from "@/lib/i18n";
import s from "./voice-casting.module.css";

// Display-only transforms; the backend descriptor values are the EN labels.
const DESCRIPTORS: Record<Language, Record<string, string>> = {
  en: {},
  fr: {
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
  },
  es: {
    Bright: "Clara",
    Upbeat: "Animada",
    Informative: "Informativa",
    Firm: "Firme",
    Excitable: "Enérgica",
    Youthful: "Joven",
    Breezy: "Ligera",
    "Easy-going": "Relajada",
    Breathy: "Susurrada",
    Clear: "Nítida",
    Smooth: "Suave",
    Gravelly: "Ronca",
    Soft: "Tierna",
    Even: "Regular",
    Mature: "Madura",
    Forward: "Directa",
    Friendly: "Amable",
    Casual: "Informal",
    Gentle: "Delicada",
    Lively: "Vivaz",
    Knowledgeable: "Experta",
    Warm: "Cálida",
  },
};

const GENDER_FILTERS = ["all", "feminine", "masculine"] as const;
const TONE_FILTERS = ["all", "energetic", "warm", "composed"] as const;

type GenderFilter = (typeof GENDER_FILTERS)[number];
type ToneFilter = (typeof TONE_FILTERS)[number];

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
  return DESCRIPTORS[getLanguage()][descriptor] ?? descriptor;
}

function genderLabel(gender: AudioVoiceGender) {
  return gender === "feminine" ? t("audio.voice_feminine") : t("audio.voice_masculine");
}

function genderFilterLabel(filter: GenderFilter) {
  return filter === "all" ? t("audio.voice_filter_all") : genderLabel(filter);
}

function toneLabel(tone: AudioVoiceTone) {
  return t(`audio.voice_tone_${tone}`);
}

function toneFilterLabel(filter: ToneFilter) {
  return filter === "all" ? t("audio.voice_filter_all") : toneLabel(filter);
}

export function VoiceCasting({ voices, mode, selected, onChange }: VoiceCastingProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [targetSlot, setTargetSlot] = useState(slotsForMode(mode)[0]);
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");
  const [toneFilter, setToneFilter] = useState<ToneFilter>("all");
  const slots = slotsForMode(mode);
  // Feminine voices first, then masculine, each alphabetical by display name.
  const visibleVoices = voices
    .filter((voice) => genderFilter === "all" || voice.gender === genderFilter)
    .filter((voice) => toneFilter === "all" || voice.tone === toneFilter)
    .sort((a, b) =>
      a.gender === b.gender ? a.label.localeCompare(b.label) : a.gender === "feminine" ? -1 : 1
    );

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
              <strong>{selectedVoice?.label ?? t("audio.voice_to_choose")}</strong>
              {selectedVoice && (
                <small>
                  {genderLabel(selectedVoice.gender)} · {descriptorLabel(selectedVoice.descriptor)}
                </small>
              )}
            </button>
          );
        })}
      </div>

      <div className={s.filterRows}>
        <div className={s.filters} role="group" aria-labelledby="voice-filter-gender-label">
          <span id="voice-filter-gender-label" className={s.filterLabel}>
            {t("audio.voice_filter_gender")}
          </span>
          {GENDER_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`${s.filter} ${genderFilter === filter ? s.filterActive : ""}`}
              onClick={() => setGenderFilter(filter)}
              aria-pressed={genderFilter === filter}
            >
              {genderFilterLabel(filter)}
            </button>
          ))}
        </div>
        <div className={s.filters} role="group" aria-labelledby="voice-filter-tone-label">
          <span id="voice-filter-tone-label" className={s.filterLabel}>
            {t("audio.voice_filter_tone")}
          </span>
          {TONE_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`${s.filter} ${toneFilter === filter ? s.filterActive : ""}`}
              onClick={() => setToneFilter(filter)}
              aria-pressed={toneFilter === filter}
            >
              {toneFilterLabel(filter)}
            </button>
          ))}
        </div>
      </div>

      <div className={s.grid} aria-label={t("audio.voice_catalog_aria")}>
        {visibleVoices.map((voice) => {
          const isSelected = Object.values(selected).includes(voice.name);
          const isPreviewing = activePreview === voice.name;

          return (
            <article key={voice.name} className={`${s.card} ${isSelected ? s.selected : ""}`}>
              <button
                type="button"
                className={s.selectButton}
                onClick={() => selectVoice(voice.name)}
                aria-label={t("audio.voice_select_aria", { name: `${voice.label}, ${genderLabel(voice.gender)}` })}
              >
                <span className={s.name}>{voice.label}</span>
                <span className={s.descriptor}>
                  <span className={voice.gender === "feminine" ? s.feminine : s.masculine}>
                    {genderLabel(voice.gender)}
                  </span>{" "}
                  · {descriptorLabel(voice.descriptor)}
                </span>
                {isSelected && <span className={s.dot} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className={s.preview}
                onClick={() => void preview(voice)}
                aria-label={t("audio.voice_preview_aria", { name: voice.label })}
                title={t("audio.voice_preview_aria", { name: voice.label })}
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
