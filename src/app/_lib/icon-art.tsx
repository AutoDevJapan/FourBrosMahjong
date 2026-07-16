import { ImageResponse } from "next/og";

/**
 * PWA / モバイルアイコン用の共通デザイン。
 *
 * #44(`src/app/icon.svg`)で導入した「麻雀牌の面 + 赤い『四』」を、
 * felt 緑のフルブリード背景へ配置し直したもの。iOS のホーム画面追加では
 * 透過部分が黒く塗られ、Android の maskable アイコンは中央 80% だけが
 * 保証されるため、背景は正方形いっぱいに塗り、牌は中央約 60%
 * (セーフゾーン内)へ収めている。
 *
 * spec 5(`documents/spec/ui-accessibility-responsive-darkmode.md`)の
 * カラートークン方針に沿い、felt 緑 / tile-face アイボリー / accent-red 赤を使用。
 */

// maskable のセーフゾーンは中央 80% 径の円。#44 の牌+「四」グループ(viewBox
// 32x32)を scale 4 で 180 座標系へ拡大し中央配置すると、牌は 44–136 / 38–142
// (対角約 139px < セーフ円径 144px)に収まり、円形マスクでも欠けない。
const ICON_SCALE = 4;
const ICON_TRANSLATE = 90 - 16 * ICON_SCALE; // 牌の中心(32座標系で16,16)を180中央へ

/** 卓の felt 緑。manifest の theme_color / background_color とも共有する。 */
export const FELT_GREEN = "#146B3A";
/** 牌面のアイボリー。 */
const TILE_FACE = "#F5EEDC";
/** 赤ドラ由来のアクセント(「四」の描画色)。 */
const ACCENT_RED = "#B32821";

/**
 * フルブリードのアイコンを SVG マークアップとして生成する。
 *
 * `icon.svg`(viewBox 32x32)の牌+「四」グループをそのままの座標で 180 座標系の
 * 中央へ拡大配置し、背景を felt 緑で正方形いっぱいに塗る。apple-touch / maskable
 * いずれのマスクでも中心の「四」が欠けない。
 */
function iconSvg(): string {
  const g = `translate(${ICON_TRANSLATE},${ICON_TRANSLATE}) scale(${ICON_SCALE})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" role="img" aria-label="四兄弟麻雀"><title>四兄弟麻雀</title><rect width="180" height="180" fill="${FELT_GREEN}"/><g transform="${g}"><rect x="4.5" y="3" width="23" height="26" rx="4.5" fill="${TILE_FACE}"/><g stroke="${ACCENT_RED}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"><rect x="10.3" y="9.8" width="11.4" height="11.6" rx="1.4"/><path d="M14 10 V16.4 C14 17.6 13.6 18.6 12.9 19.4"/><path d="M18 10 V16.4 C18 17.6 18.4 18.6 19.1 19.4"/><path d="M11 19.4 H21"/></g></g></svg>`;
}

/**
 * 指定サイズの正方形 PNG を生成する `ImageResponse` を返す。
 * `apple-icon.tsx` および manifest 用アイコンルートから共有される。
 * SVG を base64 データ URI として `<img>` に渡すため、外部ネットワークに依存しない。
 */
export function renderIcon(size: number): ImageResponse {
  const svg = iconSvg();
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* Satori/ImageResponse でのラスタライズ用途のため next/image は使用不可 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img width={size} height={size} src={src} alt="四兄弟麻雀" />
    </div>,
    { width: size, height: size },
  );
}
