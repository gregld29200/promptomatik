// Keeps the signed-in account in step with the server while the tab is in
// use, so a tier change made by an admin applies without signing in again.
// Refreshes every 5 seconds and whenever the tab regains focus; never runs
// two requests at once and never applies a result after it has been stopped.
export function watchSession<T>(
  load: () => Promise<T>,
  apply: (result: T) => void,
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  isActive: () => boolean
): () => void {
  let stopped = false;
  let inFlight = false;

  const refresh = async () => {
    if (stopped || inFlight || !isActive()) return;
    inFlight = true;
    try {
      const result = await load();
      if (!stopped) apply(result);
    } finally {
      inFlight = false;
    }
  };
  const wake = () => {
    void refresh();
  };

  const interval = setInterval(wake, 5_000);
  target.addEventListener("focus", wake);
  target.addEventListener("visibilitychange", wake);
  return () => {
    stopped = true;
    clearInterval(interval);
    target.removeEventListener("focus", wake);
    target.removeEventListener("visibilitychange", wake);
  };
}
