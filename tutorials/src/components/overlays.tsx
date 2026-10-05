import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Caption, ChapterSpan, Overlay } from "../tutorial/timeline";
import { BODY, C, DISPLAY } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// The five steps of the recap, each on its cue in the narration.
export function Recap({ duration, steps, labels }: { duration: number; steps: number[]; labels: string[] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const veil = interpolate(frame, [0, 10, duration - 14, duration], [0, 1, 1, 0], clamp);
  const STEP = 300;
  const left = (1920 - STEP * labels.length) / 2;
  return (
    <AbsoluteFill style={{ opacity: veil }}>
      <AbsoluteFill style={{ background: "rgba(244, 241, 235, 0.93)" }} />
      <div style={{ position: "absolute", left, top: 300, fontFamily: BODY, fontSize: 26, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: C.terracotta }}>
        En résumé
      </div>
      <div style={{ position: "absolute", left: left + 40, top: 460, width: STEP * (labels.length - 1), height: 4, background: C.sand }} />
      <div
        style={{
          position: "absolute",
          left: left + 40,
          top: 460,
          height: 4,
          background: C.ink,
          width: interpolate(frame, [steps[0], steps[steps.length - 1]], [0, STEP * (labels.length - 1)], clamp),
        }}
      />
      {labels.map((label, index) => {
        const pop = spring({ frame: frame - steps[index], fps, config: { damping: 14, stiffness: 170 } });
        return (
          <div key={label} style={{ position: "absolute", left: left + index * STEP, top: 422, width: STEP, opacity: pop, transform: `translateY(${(1 - pop) * 26}px)` }}>
            <div style={{ width: 80, height: 80, borderRadius: "50%", background: index === labels.length - 1 ? C.gold : C.paper, border: `3px solid ${C.ink}`, display: "grid", placeItems: "center", fontFamily: DISPLAY, fontWeight: 600, fontSize: 40, color: C.ink }}>
              {index + 1}
            </div>
            <div style={{ marginTop: 26, fontFamily: DISPLAY, fontWeight: 600, fontSize: 50, color: C.ink }}>{label}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

export function Captions({ captions }: { captions: Caption[] }) {
  const frame = useCurrentFrame();
  const caption = captions.find((entry) => frame >= entry.from && frame < entry.to);
  if (!caption) return null;
  const opacity = interpolate(frame, [caption.from, caption.from + 4], [0.4, 1], clamp);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 40, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div
        style={{
          maxWidth: 1480,
          padding: "14px 30px 16px",
          borderRadius: 6,
          background: "rgba(19, 32, 56, 0.9)",
          color: C.paper,
          fontFamily: BODY,
          fontSize: 36,
          fontWeight: 500,
          lineHeight: 1.32,
          textAlign: "center",
          opacity,
        }}
      >
        {caption.text}
      </div>
    </div>
  );
}

const FULL_SCREEN = new Set<Overlay["kind"]>(["title", "card", "result", "compare", "end"]);

// Where we are, in the corner: the chapter's number and name.
export function ChapterTag({ chapters, overlays }: { chapters: ChapterSpan[]; overlays: Overlay[] }) {
  const frame = useCurrentFrame();
  const chapter = chapters.find((entry) => entry.label !== undefined && frame >= entry.from && frame < entry.to);
  if (!chapter) return null;
  const screens = overlays.filter((overlay) => FULL_SCREEN.has(overlay.kind));
  if (screens.some((overlay) => frame >= overlay.from - 4 && frame < overlay.from + overlay.duration)) return null;
  const shownFrom = Math.max(chapter.from, ...screens.map((overlay) => overlay.from + overlay.duration).filter((end) => end <= frame));
  const opacity = Math.min(
    interpolate(frame, [shownFrom, shownFrom + 10], [0, 1], clamp),
    interpolate(frame, [chapter.to - 8, chapter.to], [1, 0], clamp),
  );
  return (
    <div
      style={{
        position: "absolute",
        left: 40,
        top: 34,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 20px 10px 16px",
        borderRadius: 6,
        background: C.paper,
        borderLeft: `5px solid ${C.gold}`,
        boxShadow: "0 10px 24px rgba(11, 23, 38, 0.14)",
        fontFamily: BODY,
        fontSize: 24,
        fontWeight: 600,
        color: C.ink,
        opacity,
      }}
    >
      <span style={{ fontFamily: DISPLAY, fontSize: 28, color: C.terracotta }}>{chapter.label}</span>
      {chapter.title}
    </div>
  );
}
