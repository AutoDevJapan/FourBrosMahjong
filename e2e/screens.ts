import type { Locator, Page } from "@playwright/test";

/**
 * a11y 監査の対象画面インベントリ(#409)。
 *
 * spec 5.2.6 の「**全ルート**は本文を単一の `<main>` に収める」を機械で強制するため、
 * `LANDMARK_SCREENS` は spec ファイルの外へ出してある。`*.spec.ts` はモジュール読み込み時に
 * `test()` を登録してしまうので Playwright ランナー外から import できず、一覧の網羅性を
 * 検査する側(`src/test/a11y-landmark-screens.test.ts`)が**ソースの文字列走査**に頼ることに
 * なる。文字列走査ではエントリをコメントアウトされても素通りするため、両者が同じ配列を
 * 参照できるようここへ置く。
 *
 * このモジュールは `import type` しか持たない(実行時依存ゼロ)ので、vitest からそのまま
 * import できる。ロケータは呼び出し時に `page` を受け取る関数として持たせている。
 */
export interface Screen {
  readonly path: string;
  readonly name: string;
  /** 描画完了の目印。監査前にこの要素の可視化を待ち、未ペイント状態での誤検知を避ける。 */
  readonly heading: string;
  /**
   * 監査から除外する CSS セレクタ(既知の src 側 a11y バグで、スコープ外のもの)。
   * 全ルール無効化は行わず、該当ノードだけを外して他は監査対象のまま残す。
   */
  readonly axeExclude?: readonly string[];
  /**
   * クライアントアイランドの描画完了を待つロケータ(#409)。
   *
   * `heading` は SSR 済みの殻に載るため **hydration 前でも可視**になる。そのため
   * `heading` の可視化だけでは**クライアント部分が未描画のまま**監査へ進み得る
   * (`/game` は `[data-phase]` が生えるまで「対局を準備しています…」のプレースホルダで、
   * 盤面の要素が 1 つも無い)。本文そのものが未描画だと**無音で pass** してしまう。
   *
   * **必ず正のアンカー**(hydration 後にだけ現れる要素)を指すこと。プレースホルダ文言の
   * 消失を待つ負のアンカーは、文言を変えた瞬間に最初から 0 件になって無音 pass するため、
   * ここで塞ぎたい欠陥と同型になる。
   *
   * 同じ設計は `e2e/non-text-contrast.spec.ts` の `Screen.ready` が先行して持っている。
   * 画面を足すときは両者を揃えること(片方だけに足すと監査の穴が非対称に残る)。
   * この手運用にゲートは無い — インベントリの一本化は #445 で扱う。
   */
  readonly clientReady?: (page: Page) => Locator;
  /**
   * `openScreen` が `query` を渡されなかったときに既定で付けるクエリ。
   *
   * `/game` は `?seed` を渡さないと `freshSeed()`(crypto 乱数)で配牌が決まる。`clientReady`
   * を入れて盤面が確実に描画されるようになった結果、静的監査は**毎回異なる配牌**を走査する
   * ようになった。再現不能な flake を避けるため、実盤面を監査する箇所は seed を固定する
   * (`non-text-contrast.spec.ts` も同じ理由で `/game?seed=0` を使う)。
   */
  readonly baseQuery?: string;
}

/** WCAG A/AA 監査(3 テーマ)とランドマーク監査の共通対象。実在ルートのみ。 */
export const SCREENS: readonly Screen[] = [
  { path: "/", name: "ロビー", heading: "四兄弟麻雀" },
  { path: "/rules", name: "ルール説明", heading: "ルール説明" },
  { path: "/settings", name: "設定", heading: "設定" },
  {
    path: "/history",
    name: "戦績",
    heading: "戦績",
    // `MatchHistoryList`(Client)の描画完了。空状態と一覧の**両分岐に共通**する文言を指す
    // (ヘッダのリンクはサーバ側の殻にあり待ちにならない)。
    clientReady: (page) =>
      page.getByText(/保存された戦績はまだありません|新しい順に表示/).first(),
  },
  {
    path: "/game",
    name: "対局画面",
    heading: "対局画面",
    clientReady: (page) => page.locator("[data-phase]").first(),
    baseQuery: "?seed=0",
  },
  {
    path: "/game/result",
    name: "対局結果",
    heading: "対局結果",
    // `ResultPageClient` の hydration 後は「未確定」「確定」に割れるため、両分岐の目印を
    // `or` で束ねる(「読み込み中」プレースホルダにはどちらも現れない)。
    clientReady: (page) =>
      page
        .getByRole("link", { name: "対局画面へ" })
        .or(page.getByRole("heading", { name: "最終順位" }))
        .first(),
  },
];

/**
 * `LANDMARK_SCREENS` 内で 404 エントリを識別する名前。
 * このエントリの `path` は実在ルートではない番兵なので、ルート網羅の検査
 * (`src/test/a11y-landmark-screens.test.ts`)はこの名前で除外する。
 */
export const NOT_FOUND_SCREEN_NAME = "404";

/**
 * ランドマーク監査(#409)の対象。実在ルートに加えて 404 も見る。
 * 404 は `not-found.tsx` という独立した実装で、`src/app/**\/page.tsx` を走査する
 * ルート網羅の検査(`src/test/a11y-landmark-screens.test.ts`)にも現れないため、
 * 他のルートの規約が波及しない。明示的に足さないと監査から丸ごと落ちる。
 *
 * 404 を `SCREENS` 側(WCAG A/AA 監査・3 テーマ)へは**意図的に入れていない**。#409 の
 * 範囲はランドマーク構造であり、404 の A/AA 違反まで同時に必須化すると切り分けが濁る。
 * 404 を全 a11y ゲートへ広げるかは別途判断する(現状 `non-text-contrast.spec.ts` も未対象)。
 */
export const LANDMARK_SCREENS: readonly Screen[] = [
  ...SCREENS,
  {
    // 実在しない番兵パス(どのルートにも一致しないので 404 が描画される)。
    path: "/no-such-page-409",
    name: NOT_FOUND_SCREEN_NAME,
    heading: "ページが見つかりません",
  },
];

/**
 * ランドマーク構造を固定する axe ルール(spec 5.2.6 / axe-core 4.12.1 で実測)。
 *
 * 3 つとも `best-practice` タグに属し、WCAG A/AA タグだけを `withTags` に渡している
 * 通常の監査には**一切入らない**。そのため `withRules` で明示的に有効化する。
 * 全 best-practice を A/AA と同列に必須化すると #409 の範囲を超えるので広げない。
 *
 * 分担(いずれか 1 つでは穴が空く):
 * - `landmark-one-main` は `page-has-main` チェック 1 つだけで、**main が 0 個**しか見ない。
 *   `<main>` + `<div role="main">` の重複は素通りする
 * - 重複は `landmark-no-duplicate-main` の担当
 * - `<div role="main">` **だけ**で代替した形は 3 ルールすべてが通る。これを落とせるのは
 *   `expect(page.locator("main")).toHaveCount(1)` だけなので、axe とロケータの併用が必須
 */
export const LANDMARK_RULES = [
  "landmark-one-main",
  "landmark-no-duplicate-main",
  "region",
] as const;
