import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { DocumentsDemo } from "../tutorial/data";
import { BODY, C, DISPLAY } from "../theme";
import { Halftone, Tape } from "./collage";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// The finished document, shown before anything is explained: its pages laid
// on the desk, the first one in front, slowly coming closer.
export function DocumentResult({ duration, demo }: { duration: number; demo: DocumentsDemo }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, 8, duration - 12, duration], [0, 1, 1, 0], clamp);
  const head = spring({ frame, fps, config: { damping: 20 } });
  const zoom = interpolate(frame, [0, duration], [1, 1.06]);
  const PAGE_HEIGHT = 860;
  const [first, second] = demo.pages;
  const width = (page: { width: number; height: number }) => (page.width / page.height) * PAGE_HEIGHT;
  const pageStyle = { position: "absolute" as const, height: PAGE_HEIGHT, boxShadow: "0 30px 60px rgba(19, 32, 56, 0.22), 0 0 0 1px rgba(19, 32, 56, 0.06)" };
  const enterFirst = spring({ frame: frame - 6, fps, config: { damping: 18, stiffness: 110 } });
  const enterSecond = spring({ frame: frame - 14, fps, config: { damping: 18, stiffness: 110 } });
  return (
    <AbsoluteFill style={{ background: C.cream, opacity }}>
      <Halftone id="pages-dots" width={700} height={560} style={{ left: -180, top: -160, opacity: 0.45 }} />
      <div style={{ position: "absolute", left: 140, top: 170, width: 560, opacity: head, transform: `translateY(${(1 - head) * 20}px)` }}>
        <div style={{ fontFamily: BODY, fontSize: 26, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: C.terracotta }}>Voici le résultat</div>
        <div style={{ marginTop: 18, fontFamily: DISPLAY, fontWeight: 600, fontSize: 64, lineHeight: 1.1, color: C.ink }}>Une fiche prête à imprimer</div>
        <div style={{ marginTop: 28, fontFamily: BODY, fontSize: 30, lineHeight: 1.45, color: C.inkSoft }}>{demo.title}</div>
        <div style={{ marginTop: 34, display: "flex", gap: 14, flexWrap: "wrap" }}>
          {[`${demo.pages.length} pages`, "PDF", "Vos mots, tels quels"].map((chip) => (
            <span key={chip} style={{ padding: "10px 18px", border: `2px solid ${C.sand}`, borderRadius: 6, background: C.paper, fontFamily: BODY, fontSize: 24, fontWeight: 600, color: C.ink }}>
              {chip}
            </span>
          ))}
        </div>
      </div>
      <div style={{ position: "absolute", left: 760, top: 110, width: 1060, height: 900, transform: `scale(${zoom})`, transformOrigin: "40% 30%" }}>
        {second && (
          <Img
            src={staticFile(second.file)}
            style={{ ...pageStyle, left: 380, top: 30, width: width(second), opacity: enterSecond, transform: `rotate(${4 * enterSecond}deg) translateX(${(1 - enterSecond) * 120}px)` }}
          />
        )}
        <Img
          src={staticFile(first.file)}
          style={{ ...pageStyle, left: 40, top: 0, width: width(first), opacity: enterFirst, transform: `rotate(${-2.5 * enterFirst}deg) translateY(${(1 - enterFirst) * 60}px)` }}
        />
        <Tape width={170} rotate={-10} style={{ left: 200, top: -18, opacity: enterFirst }} />
      </div>
    </AbsoluteFill>
  );
}
