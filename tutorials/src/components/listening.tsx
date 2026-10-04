import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CompareTake, Turn } from "../studio-audio/data";
import { BODY, C, DISPLAY } from "../theme";
import { Halftone, Tape, TornPaper, WaveScrap } from "./collage";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const SPEAKER_COLORS: Record<string, string> = { Chloé: C.terracotta, Yanis: C.sageDeep };

function fade(frame: number, duration: number) {
  return interpolate(frame, [0, 8, duration - 12, duration], [0, 1, 1, 0], clamp);
}

function seconds(value: number) {
  return `${value.toFixed(1).replace(".", ",")} s`;
}

// The take, heard before anything is explained: its lines appear as they
// are spoken, over the waveform of what plays.
export function ResultCard({ duration, audioFrom, turns, peaks, takeSeconds, voices }: {
  duration: number;
  audioFrom: number;
  turns: Turn[];
  peaks: number[];
  takeSeconds: number;
  voices: Record<string, string>;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = fade(frame, duration);
  const heard = turns[turns.length - 1].end + 0.3;
  const time = (frame - audioFrom) / fps;
  const shown = peaks.slice(0, Math.max(1, Math.round((peaks.length * heard) / takeSeconds)));
  const current = turns.reduce((found, turn, index) => (time >= turn.start - 0.15 ? index : found), 0);
  const turn = turns[current];
  const enter = spring({ frame: frame - Math.max(0, Math.round((turn.start - 0.15) * fps) + audioFrom), fps, config: { damping: 18 } });
  const head = spring({ frame, fps, config: { damping: 20 } });
  return (
    <AbsoluteFill style={{ background: C.cream, opacity }}>
      <Halftone id="result-dots" width={700} height={560} style={{ right: -160, top: -160, opacity: 0.45 }} />
      <div style={{ position: "absolute", left: 160, top: 120, opacity: head }}>
        <div style={{ fontFamily: BODY, fontSize: 26, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: C.terracotta }}>Écoutez le résultat</div>
        <div style={{ marginTop: 12, fontFamily: DISPLAY, fontWeight: 600, fontSize: 68, color: C.ink }}>Chloé et Yanis · niveau B1</div>
      </div>
      <div style={{ position: "absolute", right: 160, top: 150, display: "flex", gap: 16, opacity: head }}>
        {Object.entries(voices).map(([name, voice]) => (
          <div key={name} style={{ padding: "12px 22px", border: `2px solid ${C.sand}`, borderRadius: 6, background: C.paper, fontFamily: BODY, fontSize: 26 }}>
            <span style={{ fontWeight: 700, color: SPEAKER_COLORS[name] ?? C.ink }}>{name}</span>
            <span style={{ color: C.sageDeep }}> · voix {voice}</span>
          </div>
        ))}
      </div>
      {current > 0 && (
        <div style={{ position: "absolute", left: 160, top: 330, width: 1500, fontFamily: DISPLAY, fontSize: 38, lineHeight: 1.3, color: C.ink, opacity: 0.32 }}>
          {turns[current - 1].text}
        </div>
      )}
      <div style={{ position: "absolute", left: 160, top: 430, width: 1560, opacity: time > -0.4 ? enter : 0, transform: `translateY(${(1 - enter) * 26}px)` }}>
        <div style={{ fontFamily: BODY, fontSize: 28, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: SPEAKER_COLORS[turn.speaker] ?? C.ink }}>{turn.speaker}</div>
        <div style={{ marginTop: 12, fontFamily: DISPLAY, fontWeight: 500, fontSize: 64, lineHeight: 1.18, color: C.ink }}>{turn.text}</div>
      </div>
      <TornPaper width={1600} height={170} color={C.ink} seed={91} torn={{ top: 6, bottom: 4 }} style={{ left: 160, top: 790 }}>
        <div style={{ position: "absolute", left: 48, top: 35 }}>
          <WaveScrap width={1360} height={100} peaks={shown} color="rgba(253, 252, 249, 0.28)" playedColor={C.gold} played={Math.max(0, time) / heard} gap={3} />
        </div>
        <div style={{ position: "absolute", right: 40, top: 60, fontFamily: BODY, fontSize: 30, fontWeight: 600, color: C.paper }}>
          0:{String(Math.max(0, Math.min(Math.floor(time), Math.floor(heard)))).padStart(2, "0")}
        </div>
      </TornPaper>
      <Tape width={150} rotate={-6} style={{ left: 120, top: 772 }} />
    </AbsoluteFill>
  );
}

// The same line at A1 then at B1: the bars are as long as the takes.
export function CompareCard({ duration, starts, takes, line }: { duration: number; starts: number[]; takes: CompareTake[]; line: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = fade(frame, duration);
  const head = spring({ frame, fps, config: { damping: 20 } });
  const longest = Math.max(...takes.map((take) => take.seconds));
  const MAX_BAR = 1180;
  return (
    <AbsoluteFill style={{ background: C.cream, opacity }}>
      <Halftone id="compare-dots" width={640} height={520} style={{ left: -180, bottom: -200, opacity: 0.45 }} />
      <div style={{ position: "absolute", left: 160, top: 110, width: 1600, opacity: head }}>
        <div style={{ fontFamily: BODY, fontSize: 26, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: C.terracotta }}>Même réplique, deux niveaux</div>
        <div style={{ marginTop: 18, fontFamily: DISPLAY, fontStyle: "italic", fontSize: 46, lineHeight: 1.3, color: C.ink }}>« {line} »</div>
      </div>
      {takes.map((take, index) => {
        const start = starts[index];
        const frames = Math.round(take.seconds * fps);
        const playing = frame >= start && frame < start + frames;
        const played = Math.min(1, Math.max(0, (frame - start) / frames));
        const done = frame >= start + frames;
        const emphasis = playing ? 1 : done ? 0.85 : 0.45;
        const appear = spring({ frame: frame - 6 - index * 6, fps, config: { damping: 18 } });
        const [level, ...rest] = take.label.split(" · ");
        const width = (take.seconds / longest) * MAX_BAR;
        return (
          <div key={take.id} style={{ position: "absolute", left: 160, top: 390 + index * 250, display: "flex", alignItems: "center", gap: 48, opacity: appear * emphasis, transform: `translateY(${(1 - appear) * 30}px)` }}>
            <TornPaper width={210} height={170} color={index === 0 ? C.goldSoft : C.sand} seed={60 + index} style={{ position: "relative" }}>
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", alignContent: "center", gap: 4 }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 76, lineHeight: 1, color: C.ink }}>{level}</div>
                <div style={{ fontFamily: BODY, fontSize: 21, fontWeight: 600, color: C.inkSoft, textAlign: "center", padding: "0 12px" }}>{rest.join(" · ")}</div>
              </div>
            </TornPaper>
            <div style={{ width, position: "relative" }}>
              <WaveScrap width={width} height={120} peaks={take.peaks} color="rgba(19, 32, 56, 0.2)" playedColor={C.ink} played={played} gap={3} />
              {playing && <div style={{ position: "absolute", left: played * width, top: -10, width: 4, height: 140, borderRadius: 2, background: C.terracotta }} />}
            </div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 56, color: C.ink, opacity: done ? 1 : 0.25, minWidth: 170 }}>{seconds(take.seconds)}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
