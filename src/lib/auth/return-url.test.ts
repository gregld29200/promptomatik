import { describe, expect, it } from "vitest";
import { isExternalReturnUrl, safeReturnUrl } from "../../../shared/return-url";

describe("safeReturnUrl", () => {
  it("accepts TeachInspire https URLs and same-site paths", () => {
    expect(safeReturnUrl("https://temoignages.teachinspire.me/")).toBe("https://temoignages.teachinspire.me/");
    expect(safeReturnUrl("https://teachinspire.me/a?b=1")).toBe("https://teachinspire.me/a?b=1");
    expect(safeReturnUrl("/audio?x=1")).toBe("/audio?x=1");
  });

  it("rejects anything that could leave TeachInspire", () => {
    for (const raw of [
      "https://evil.com",
      "https://teachinspire.me.evil.com/",
      "https://evilteachinspire.me/",
      "http://temoignages.teachinspire.me/",
      "https://user:pw@temoignages.teachinspire.me/",
      "https://temoignages.teachinspire.me:8443/",
      "//evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "",
      null,
      42,
    ]) {
      expect(safeReturnUrl(raw)).toBeNull();
    }
  });

  it("tells external URLs from Studio paths", () => {
    expect(isExternalReturnUrl("https://temoignages.teachinspire.me/")).toBe(true);
    expect(isExternalReturnUrl("/home")).toBe(false);
  });
});
