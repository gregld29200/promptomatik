import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PREVIEW_COUNTER_FROM_DAILY, PreviewPanel, previewCounter, previewErrorMessage } from "./audio-preview";

const usage = (dailyUsed: number, monthlyUsed = dailyUsed) => ({
  dailyUsed,
  dailyLimit: 30,
  monthlyUsed,
  monthlyLimit: 150,
});

describe("preview counter", () => {
  it("stays hidden until the teacher nears the daily cap", () => {
    expect(previewCounter(usage(PREVIEW_COUNTER_FROM_DAILY - 1))).toBeNull();
    expect(previewCounter(usage(PREVIEW_COUNTER_FROM_DAILY))).toContain("5");
  });

  it("speaks of the month when the month runs out first", () => {
    const text = previewCounter(usage(3, 146));
    expect(text).toContain("4");
    expect(text).not.toBeNull();
    expect(text).not.toBe(previewCounter(usage(26, 26)));
  });
});

describe("PreviewPanel", () => {
  it("renders nothing before a preview is asked for", () => {
    expect(renderToStaticMarkup(<PreviewPanel state={{ status: "idle" }} />)).toBe("");
  });

  it("shows a loading status", () => {
    expect(renderToStaticMarkup(<PreviewPanel state={{ status: "loading" }} />)).toContain('role="status"');
  });

  it("plays the preview with its indicative note and no counter far from the cap", () => {
    const html = renderToStaticMarkup(<PreviewPanel state={{ status: "ready", url: "blob:x", usage: usage(1) }} />);
    expect(html).toContain("<audio");
    expect(html).toContain('src="blob:x"');
    expect(html).toContain('controlsList="nodownload"');
    expect(html.match(/<p/g)).toHaveLength(1);
  });
});

describe("preview errors", () => {
  const passthrough = (error: string) => `input:${error}`;

  it("turns a cap refusal into the kind message, never the raw code", () => {
    const daily = previewErrorMessage({ error: "preview_daily_limit", code: "preview_daily_limit", status: 429 }, passthrough);
    const monthly = previewErrorMessage({ error: "preview_monthly_limit", code: "preview_monthly_limit", status: 429 }, passthrough);
    expect(daily).not.toContain("preview_");
    expect(monthly).not.toContain("preview_");
    expect(daily).not.toBe(monthly);
  });

  it("hands script errors to the studio's own wording and hides model failures", () => {
    expect(previewErrorMessage({ error: "audio_lint_x", status: 400 }, passthrough)).toBe("input:audio_lint_x");
    expect(previewErrorMessage({ error: "boom", code: "audio_preview_failed", status: 502 }, passthrough)).not.toContain("boom");
  });
});
