/**
 * `/sw.js` — service worker 本体の配信(issue #292)。
 *
 * `public/` の静的ファイルではなくルートハンドラで配信することで、ビルドごとに一意の
 * キャッシュバージョン(Vercel ではコミット SHA)をスクリプトへ埋め込める。SW 本体の
 * バイト列がデプロイごとに変わるため、ブラウザの SW 更新チェックが新バージョンを検出し、
 * activate で旧キャッシュが確実に破棄される。
 *
 * ルートパス直下(`/sw.js`)で配信するため、既定スコープが `/` になり
 * `Service-Worker-Allowed` ヘッダーは不要。
 */
import {
  buildServiceWorkerScript,
  resolveServiceWorkerVersion,
} from "@/app/_lib/serviceWorkerScript";

// ビルド時に一度だけ評価して静的化する(リクエスト毎の再生成やバージョン揺れを防ぐ)。
export const dynamic = "force-static";

const script = buildServiceWorkerScript(resolveServiceWorkerVersion());

export function GET(): Response {
  return new Response(script, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // SW 本体は常に再検証させ、新デプロイの更新チェックを HTTP キャッシュに妨げさせない。
      "Cache-Control": "no-cache, max-age=0",
    },
  });
}
