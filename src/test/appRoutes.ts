import { readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * App Router のページファイル群から公開ルートパスを導出する共有ヘルパ。
 *
 * spec 5.2.6 のランドマーク規約は「**全ルート**」を対象にするため、規約を機械で守る側は
 * 「実在するルートの集合」を実装から導く必要がある。ルート一覧を手書きすると、ルート新設時に
 * 追記を忘れた分だけ**無音で規約の外**へ出てしまう。
 *
 * 導出は 2 つのゲートが共有する(片方だけが新ルートに気づく状態を作らないため):
 * - `src/test/a11y-landmark-screens.test.ts` — 単一 `<main>` の E2E 監査対象(`e2e/screens.ts`)との一致
 * - `src/test/a11y-heading-placement.test.tsx` — `<h1>` を `<main>` の内側に置く規約(#431)の全ルート検査
 *
 * vitest に依存させない(`expect` を持ち込まない)ことで、どちらのプロジェクト
 * (node / jsdom)からも同じ実装を読める素のモジュールに保つ。想定外の形は例外で落とす。
 */
const APP_DIR = resolve(process.cwd(), "src/app");

/**
 * App Router がページとして解釈するファイル名。
 *
 * `.tsx` だけを見ると、`page.jsx` / `page.js` で足されたルートが**この検査をすり抜ける**
 * (ここで塞ごうとしている失敗モードそのもの)。拡張子は Next.js が受け付ける形を
 * 網羅する。先頭の `/` ごと消してディレクトリ部分だけを残す。
 */
const PAGE_FILE = /(?:^|\/)page\.(?:tsx|ts|jsx|js|mjs|cjs)$/;

/**
 * `src/app/**\/page.*` から公開ルートパスを導出する。
 *
 * - ルートグループ `(name)` は URL に現れないのでセグメントごと落とす
 * - プライベートフォルダ `_name` 配下は**ルーティングされない**ので**エントリごと**除外する
 *   (セグメントだけ落とすと `_drafts/preview/page.tsx` が `/preview` に化ける)
 *
 * 一方、**監査すべき具体的な URL を機械的に決められない**形は推測せず落とす:
 * - 動的セグメント `[param]`
 * - パラレルルート `@slot`(スロットは単独の URL を持たない)
 *
 * 追加した時点で呼び出し側のテストが失敗し、監査対象の決め方を明示的に更新させる。
 *
 * @returns 昇順にソートしたルートパス(例: `["/", "/game", "/game/result", …]`)
 */
export function appRoutes(): string[] {
  const pages = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.replaceAll("\\", "/"))
    .filter((entry) => PAGE_FILE.test(entry));

  if (pages.length === 0) {
    throw new Error(
      "src/app にページファイルが 1 つも無い(PAGE_FILE の想定が崩れた可能性)",
    );
  }

  const routes: string[] = [];
  for (const entry of pages) {
    const segments = entry
      .replace(PAGE_FILE, "")
      .split("/")
      .filter((segment) => segment !== "");

    for (const segment of segments) {
      if (segment.startsWith("[") || segment.startsWith("@")) {
        throw new Error(
          `${entry}: 動的セグメント/パラレルルート ${segment} は未対応。監査対象の具体 URL を決めて appRoutes() の呼び出し側テストを更新すること`,
        );
      }
    }

    // プライベートフォルダ配下はルートを持たない。
    if (segments.some((segment) => segment.startsWith("_"))) continue;

    const visible = segments.filter((segment) => !segment.startsWith("("));
    routes.push(visible.length === 0 ? "/" : `/${visible.join("/")}`);
  }

  return routes.sort();
}
