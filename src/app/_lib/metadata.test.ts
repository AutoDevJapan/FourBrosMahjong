import { describe, expect, it } from "vitest";
import { SITE_URL, socialMetadata } from "./metadata";

describe("socialMetadata", () => {
  it("route固有のcanonical・OGP・Twitter Cardを同じ内容で生成する", () => {
    const metadata = socialMetadata({
      title: "対局結果 | 四兄弟麻雀",
      description: "結果の説明",
      path: "/game/result",
    });

    expect(SITE_URL.href).toBe("https://four-bros-mahjong.vercel.app/");
    expect(metadata.alternates).toEqual({ canonical: "/game/result" });
    expect(metadata.openGraph).toMatchObject({
      title: "対局結果 | 四兄弟麻雀",
      description: "結果の説明",
      url: "/game/result",
      images: [{ url: "/icons/icon-512", width: 512, height: 512 }],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary",
      title: "対局結果 | 四兄弟麻雀",
      description: "結果の説明",
      images: ["/icons/icon-512"],
    });
  });
});
