import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Pause, Play, RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui";
import { UpgradeGate } from "@/components/upgrade-gate";
import { t } from "@/lib/i18n";
import s from "./audio-teaser.module.css";

type AnswerState = "correct" | "incorrect" | null;
type BadgeTechnique = "role" | "context" | "examples";

interface TeaserClip {
  id: "fr" | "en" | "es";
  flag: string;
  level: "A2" | "B1" | "B2";
  technique: BadgeTechnique;
  audioSrc: string;
  correctChoice: string;
  choiceIds: string[];
}

const CLIPS: TeaserClip[] = [
  {
    id: "fr",
    flag: "🇫🇷",
    level: "B1",
    technique: "role",
    audioSrc: "/audio/teasers/brocante-b1-fr.mp3",
    correctChoice: "price",
    choiceIds: ["condition", "price", "colour"],
  },
  {
    id: "en",
    flag: "🇬🇧",
    level: "A2",
    technique: "context",
    audioSrc: "/audio/teasers/plants-a2-en.mp3",
    correctChoice: "herbs",
    choiceIds: ["cactus", "herbs", "flowers"],
  },
  {
    id: "es",
    flag: "🇪🇸",
    level: "B2",
    technique: "examples",
    audioSrc: "/audio/teasers/madrid-bees-b2-es.mp3",
    correctChoice: "rooftop",
    choiceIds: ["park", "rooftop", "country"],
  },
];

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

interface AudioTeaserCardProps {
  clip: TeaserClip;
  index: number;
  active: boolean;
  onActivate: (id: TeaserClip["id"]) => void;
  onStop: () => void;
  nextClipId?: TeaserClip["id"];
}

function AudioTeaserCard({ clip, index, active, onActivate, onStop, nextClipId }: AudioTeaserCardProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [answerState, setAnswerState] = useState<AnswerState>(null);
  const [audioError, setAudioError] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!active && audio && !audio.paused) audio.pause();
  }, [active]);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;

    if (!audio.paused) {
      audio.pause();
      return;
    }

    setAudioError(false);
    onActivate(clip.id);
    try {
      await audio.play();
    } catch {
      setAudioError(true);
    }
  }

  function updateProgress() {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  function answer(choiceId: string) {
    setSelectedChoice(choiceId);
    setAnswerState(choiceId === clip.correctChoice ? "correct" : "incorrect");
  }

  async function replay() {
    const audio = audioRef.current;
    if (!audio) return;
    setSelectedChoice(null);
    setAnswerState(null);
    setAudioError(false);
    audio.currentTime = 0;
    setCurrentTime(0);
    onActivate(clip.id);
    try {
      await audio.play();
    } catch {
      setAudioError(true);
    }
  }

  function focusNextClip() {
    if (!nextClipId) return;
    const nextButton = document.getElementById(`teaser-play-${nextClipId}`);
    nextButton?.scrollIntoView({ behavior: "smooth", block: "center" });
    nextButton?.focus({ preventScroll: true });
  }

  const cardState = answerState ?? (playing ? "playing" : "question");
  const choiceDisabled = answerState !== null;

  return (
    <article className={s.cardWrap} data-state={cardState}>
      {index === 0 && (
        <>
          <img
            src="/images/audio-teaser/audio-teaser-card-fragment.webp"
            className={s.cardFragment}
            alt=""
            aria-hidden="true"
            draggable="false"
          />
          <img
            src="/images/audio-teaser/audio-teaser-arrow.webp"
            className={s.playerArrow}
            alt=""
            aria-hidden="true"
            draggable="false"
          />
        </>
      )}

      <div className={s.card}>
        <div className={s.cardHeader}>
          <div className={s.languageLine}>
            <span className={s.flag} aria-hidden="true">{clip.flag}</span>
            <strong>{t(`audio.teaser_${clip.id}_language`)}</strong>
            <Badge technique={clip.technique}>{clip.level}</Badge>
          </div>
          <span className={s.goldDot} aria-hidden="true" />
        </div>

        <p className={s.format}>{t(`audio.teaser_${clip.id}_format`)}</p>
        <h2>{t(`audio.teaser_${clip.id}_title`)}</h2>
        <p className={s.subject}>{t(`audio.teaser_${clip.id}_subject`)}</p>

        <audio
          ref={audioRef}
          src={clip.audioSrc}
          preload="metadata"
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onTimeUpdate={updateProgress}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            onStop();
          }}
          onError={() => setAudioError(true)}
        />

        <div className={s.player}>
          <button
            id={`teaser-play-${clip.id}`}
            type="button"
            className={s.playButton}
            onClick={() => void togglePlayback()}
            aria-label={playing ? t("audio.player_pause") : t("audio.teaser_play", { title: t(`audio.teaser_${clip.id}_title`) })}
          >
            {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          </button>
          <span className={s.time}>{formatTime(currentTime)}</span>
          <input
            className={s.progress}
            type="range"
            min="0"
            max={duration || 1}
            step="0.01"
            value={Math.min(currentTime, duration || 1)}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label={t("audio.teaser_progress", { title: t(`audio.teaser_${clip.id}_title`) })}
            style={{ "--progress": `${duration ? (currentTime / duration) * 100 : 0}%` } as CSSProperties}
          />
          <span className={s.time}>{formatTime(duration)}</span>
        </div>

        <div className={s.questionSlot}>
          <fieldset className={s.question}>
            <legend>
              <span className={s.questionLabel}>{t(`audio.teaser_${clip.id}_question_label`)}</span>
              <span className={s.instruction}>{t(`audio.teaser_${clip.id}_instruction`)}</span>
              <strong>{t(`audio.teaser_${clip.id}_question`)}</strong>
            </legend>
            <div className={s.choices}>
              {clip.choiceIds.map((choiceId) => {
                const selected = selectedChoice === choiceId;
                const correct = selected && answerState === "correct";
                const incorrect = selected && answerState === "incorrect";
                return (
                  <label
                    key={choiceId}
                    className={`${s.choice} ${correct ? s.choiceCorrect : ""} ${incorrect ? s.choiceIncorrect : ""}`}
                  >
                    <input
                      type="radio"
                      name={`teaser-${clip.id}`}
                      value={choiceId}
                      checked={selected}
                      disabled={choiceDisabled}
                      onChange={() => answer(choiceId)}
                    />
                    <span>{t(`audio.teaser_${clip.id}_choice_${choiceId}`)}</span>
                    {correct && <Check size={18} aria-hidden="true" />}
                    {incorrect && <X size={18} aria-hidden="true" />}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className={s.feedback} aria-live="polite">
            {answerState === "correct" && (
              <div className={s.feedbackCorrect}>
                <span className={s.celebration} aria-hidden="true"><Check size={18} /></span>
                <p>{t("audio.teaser_correct")}</p>
                {nextClipId && (
                  <button type="button" onClick={focusNextClip}>{t("audio.teaser_next")}</button>
                )}
              </div>
            )}
            {answerState === "incorrect" && (
              <div className={s.feedbackIncorrect}>
                <X size={18} aria-hidden="true" />
                <p>{t("audio.teaser_incorrect")}</p>
                <button type="button" onClick={() => void replay()}>
                  <RotateCcw size={16} aria-hidden="true" />
                  {t("audio.teaser_replay")}
                </button>
              </div>
            )}
            {audioError && <p className={s.audioError}>{t("audio.teaser_audio_error")}</p>}
          </div>
        </div>
      </div>
    </article>
  );
}

export function AudioTeaser() {
  const [activeClip, setActiveClip] = useState<TeaserClip["id"] | null>(null);

  return (
    <div className={s.teaser}>
      <div className={s.upgradeBanner}>
        <UpgradeGate variant="conclusion" message={t("audio.locked")} />
      </div>

      <header className={s.teaserHeader}>
        <img
          src="/images/audio-teaser/audio-teaser-heading-paper.webp"
          className={s.headingPaper}
          alt=""
          aria-hidden="true"
          draggable="false"
        />
        <div className={s.headingContent}>
          <p className={s.eyebrow}>{t("audio.teaser_eyebrow")}</p>
          <h1>{t("audio.teaser_title")}</h1>
          <p>{t("audio.teaser_intro")}</p>
        </div>
      </header>

      <div className={s.cards}>
        {CLIPS.map((clip, index) => (
          <AudioTeaserCard
            key={clip.id}
            clip={clip}
            index={index}
            active={activeClip === clip.id}
            onActivate={setActiveClip}
            onStop={() => setActiveClip(null)}
            nextClipId={CLIPS[index + 1]?.id}
          />
        ))}
      </div>
    </div>
  );
}
