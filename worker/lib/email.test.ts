import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPasswordResetEmail } from "./email";

function captureHtml() {
  const sent: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent.push((JSON.parse(String(init?.body)) as { html: string }).html);
    return new Response(JSON.stringify({ id: "x" }), { status: 200 });
  }));
  return sent;
}

describe("sendPasswordResetEmail", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("carries the return URL into the reset link", async () => {
    const sent = captureHtml();
    await sendPasswordResetEmail("key", {
      to: "a@b.c",
      token: "tok",
      lang: "fr",
      appBaseUrl: "https://studio.teachinspire.me",
      returnUrl: "https://temoignages.teachinspire.me/",
    });
    expect(sent[0]).toContain(
      "https://studio.teachinspire.me/reset-password?token=tok&next=https%3A%2F%2Ftemoignages.teachinspire.me%2F"
    );
  });

  it("keeps the plain link when there is no return URL", async () => {
    const sent = captureHtml();
    await sendPasswordResetEmail("key", {
      to: "a@b.c",
      token: "tok",
      lang: "en",
      appBaseUrl: "https://studio.teachinspire.me",
    });
    expect(sent[0]).toContain('href="https://studio.teachinspire.me/reset-password?token=tok"');
  });
});
