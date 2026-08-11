/**
 * ロビー(トップページ)。
 *
 * スペック6(`documents/spec/screen-design-and-routing.md` 6.2節)で定義された
 * エントリーポイント。対局開始・ルール説明・設定への導線を提供する。
 * 3導線(`/game`・`/rules`・`/settings`)はいずれも実装済みのため実リンクとして遷移でき、
 * 今後未実装ルートを追加する場合は `ready: false` で「準備中」プレースホルダ表示に切り替える。
 *
 * アクセシビリティ・レスポンシブ・ダークモードは
 * `documents/spec/ui-accessibility-responsive-darkmode.md`(スペック5)に従う:
 * 状態は色のみに依存せずテキストラベルで伝達し、配色は `globals.css` の
 * トークン(`--background` / `--foreground`)経由で参照する。
 */
import Link from "next/link";

/** ロビーからの導線1件。 */
type MenuItem = {
  title: string;
  description: string;
  href: string;
  /** 遷移先ルートが実装済みか。false/未指定なら「準備中」プレースホルダ表示。 */
  ready?: boolean;
};

/** ロビーからの導線一覧(スペック6 6.3節の画面遷移に対応)。 */
const menuItems: MenuItem[] = [
  {
    title: "対局を開始",
    description: "四人回しサンマで半荘戦を打つ",
    href: "/game",
    ready: true,
  },
  {
    title: "ルールを見る",
    description: "オール赤5・ガリ・サイコロ連動ドラなど独自ルールの説明",
    href: "/rules",
    ready: true,
  },
  {
    title: "戦績",
    description: "この端末に保存された半荘結果(順位・ソシー内訳)の一覧",
    href: "/history",
    ready: true,
  },
  {
    title: "設定",
    description: "ダークモード切替などの表示設定",
    href: "/settings",
    ready: true,
  },
];

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
            {menuItems.map((item) => {
              const content = (
                <>
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="mt-1 text-sm/5 text-foreground/70">
                      {item.description}
                    </p>
                  </div>
                  {item.ready ? (
                    <span
                      aria-hidden
                      className="shrink-0 text-lg text-foreground/70"
                    >
                      →
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-foreground/25 px-3 py-1 text-xs text-foreground/70">
                      準備中
                    </span>
                  )}
                </>
              );

              return (
                <li
                  key={item.href}
                  className="rounded-lg border border-control-border"
                >
                  {item.ready ? (
                    <Link
                      href={item.href}
                      className="flex items-center justify-between gap-4 rounded-lg p-4 transition-colors motion-reduce:transition-none hover:bg-foreground/5"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex items-center justify-between gap-4 p-4">
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
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
