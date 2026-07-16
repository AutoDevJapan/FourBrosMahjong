import { renderIcon } from "@/app/_lib/icon-art";

// manifest から参照する PWA アイコン(192x192, purpose: any)。
// 入力に依存しないためビルド時に静的生成する。
export const dynamic = "force-static";

export function GET() {
  return renderIcon(192);
}
