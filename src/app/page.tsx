/**
 * ロビー(トップページ)。
 *
 * スペック6(`documents/spec/screen-design-and-routing.md` 6.2節)で定義された
 * エントリーポイント。対局開始・ルール説明・設定への導線を提供する。
 * 実装済みルート(`ready: true`)はリンクとして遷移でき、未実装ルートは
 * 「準備中」表示のプレースホルダとする(ルート実装 issue が各自 `ready` を切り替える)。
 *
 * アクセシビリティ・レスポンシブ・ダークモードは
 * `documents/spec/ui-accessibility-responsive-darkmode.md`(スペック5)に従う:
 * 状態は色のみに依存せずテキストラベルで伝達し、配色は `globals.css` の
 * トークン(`--background` / `--foreground`)経由で参照する。
 */

import Link from "next/link";

/** ロビーからの導線一覧(スペック6 6.3節の画面遷移に対応)。 */
const menuItems = [
  {
    title: "対局を開始",
    description: "四人回しサンマで半荘戦を打つ",
    href: "/game",
    ready: false,
  },
  {
    title: "ルールを見る",
    description: "オール赤5・ガリ・サイコロ連動ドラなど独自ルールの説明",
    href: "/rules",
    ready: false,
  },
  {
    title: "設定",
    description: "ダークモード切替などの表示設定",
    href: "/settings",
    ready: true,
  },
] as const;

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-12 p-8 sm:p-16">
      <main className="flex w-full max-w-md flex-col items-center gap-10">
        <header className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm tracking-widest text-foreground/70 uppercase">
            FourBrosMahjong
          </p>
          <h1 className="text-4xl font-bold sm:text-5xl">四兄弟麻雀</h1>
          <p className="max-w-prose text-sm/6 text-foreground/70">
            「ギャンブル四兄弟」の麻雀企画をモチーフにした、
            関西式三人打ち(サンマ)ベースの四人回し麻雀ゲーム
          </p>
        </header>

        <nav aria-label="メインメニュー" className="w-full">
          <ul className="flex flex-col gap-3">
            {menuItems.map((item) =>
              item.ready ? (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-4 rounded-lg border border-foreground/15 p-4 transition-colors hover:border-foreground/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                  >
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="mt-1 text-sm/5 text-foreground/70">
                        {item.description}
                      </p>
                    </div>
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-foreground/50"
                    >
                      →
                    </span>
                  </Link>
                </li>
              ) : (
                <li
                  key={item.href}
                  className="flex items-center justify-between gap-4 rounded-lg border border-foreground/15 p-4"
                >
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="mt-1 text-sm/5 text-foreground/70">
                      {item.description}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-foreground/25 px-3 py-1 text-xs text-foreground/70">
                    準備中
                  </span>
                </li>
              ),
            )}
          </ul>
        </nav>
      </main>

      <footer className="text-center text-xs text-foreground/70">
        本作は粗品 Official
        Channel「ギャンブル四兄弟」を題材にした非公式ファンメイド作品です
      </footer>
    </div>
  );
}
