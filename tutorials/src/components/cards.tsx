import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Chapter } from "../studio-audio/script";
import type { Cut } from "../studio-audio/timeline";
import { BODY, C, DISPLAY } from "../theme";
import { Arrow, Halftone, Tape, TornPaper, WaveScrap } from "./collage";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** In over `fadeIn` frames, out over the last `fadeOut`, revealing the stage. */
export function useCardFade(duration: number, fadeIn = 8, fadeOut = 12) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, fadeIn, duration - fadeOut, duration], [0, 1, 1, 0], clamp);
  const scale = interpolate(frame, [duration - fadeOut, duration], [1, 1.035], clamp);
  return { frame, opacity, scale };
}

const KICKER = {
  fontFamily: BODY,
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: C.terracotta,
} as const;

// A calm, fixed waveform for the collage scraps.
const SCRAP_PEAKS = Array.from({ length: 34 }, (_, i) => 0.25 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45)));

export function TitleCard({ duration, cut }: { duration: number; cut: Cut }) {
  const { fps } = useVideoConfig();
  const { frame, opacity, scale } = useCardFade(duration, 1, 14);
  const strip = spring({ frame: frame - 2, fps, config: { damping: 18, stiffness: 120 } });
  const text = spring({ frame: frame - 12, fps, config: { damping: 20 } });
  const tape = spring({ frame: frame - 18, fps, config: { damping: 12, stiffness: 160 } });
  const scrap = spring({ frame: frame - 22, fps, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ background: C.cream, opacity, transform: `scale(${scale})` }}>
      <Halftone id="title-dots" width={760} height={620} style={{ right: -120, top: -140, opacity: 0.55 }} />
      <div style={{ position: "absolute", left: 236, top: 250, ...KICKER, opacity: text }}>
        {cut === "module" ? "TeachInspire Studio · Module 5 · Vidéo 1" : "TeachInspire Studio · Tutoriel"}
      </div>
      <TornPaper
        width={1260}
        height={330}
        color={C.ink}
        seed={7}
        torn={{ top: 6, bottom: 7, left: 2, right: 9 }}
        style={{ left: 200, top: 320, transform: `translateX(${(1 - strip) * -1500}px) rotate(-2.2deg)` }}
      >
        <div style={{ position: "absolute", left: 64, top: 46, opacity: text, transform: `translateY(${(1 - text) * 18}px)` }}>
          <div style={{ fontFamily: DISPLAY, fontStyle: "italic", fontWeight: 400, fontSize: 64, color: C.goldSoft, lineHeight: 1 }}>Prise en main du</div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 156, color: C.paper, lineHeight: 1.08, letterSpacing: "-0.01em" }}>Studio audio</div>
        </div>
      </TornPaper>
      <Tape width={190} rotate={-14} style={{ left: 168, top: 300, opacity: tape, transform: `rotate(-14deg) scale(${1.3 - 0.3 * tape})` }} />
      <TornPaper
        width={330}
        height={200}
        color={C.sage}
        seed={21}
        style={{ left: 1330, top: 560, opacity: scrap, transform: `rotate(${6 - 2 * scrap}deg) translateY(${(1 - scrap) * 40}px)` }}
      >
        <div style={{ position: "absolute", left: 36, top: 50 }}>
          <WaveScrap width={258} height={100} peaks={SCRAP_PEAKS} color={C.paper} gap={3} />
        </div>
      </TornPaper>
      <Tape width={120} rotate={10} style={{ left: 1560, top: 538, opacity: scrap }} />
      <div style={{ position: "absolute", left: 236, top: 720, fontFamily: BODY, fontSize: 34, color: C.inkSoft, opacity: text }}>
        Du texte à l'écoute prête pour la classe.
      </div>
    </AbsoluteFill>
  );
}

const CHAPTER_COUNT = 8;

export function ChapterCard({ duration, chapter }: { duration: number; chapter: Chapter }) {
  const { fps } = useVideoConfig();
  const { frame, opacity, scale } = useCardFade(duration, 7, 12);
  const paper = spring({ frame, fps, config: { damping: 16, stiffness: 140 } });
  const title = spring({ frame: frame - 7, fps, config: { damping: 20 } });
  const index = Number(chapter.label ?? 0);
  return (
    <AbsoluteFill style={{ background: C.cream, opacity, transform: `scale(${scale})` }}>
      <Halftone id={`card-dots-${chapter.id}`} width={620} height={520} style={{ left: -160, bottom: -170, opacity: 0.5 }} />
      <TornPaper
        width={400}
        height={440}
        color={C.sand}
        seed={40 + index}
        style={{ left: 300, top: 300, transform: `rotate(${-4 + paper}deg) translateY(${(1 - paper) * 60}px)`, opacity: paper }}
      >
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontFamily: DISPLAY, fontWeight: 600, fontSize: 330, lineHeight: 1, color: C.terracotta }}>
          {chapter.label}
        </div>
      </TornPaper>
      <Tape width={170} rotate={-9} style={{ left: 410, top: 276, opacity: paper }} />
      <div style={{ position: "absolute", left: 790, top: 400, opacity: title, transform: `translateY(${(1 - title) * 24}px)` }}>
        <div style={KICKER}>Étape {chapter.label}</div>
        <div style={{ marginTop: 16, fontFamily: DISPLAY, fontWeight: 600, fontSize: 112, lineHeight: 1.05, color: C.ink, maxWidth: 980 }}>{chapter.title}</div>
      </div>
      <div style={{ position: "absolute", left: 790, top: 820, display: "flex", gap: 12, opacity: title }}>
        {Array.from({ length: CHAPTER_COUNT }, (_, i) => (
          <div key={i} style={{ display: "grid", gap: 10, justifyItems: "center" }}>
            <div style={{ width: i === index ? 86 : 48, height: 8, borderRadius: 4, background: i < index ? C.ink : i === index ? C.gold : C.sand }} />
            <div style={{ fontFamily: BODY, fontSize: 20, fontWeight: 600, color: i === index ? C.ink : C.sageDeep }}>{i}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

export function EndCard({ duration, cut }: { duration: number; cut: Cut }) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10, duration - 16, duration], [0, 1, 1, 0], clamp);
  const paper = spring({ frame: frame - 4, fps, config: { damping: 18, stiffness: 120 } });
  const arrow = interpolate(frame, [18, 40], [0, 1], clamp);
  const module = cut === "module";
  return (
    <AbsoluteFill style={{ background: C.cream, opacity }}>
      <Halftone id="end-dots" width={700} height={600} style={{ right: -140, bottom: -180, opacity: 0.5 }} />
      <div style={{ position: "absolute", left: 236, top: 300, ...KICKER, opacity: paper }}>{module ? "À suivre · Module 5 · Vidéo 2" : "À vous de jouer"}</div>
      <TornPaper
        width={1400}
        height={250}
        color={C.ink}
        seed={77}
        torn={{ top: 6, bottom: 7, left: 2, right: 9 }}
        style={{ left: 200, top: 370, transform: `translateX(${(1 - paper) * -1400}px) rotate(-1.6deg)` }}
      >
        <div style={{ position: "absolute", left: 64, top: 62, fontFamily: DISPLAY, fontWeight: 600, fontSize: 96, color: C.paper, lineHeight: 1.1, whiteSpace: "nowrap" }}>
          {module ? "La génération de leçons" : "studio.teachinspire.me"}
        </div>
      </TornPaper>
      <Tape width={170} rotate={-12} style={{ left: 170, top: 350, opacity: paper }} />
      <Arrow width={190} draw={arrow} style={{ left: 1630, top: 560 }} />
      <div style={{ position: "absolute", left: 236, top: 680, fontFamily: BODY, fontSize: 34, color: C.inkSoft, opacity: paper }}>
        {module ? "Gardez vos premiers audios sous la main." : "Le Guide du studio reste accessible sous le texte."}
      </div>
    </AbsoluteFill>
  );
}
