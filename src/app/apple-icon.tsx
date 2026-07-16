import { renderIcon } from "@/app/_lib/icon-art";

// iOS Safari「ホーム画面に追加」用の apple-touch-icon(180x180)。
// App Router が自動で <link rel="apple-touch-icon"> を出力する。
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderIcon(size.width);
}
