import { Easing } from "remotion";
import { HEIGHT, WIDTH } from "../theme";
import type { Box, Shot } from "./data";
import type { StageKey } from "./timeline";

// The captured page is a canvas the camera flies over: `s` screen pixels per
// page pixel, page point (cx, cy) on the screen ANCHOR, above the captions.
export interface Camera {
  cx: number;
  cy: number;
  s: number;
}

export interface Point {
  x: number;
  y: number;
}

const ANCHOR: Point = { x: WIDTH / 2, y: 470 };
const SAFE = { w: 1680, h: 760 };
const PAGE_TOP = 44;
const PAGE_SCALE = 1.06;
const MAX_SCALE = 2.05;
const PAD = 26;
const OVERSCROLL = 150;

export const MOVE = 26;
export const SHOT_FADE = 9;
export const CLICK_AT = 21;
export const TRAVEL = 17;
const LINGER = 34;
const CHAIN = 110;

export const ease = Easing.bezier(0.65, 0, 0.35, 1);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function cameraFor(focus: Box | "page", shot: Shot, viewportWidth: number): Camera {
  if (focus === "page") return { s: PAGE_SCALE, cx: shot.width / 2, cy: (ANCHOR.y - PAGE_TOP) / PAGE_SCALE };
  // Close enough that the page always fills the width, never so close that
  // the capture goes soft.
  const minScale = (WIDTH / viewportWidth) * 1.02;
  const fit = Math.min(SAFE.w / (focus.w + 2 * PAD), SAFE.h / (focus.h + 2 * PAD));
  const s = clamp(fit, minScale, MAX_SCALE);
  let cx = focus.x + focus.w / 2;
  let cy = focus.y + focus.h / 2;
  // What does not fit is read from its top-left corner.
  if (focus.w + 2 * PAD > SAFE.w / s) cx = focus.x - PAD + SAFE.w / s / 2;
  if (focus.h + 2 * PAD > SAFE.h / s) cy = focus.y - PAD + SAFE.h / s / 2;
  // The page stays under the whole frame.
  const left = ANCHOR.x / s;
  const right = (WIDTH - ANCHOR.x) / s;
  const above = ANCHOR.y / s;
  const below = (HEIGHT - ANCHOR.y) / s;
  cx = left + right <= shot.width ? clamp(cx, left, shot.width - right) : shot.width / 2;
  // Past the bottom of a short page, the paper's edge shows on the desk.
  cy = above + below <= shot.height + OVERSCROLL ? clamp(cy, above, shot.height + OVERSCROLL - below) : above;
  return { cx, cy, s };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpCamera(from: Camera, to: Camera, t: number): Camera {
  return {
    cx: lerp(from.cx, to.cx, t),
    cy: lerp(from.cy, to.cy, t),
    s: Math.exp(lerp(Math.log(from.s), Math.log(to.s), t)),
  };
}

export function toScreen(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.cx) * camera.s + ANCHOR.x, y: (point.y - camera.cy) * camera.s + ANCHOR.y };
}

export function boxToScreen(camera: Camera, box: Box): Box {
  const topLeft = toScreen(camera, box);
  return { x: topLeft.x, y: topLeft.y, w: box.w * camera.s, h: box.h * camera.s };
}

function lerpBox(from: Box, to: Box, t: number): Box {
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), w: lerp(from.w, to.w, t), h: lerp(from.h, to.h, t) };
}

function center(box: Box): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

export interface StageState {
  camera: Camera;
  layers: Array<{ shot: string; opacity: number }>;
  spotlight: { box: Box; opacity: number } | null;
  callouts: Array<{ target: Box; text: string; side?: "above" | "below"; age: number; opacity: number }>;
  cursor: { at: Point; opacity: number; press: number; ripple: number | null } | null;
}

function activeIndex(keys: StageKey[], frame: number): number {
  let index = 0;
  for (let i = 0; i < keys.length; i += 1) if (keys[i].frame <= frame) index = i;
  return index;
}

function cursorAt(keys: StageKey[], frame: number): StageState["cursor"] {
  const clicks = keys.flatMap((key) => (key.click ? [{ arrive: key.frame + CLICK_AT, target: center(key.click) }] : []));
  const nextIndex = clicks.findIndex((click) => click.arrive > frame);
  const next = nextIndex >= 0 ? clicks[nextIndex] : null;
  const last = nextIndex > 0 ? clicks[nextIndex - 1] : nextIndex < 0 ? clicks[clicks.length - 1] : null;
  const chained = Boolean(last && next && next.arrive - last.arrive <= CHAIN);

  if (next && frame >= next.arrive - TRAVEL - 6) {
    const from = chained && last ? last.target : { x: next.target.x + 150, y: next.target.y + 120 };
    const t = ease(clamp01((frame - (next.arrive - TRAVEL)) / TRAVEL));
    const opacity = chained ? 1 : clamp01((frame - (next.arrive - TRAVEL - 6)) / 6);
    return { at: { x: lerp(from.x, next.target.x, t), y: lerp(from.y, next.target.y, t) }, opacity, press: 0, ripple: null };
  }
  if (last) {
    const age = frame - last.arrive;
    if (age <= LINGER || chained) {
      const press = age < 8 ? Math.sin((age / 8) * Math.PI) : 0;
      const opacity = chained ? 1 : clamp01((LINGER - age) / 8);
      return { at: last.target, opacity, press, ripple: age < 16 ? age / 16 : null };
    }
  }
  return null;
}

export function stageAt(keys: StageKey[], shots: Record<string, Shot>, viewportWidth: number, frame: number): StageState {
  const index = activeIndex(keys, frame);
  const key = keys[index];
  const previous = index > 0 ? keys[index - 1] : null;
  const moving = Boolean(previous) && !key.cut;
  const progress = moving ? ease(clamp01((frame - key.frame) / MOVE)) : 1;
  const to = cameraFor(key.focus, shots[key.shot], viewportWidth);
  const from = previous ? cameraFor(previous.focus, shots[previous.shot], viewportWidth) : to;
  const camera = moving ? lerpCamera(from, to, progress) : to;

  // A clicked change shows once the click lands.
  let layers = [{ shot: key.shot, opacity: 1 }];
  if (moving && previous && previous.shot !== key.shot) {
    const start = key.click ? key.frame + CLICK_AT + 2 : key.frame + Math.round(MOVE * 0.3);
    const fade = clamp01((frame - start) / SHOT_FADE);
    // Once faded in, the new shot stands alone: a shorter page must not show
    // the previous one below its edge.
    if (fade < 1) layers = [{ shot: previous.shot, opacity: 1 }, { shot: key.shot, opacity: fade }];
  }

  let spotlight: StageState["spotlight"] = null;
  const before = moving ? previous?.spotlight : undefined;
  if (key.spotlight && before) spotlight = { box: lerpBox(before, key.spotlight, progress), opacity: 1 };
  else if (key.spotlight) spotlight = { box: key.spotlight, opacity: moving ? progress : clamp01((frame - key.frame) / 8) };
  else if (before) spotlight = { box: before, opacity: 1 - progress };

  const callouts: StageState["callouts"] = [];
  const age = frame - key.frame;
  if (key.callout) {
    const delay = moving ? 14 : 8;
    if (age >= delay) callouts.push({ ...key.callout, age: age - delay, opacity: 1 });
  }
  if (previous?.callout && age < 7 && previous.callout.text !== key.callout?.text) {
    callouts.push({ ...previous.callout, age: 99, opacity: 1 - age / 7 });
  }

  return { camera, layers, spotlight, callouts, cursor: cursorAt(keys, frame) };
}
