import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Download, Pause, Play, RotateCcw } from "lucide-react";
import type { AudioJob } from "@/lib/api";
import s from "./waveform-player.module.css";

interface WaveformPlayerProps {
  job: AudioJob;
  selectedBlock: number | null;
  onSelectBlock: (idx: number | null) => void;
  onRegenerate: (idx: number) => void;
  regenerating: boolean;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function WaveformPlayer({
  job,
  selectedBlock,
  onSelectBlock,
  onRegenerate,
  regenerating,
}: WaveformPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(job.actualSeconds ?? 0);
  const peaks = job.waveform?.peaks ?? [];
  const blocks = job.waveform?.blocks ?? [];

  const selected = useMemo(
    () => blocks.find((block) => block.idx === selectedBlock) ?? null,
    [blocks, selectedBlock],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => setDuration(audio.duration || job.actualSeconds || 0);
    const onEnded = () => setPlaying(false);

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnded);
    };
  }, [job.actualSeconds]);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }

    await audio.play();
    setPlaying(true);
  }

  function seek(event: MouseEvent<SVGSVGElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const nextTime = ((event.clientX - rect.left) / rect.width) * duration;
    audio.currentTime = Math.max(0, Math.min(duration, nextTime));
    setCurrentTime(audio.currentTime);
  }

  return (
    <section className={s.player} aria-label="Lecteur audio">
      {job.downloads?.mp3 && <audio ref={audioRef} src={job.downloads.mp3} preload="metadata" />}

      <div className={s.controls}>
        <button
          type="button"
          className={s.play}
          onClick={() => void togglePlayback()}
          aria-label={playing ? "Mettre en pause" : "Lire"}
        >
          {playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
        </button>
        <div className={s.time}>
          {formatTime(currentTime)} / {formatTime(duration || job.actualSeconds || 0)}
        </div>
        <div className={s.downloads}>
          {job.downloads?.mp3 && (
            <a href={job.downloads.mp3} download aria-label="Télécharger MP3">
              <Download size={16} aria-hidden /> MP3
            </a>
          )}
          {job.downloads?.wav && (
            <a href={job.downloads.wav} download aria-label="Télécharger WAV">
              WAV
            </a>
          )}
          {job.downloads?.transcript && (
            <a href={job.downloads.transcript} download aria-label="Télécharger le script">
              TXT
            </a>
          )}
        </div>
      </div>

      <div className={s.waveWrap}>
        <svg
          className={s.wave}
          viewBox="0 0 1000 180"
          preserveAspectRatio="none"
          role="img"
          aria-label="Forme d'onde avec limites de blocs"
          onClick={seek}
        >
          <rect x="0" y="0" width="1000" height="180" rx="8" className={s.waveBg} />
          {peaks.map((peak, index) => {
            const x = (index / Math.max(1, peaks.length - 1)) * 1000;
            const height = Math.max(4, peak * 136);
            return (
              <rect
                key={index}
                x={x}
                y={90 - height / 2}
                width={3.2}
                height={height}
                rx={2}
                className={s.peak}
              />
            );
          })}
          {blocks.map((block) => {
            const x = duration ? (block.startSeconds / duration) * 1000 : 0;
            const width = duration
              ? Math.max(12, ((block.endSeconds - block.startSeconds) / duration) * 1000)
              : 0;
            const isSelected = block.idx === selectedBlock;
            return (
              <rect
                key={block.idx}
                x={x}
                y={8}
                width={width}
                height={164}
                rx={6}
                className={isSelected ? s.blockSelected : s.blockRange}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectBlock(isSelected ? null : block.idx);
                }}
              />
            );
          })}
          <line
            x1={duration ? (currentTime / duration) * 1000 : 0}
            x2={duration ? (currentTime / duration) * 1000 : 0}
            y1="12"
            y2="168"
            className={s.playhead}
          />
        </svg>
      </div>

      {selected && (
        <div className={s.selection}>
          <div>
            <strong>Bloc {selected.idx + 1}</strong>
            <span>{formatTime(selected.durationSeconds)} de quota estimé</span>
          </div>
          <button
            type="button"
            onClick={() => onRegenerate(selected.idx)}
            disabled={regenerating}
            aria-label={`Régénérer le bloc ${selected.idx + 1}`}
          >
            <RotateCcw size={16} aria-hidden />
            Régénérer ce bloc
          </button>
        </div>
      )}
    </section>
  );
}
