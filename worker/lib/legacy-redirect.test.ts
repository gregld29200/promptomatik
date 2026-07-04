import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../index";
import type { Env } from "../env";

const testEnv = env as unknown as Env;

async function fetchUrl(url: string) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(url, { redirect: "manual" }), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("legacy domain redirect (Phase 4)", () => {
  it("301s promptomatik.com to the Studio, path and query preserved", async () => {
    const response = await fetchUrl("https://promptomatik.com/prompts/abc?lang=fr");
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://studio.teachinspire.me/prompts/abc?lang=fr");
  });

  it("301s www.promptomatik.com including API paths", async () => {
    const response = await fetchUrl("https://www.promptomatik.com/api/health");
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://studio.teachinspire.me/api/health");
  });

  it("does not redirect the Studio host", async () => {
    const response = await fetchUrl("https://studio.teachinspire.me/api/health");
    expect(response.status).toBe(200);
  });
});
