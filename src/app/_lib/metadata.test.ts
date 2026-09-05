import { describe, expect, it } from "vitest";
import {
  HOME_SOCIAL_METADATA,
  ROOT_METADATA,
  SITE_URL,
  socialMetadata,
} from "./metadata";

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

  it("共有rootは404へホームのsocial metadataを継承させず、ホーム自身が宣言する", () => {
    expect(ROOT_METADATA.alternates).toBeUndefined();
    expect(ROOT_METADATA.openGraph).toBeUndefined();
    expect(ROOT_METADATA.twitter).toBeUndefined();

    expect(HOME_SOCIAL_METADATA.alternates).toEqual({ canonical: "/" });
    expect(HOME_SOCIAL_METADATA.openGraph).toMatchObject({
      title: "四兄弟麻雀 - FourBrosMahjong",
      url: "/",
    });
    expect(HOME_SOCIAL_METADATA.twitter).toMatchObject({
      title: "四兄弟麻雀 - FourBrosMahjong",
      images: ["/icons/icon-512"],
    });
  });
});
