import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { boxToScreen, stageAt, toScreen } from "../studio-audio/camera";
import type { Box, ShotSet } from "../studio-audio/data";
import type { StageKey } from "../studio-audio/timeline";
import { BODY, C, HEIGHT, WIDTH } from "../theme";

const SPOT_PAD = 9;
const CAPTION_TOP = 930;

// The real studio, captured, under a camera that frames, spotlights and
// clicks what the narration talks about.
export function Stage({ keys, shots }: { keys: StageKey[]; shots: ShotSet }) {
  const frame = useCurrentFrame();
  const state = stageAt(keys, shots.shots, shots.viewport.width, frame);
  const { camera } = state;

  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 35%, ${C.paper}, ${C.creamDeep})`, overflow: "hidden" }}>
      {state.layers.map((layer, index) => {
        const shot = shots.shots[layer.shot];
        const origin = toScreen(camera, { x: 0, y: 0 });
        return (
          <Img
            key={`${layer.shot}-${index}`}
            src={staticFile(shot.file)}
            style={{
              position: "absolute",
              left: origin.x,
              top: origin.y,
              width: shot.width * camera.s,
              height: shot.height * camera.s,
              opacity: layer.opacity,
              borderRadius: 14,
              boxShadow: "0 40px 90px rgba(19, 32, 56, 0.16), 0 0 0 1px rgba(19, 32, 56, 0.06)",
            }}
          />
        );
      })}
      {state.spotlight && <Spotlight box={boxToScreen(camera, state.spotlight.box)} opacity={state.spotlight.opacity} scale={camera.s} />}
      {state.callouts.map((callout) => (
        <Callout key={callout.text} target={boxToScreen(camera, callout.target)} text={callout.text} side={callout.side} age={callout.age} opacity={callout.opacity} />
      ))}
      {state.cursor && <Cursor at={toScreen(camera, state.cursor.at)} opacity={state.cursor.opacity} press={state.cursor.press} ripple={state.cursor.ripple} />}
    </AbsoluteFill>
  );
}

function Spotlight({ box, opacity, scale }: { box: Box; opacity: number; scale: number }) {
  const pad = SPOT_PAD * Math.min(scale, 1.6);
  return (
    <div
      style={{
        position: "absolute",
        left: box.x - pad,
        top: box.y - pad,
        width: box.w + pad * 2,
        height: box.h + pad * 2,
        borderRadius: 12,
        boxShadow: `0 0 0 3px rgba(223, 192, 82, ${opacity}), 0 0 0 10px rgba(223, 192, 82, ${0.22 * opacity}), 0 0 0 4000px rgba(11, 23, 38, ${0.44 * opacity})`,
      }}
    />
  );
}

function Callout({ target, text, side, age, opacity }: { target: Box; text: string; side?: "above" | "below"; age: number; opacity: number }) {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: age, fps, config: { damping: 15, stiffness: 190 } });
  const width = text.length * 17 + 76;
  const height = 64;
  const gap = 26;
  const fitsAbove = target.y - gap - height > 24;
  const below = !(side === "above" && fitsAbove) && target.y + target.h + gap + height < CAPTION_TOP - 10;
  const above = !below && fitsAbove;
  let x = target.x + target.w / 2 - width / 2;
  let y = below ? target.y + target.h + gap : above ? target.y - gap - height : target.y + target.h / 2 - height / 2;
  if (!below && !above) x = target.x + target.w + gap;
  x = Math.min(Math.max(x, 36), WIDTH - width - 36);
  y = Math.min(Math.max(y, 24), HEIGHT - height - 24);
  const pointerX = Math.min(Math.max(target.x + target.w / 2 - x, 26), width - 26);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        opacity: opacity * Math.min(1, pop * 1.4),
        transform: `translateY(${(1 - pop) * (below ? -10 : 10)}px) scale(${0.94 + 0.06 * pop})`,
      }}
    >
      {(below || above) && (
        <div
          style={{
            position: "absolute",
            left: pointerX - 9,
            top: below ? -8 : height - 10,
            width: 18,
            height: 18,
            background: C.ink,
            transform: "rotate(45deg)",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 26px",
          background: C.ink,
          color: C.paper,
          borderRadius: 6,
          borderLeft: `6px solid ${C.gold}`,
          fontFamily: BODY,
          fontSize: 29,
          fontWeight: 600,
          whiteSpace: "nowrap",
          boxShadow: "0 18px 36px rgba(11, 23, 38, 0.28)",
        }}
      >
        {text}
      </div>
    </div>
  );
}

function Cursor({ at, opacity, press, ripple }: { at: { x: number; y: number }; opacity: number; press: number; ripple: number | null }) {
  return (
    <>
      {ripple !== null && (
        <div
          style={{
            position: "absolute",
            left: at.x - (14 + 40 * ripple),
            top: at.y - (14 + 40 * ripple),
            width: (14 + 40 * ripple) * 2,
            height: (14 + 40 * ripple) * 2,
            borderRadius: "50%",
            border: `4px solid rgba(223, 192, 82, ${0.85 * (1 - ripple)})`,
            background: `rgba(223, 192, 82, ${0.18 * (1 - ripple)})`,
          }}
        />
      )}
      <svg
        width={44}
        height={56}
        viewBox="0 0 22 28"
        style={{
          position: "absolute",
          left: at.x - 3,
          top: at.y - 2,
          opacity,
          transform: `scale(${1 - 0.14 * press})`,
          transformOrigin: "3px 2px",
          filter: "drop-shadow(0 4px 6px rgba(11, 23, 38, 0.35))",
        }}
      >
        <path d="M1.5 1 L1.5 22 L6.6 17.4 L10.2 25.6 L13.6 24.1 L10.1 16.1 L17 16.1 Z" fill={C.paper} stroke={C.ink} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </>
  );
}
