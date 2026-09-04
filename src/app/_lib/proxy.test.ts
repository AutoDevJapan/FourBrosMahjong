import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

const [matcherSource] = config.matcher;
if (typeof matcherSource !== "string") {
  throw new Error("The proxy matcher contract must use a string source");
}

const proxyMatcher = new RegExp(`^${matcherSource}$`);

describe("proxy matcher", () => {
  it("bypasses immutable checked-in assets while matching application routes", () => {
    const immutableAssets = [
      "/characters/p0-soakuhin-portrait.avif",
      "/characters/p1-ryuji-portrait.avif",
      "/characters/p2-masaki-portrait.avif",
      "/characters/p3-hechima-portrait.avif",
      "/fonts/example.ttf",
      "/fonts/example.otf",
      "/images/example.png",
      "/fonts/example.woff2",
    ];

    for (const pathname of immutableAssets) {
      expect(proxyMatcher.test(pathname), pathname).toBe(false);
    }

    expect(proxyMatcher.test("/settings")).toBe(true);
  });
});
