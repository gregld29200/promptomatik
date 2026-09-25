import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchSession } from "./session-refresh";

type Listener = () => void;

function fakeWindow() {
  const listeners = new Map<string, Set<Listener>>();
  const target = {
    addEventListener(type: string, listener: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  return {
    target: target as unknown as Pick<Window, "addEventListener" | "removeEventListener">,
    fire(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    count() {
      return [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
    },
  };
}

describe("watchSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes every 5 seconds and when the tab regains focus", async () => {
    const win = fakeWindow();
    const load = vi.fn(async () => "me");
    const apply = vi.fn();
    const stop = watchSession(load, apply, win.target, () => true);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(load).toHaveBeenCalledTimes(1);
    win.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith("me");
    stop();
  });

  it("stays idle while the tab is hidden", async () => {
    const win = fakeWindow();
    const load = vi.fn(async () => "me");
    const stop = watchSession(load, vi.fn(), win.target, () => false);

    await vi.advanceTimersByTimeAsync(20_000);
    win.fire("focus");
    expect(load).not.toHaveBeenCalled();
    stop();
  });

  it("never runs two refreshes at once", async () => {
    const win = fakeWindow();
    let release: () => void = () => {};
    const load = vi.fn(() => new Promise<string>((resolve) => {
      release = () => resolve("me");
    }));
    const stop = watchSession(load, vi.fn(), win.target, () => true);

    win.fire("focus");
    win.fire("focus");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(load).toHaveBeenCalledTimes(1);
    release();
    stop();
  });

  it("stops polling, unhooks its listeners and drops a late answer once stopped", async () => {
    const win = fakeWindow();
    let release: () => void = () => {};
    const load = vi.fn(() => new Promise<string>((resolve) => {
      release = () => resolve("me");
    }));
    const apply = vi.fn();
    const stop = watchSession(load, apply, win.target, () => true);

    win.fire("focus");
    stop();
    release();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(apply).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    expect(win.count()).toBe(0);
  });
});
