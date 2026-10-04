import type { CSSProperties } from "react";
import { C } from "../theme";

// The brand's digital collage, kept to the cards: torn paper, tape,
// halftone, a scrap of waveform and a hand-drawn arrow.

export function rng(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Torn {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

function tornPoints(w: number, h: number, seed: number, torn: Torn): string {
  const random = rng(seed);
  const points: string[] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number, amp: number) => {
    const steps = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 13));
    for (let i = 0; i < steps; i += 1) {
      const t = i / steps;
      const jitter = amp ? (random() - 0.5) * 2 * amp : 0;
      points.push(`${(x0 + (x1 - x0) * t + nx * jitter).toFixed(1)},${(y0 + (y1 - y0) * t + ny * jitter).toFixed(1)}`);
    }
  };
  edge(0, 0, w, 0, 0, 1, torn.top ?? 0);
  edge(w, 0, w, h, -1, 0, torn.right ?? 0);
  edge(w, h, 0, h, 0, -1, torn.bottom ?? 0);
  edge(0, h, 0, 0, 1, 0, torn.left ?? 0);
  return points.join(" ");
}

export function TornPaper({
  width,
  height,
  color,
  seed,
  torn = { top: 5, right: 5, bottom: 5, left: 5 },
  style,
  children,
}: {
  width: number;
  height: number;
  color: string;
  seed: number;
  torn?: Torn;
  style?: CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ position: "absolute", width, height, ...style }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible", filter: "drop-shadow(0 14px 22px rgba(11, 23, 38, 0.16))" }}>
        <polygon points={tornPoints(width, height, seed, torn)} fill={color} />
      </svg>
      <div style={{ position: "absolute", inset: 0 }}>{children}</div>
    </div>
  );
}

export function Tape({ width = 170, rotate = -8, style }: { width?: number; rotate?: number; style?: CSSProperties }) {
  const teeth = Array.from({ length: 6 }, (_, i) => `${i % 2 ? 0 : 5}px ${(i * 100) / 5}%`).join(", ");
  const teethRight = Array.from({ length: 6 }, (_, i) => `calc(100% - ${i % 2 ? 0 : 5}px) ${100 - (i * 100) / 5}%`).join(", ");
  return (
    <div
      style={{
        position: "absolute",
        width,
        height: 42,
        background: "linear-gradient(180deg, rgba(240, 227, 168, 0.88), rgba(223, 192, 82, 0.8))",
        transform: `rotate(${rotate}deg)`,
        clipPath: `polygon(${teeth}, ${teethRight})`,
        boxShadow: "0 2px 6px rgba(11, 23, 38, 0.12)",
        ...style,
      }}
    />
  );
}

export function Halftone({ width, height, color = C.sage, style, id }: { width: number; height: number; color?: string; style?: CSSProperties; id: string }) {
  return (
    <svg width={width} height={height} style={{ position: "absolute", ...style }}>
      <defs>
        <pattern id={`${id}-dots`} width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="2.6" fill={color} />
        </pattern>
        <radialGradient id={`${id}-fade`}>
          <stop offset="0%" stopColor="white" stopOpacity="0.9" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-mask`}>
          <rect width={width} height={height} fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      <rect width={width} height={height} fill={`url(#${id}-dots)`} mask={`url(#${id}-mask)`} />
    </svg>
  );
}

export function WaveScrap({ width, height, peaks, color, played = 1, playedColor, gap = 4 }: {
  width: number;
  height: number;
  peaks: number[];
  color: string;
  played?: number;
  playedColor?: string;
  gap?: number;
}) {
  const bar = Math.max(2, width / peaks.length - gap);
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {peaks.map((peak, index) => {
        const h = Math.max(4, peak * height);
        const x = (index / peaks.length) * width;
        const isPlayed = index / peaks.length < played;
        return <rect key={index} x={x} y={(height - h) / 2} width={bar} height={h} rx={bar / 2} fill={isPlayed && playedColor ? playedColor : color} />;
      })}
    </svg>
  );
}

export function Arrow({ width = 180, color = C.terracotta, draw = 1, style }: { width?: number; color?: string; draw?: number; style?: CSSProperties }) {
  const length = 260;
  return (
    <svg width={width} height={width * 0.55} viewBox="0 0 200 110" style={{ position: "absolute", overflow: "visible", ...style }}>
      <path
        d="M8 92 C 50 30, 120 18, 178 40"
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - draw)}
      />
      <path d="M156 22 L182 41 L154 58" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity={draw > 0.9 ? 1 : 0} />
    </svg>
  );
}
