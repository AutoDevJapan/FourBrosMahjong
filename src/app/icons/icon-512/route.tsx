import { renderIcon } from "@/app/_lib/icon-art";

// manifest から参照する PWA アイコン(512x512, purpose: any / maskable 兼用)。
// 入力に依存しないためビルド時に静的生成する。
export const dynamic = "force-static";

export function GET() {
  return renderIcon(512);
}
