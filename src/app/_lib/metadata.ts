import type { Metadata } from "next";

export const SITE_URL = new URL("https://four-bros-mahjong.vercel.app");
const SITE_NAME = "四兄弟麻雀";
export const DEFAULT_TITLE = "四兄弟麻雀 - FourBrosMahjong";
export const DEFAULT_DESCRIPTION =
  "「ギャンブル四兄弟」の麻雀企画をモチーフにした、関西式三人打ち(サンマ)ベースの四人回し麻雀ゲーム。オール赤5・ガリ(北抜きドラ)・サイコロ連動ドラが特徴の非公式ファンメイド作品です。";

const SOCIAL_IMAGE = {
  url: "/icons/icon-512",
  width: 512,
  height: 512,
  alt: "緑の麻雀卓と四枚の牌を描いた四兄弟麻雀のアイコン",
};

/** 各ルートでtitle/descriptionと一致するcanonical・OGP・Twitter Cardを生成する。 */
export function socialMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: `/${string}` | "/";
}): Pick<Metadata, "alternates" | "openGraph" | "twitter"> {
  return {
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "ja_JP",
      siteName: SITE_NAME,
      url: path,
      title,
      description,
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [SOCIAL_IMAGE.url],
    },
  };
}
