import type { Metadata } from "next";
import Link from "next/link";

/**
 * ルール説明ページ(`/rules`)。
 *
 * スペック6(`documents/spec/screen-design-and-routing.md` 6.2/6.6節)で定義された
 * 閲覧専用の静的ページ。`docs/四兄弟麻雀ルール.md` に基づくルール要約を表示する。
 * 対話要素は持たず、折りたたみは HTML 標準の `<details>`/`<summary>` で実現する
 * ため **Server Component**(`"use client"` を付けない)として実装する。
 *
 * アクセシビリティ・レスポンシブ・ダークモードは
 * `documents/spec/ui-accessibility-responsive-darkmode.md`(スペック5)に従う:
 * 状態(折りたたみ開閉)は色ではなく `<summary>` の開閉マーカー(形状)で伝達し、
 * リンクは下線付き、フォーカスリングは `:focus-visible` で明示する。配色は
 * `globals.css` のトークン(`--background` / `--foreground`)経由で参照し、
 * ライト/ダーク双方に追従させる。
 *
 * 本文の文言はスペック6 6.11節に従い「要約」に留める(詳細なコンテンツ精緻化は
 * 別issueのスコープ)。
 */

export const metadata: Metadata = {
  // layout.tsx の title テンプレート `%s | 四兄弟麻雀` により
  // 「ルール説明 | 四兄弟麻雀」として出力される。
  title: "ルール説明",
  description:
    "四兄弟麻雀(関西式サンマ・四人回し)のルール要約。オール赤5・ガリ(北抜きドラ)・サイコロ連動ドラ・ソシー精算などの独自ルールを説明します。",
};

/** ルール要約の1セクション。`<details>` で折りたためる。 */
type RuleSection = {
  /** セクション見出し(`<summary>` に表示)。 */
  heading: string;
  /** 既定で開いた状態にするか(主要ルールは開き、補足は閉じる)。 */
  defaultOpen: boolean;
  /** 箇条書き項目。太字ラベルと本文に分けて色非依存で強調する。 */
  items: { label?: string; body: string }[];
};

/**
 * ルール要約データ(`docs/四兄弟麻雀ルール.md` の非公式まとめに基づく)。
 * 見出し構成: 基本形式 / 使用牌 / 進行 / 点数・ドラ / 精算・祝儀 / 名物要素。
 */
const ruleSections: RuleSection[] = [
  {
    heading: "1. 基本形式",
    defaultOpen: true,
    items: [
      {
        label: "三人打ち(サンマ)",
        body: "萬子の2〜8を抜いた三人麻雀を基本とする。関西式三人打ち(関西サンマ)に近いルール。",
      },
      {
        label: "四人回し",
        body: "メンバーは4人いるため、1人が抜け番になり交代で打つ「四人回し」で進行する。抜け番の人は休憩・観戦する。",
      },
      { label: "東南戦", body: "東場・南場で回す。" },
      {
        label: "ソシー",
        body: "金銭は賭けず、勝敗の可視化のために独自通貨「ソシー」を用いる。",
      },
    ],
  },
  {
    heading: "2. 使用牌・ドラ牌",
    defaultOpen: true,
    items: [
      {
        label: "牌構成",
        body: "萬子の2〜8を抜いた、三人打ち標準の牌構成。",
      },
      {
        label: "オール赤5",
        body: "5は各色すべて赤ドラ(5筒×4・5索×4の計8枚)。関西サンマ流の「オール赤5」。",
      },
      {
        label: "ガリ(北抜きドラ)",
        body: "北は抜きドラ「ガリ」として扱う。北をツモったら手牌から抜いて場に晒し嶺上牌を補充、和了時に抜いた枚数分がドラに加算される。",
      },
    ],
  },
  {
    heading: "3. 進行ルール",
    defaultOpen: false,
    items: [
      { label: "鳴き", body: "チー不可(三人打ちのためポン・カンのみ)。" },
      {
        label: "喰いタン・後付け",
        body: "なし(ナシナシ寄りの先付けルール)。喰い替えもなし。",
      },
      { label: "連荘", body: "東場・南場ともに親はテンパイで連荘。" },
      { label: "本場", body: "積み棒(本場)あり。" },
      {
        label: "供託・ダブロン",
        body: "リーチ棒は供託扱い。ダブロン等が発生した場合は上家取り。",
      },
      {
        label: "フリテンリーチ",
        body: "あり(ただしツモ和了のみ可)。",
      },
    ],
  },
  {
    heading: "4. 点数・ドラ(サイコロ連動)",
    defaultOpen: true,
    items: [
      {
        label: "符計算なし",
        body: "符計算は行わず、翻数ベースの簡易計算。",
      },
      {
        label: "ドラめくり(サイコロ連動)",
        body: "開門位置を決めるサイコロの出目で表ドラ枚数が変動する。通常の出目→表ドラ1枚、ゾロ目→2枚、6のゾロ目(6・6)のみ→3枚。リーチ時の裏ドラも同じ枚数分乗る。",
      },
      {
        label: "打点インフレ",
        body: "オール赤5・ガリ・複数ドラめくりが重なり、満貫以上の和了が頻発しやすい。",
      },
    ],
  },
  {
    heading: "5. 精算・祝儀(ソシー)",
    defaultOpen: true,
    items: [
      { label: "ウマ", body: "+10 / +5 / -5 / -10。" },
      {
        label: "役満祝儀",
        body: "全員から1000(ソシー換算)。先着1名のみ・数え役満は対象外。責任払い(パオ)あり。",
      },
      {
        label: "オーラス条件",
        body: "オーラスで親が3万点を超えてトップの場合はそこで終了(和了やめ・テンパイやめ相当)。",
      },
      { label: "チョンボ", body: "供託扱い(暫定運用)。" },
    ],
  },
  {
    heading: "6. 名物要素(ルール外)",
    defaultOpen: false,
    items: [
      {
        label: "開幕自己紹介",
        body: "毎回恒例の自己紹介(つかみ)が名物。",
      },
      {
        label: "24時間麻雀",
        body: "特別企画として24時間麻雀が複数回開催されている。",
      },
    ],
  },
];

export default function RulesPage() {
  return (
    <div className="flex min-h-screen flex-col items-center p-6 sm:p-12">
      <main className="flex w-full max-w-2xl flex-col gap-8">
        <nav aria-label="ページナビゲーション">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-foreground/70 underline underline-offset-4 hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <span aria-hidden>←</span> ロビーへ戻る
          </Link>
        </nav>

        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-bold sm:text-4xl">ルール説明</h1>
          <p className="text-sm/6 text-foreground/70">
            四兄弟麻雀は、関西式三人打ち(サンマ)をベースにした四人回しの麻雀です。
            オール赤5・ガリ(北抜きドラ)・サイコロ連動ドラなどの独自ルールを、
            以下の各項目にまとめています(見出しをクリック/Enter
            で開閉できます)。
          </p>
          <p className="rounded-md border border-foreground/15 bg-foreground/5 p-3 text-xs/5 text-foreground/70">
            本作は粗品 Official
            Channel「ギャンブル四兄弟」を題材にした非公式ファンメイド作品です。
            公式のルール表は公開されておらず、本ページは動画内の描写・出演者の発言・
            ファンによるまとめをもとに整理した非公式の要約です。
          </p>
        </header>

        <div className="flex flex-col gap-3">
          {ruleSections.map((section) => (
            <details
              key={section.heading}
              open={section.defaultOpen}
              className="rounded-lg border border-foreground/15"
            >
              <summary className="cursor-pointer rounded-lg px-4 py-3 font-medium marker:text-foreground/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
                {section.heading}
              </summary>
              <ul className="flex flex-col gap-2 px-4 pb-4 text-sm/6">
                {section.items.map((item) => (
                  <li key={item.body} className="text-foreground/90">
                    {item.label ? (
                      <span className="font-semibold text-foreground">
                        {item.label}:{" "}
                      </span>
                    ) : null}
                    {item.body}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>

        <p className="text-xs/5 text-foreground/60">
          出典: <code className="font-mono">docs/四兄弟麻雀ルール.md</code>
          (非公式まとめ)。収録回によって細部が変わる可能性があります。
        </p>

        <footer className="border-t border-foreground/15 pt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-foreground/70 underline underline-offset-4 hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <span aria-hidden>←</span> ロビーへ戻る
          </Link>
        </footer>
      </main>
    </div>
  );
}
