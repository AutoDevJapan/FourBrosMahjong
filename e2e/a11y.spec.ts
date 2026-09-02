import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { advanceUntil, declareRiichi } from "./helpers/gameDriver";
import {
  LANDMARK_RULES,
  LANDMARK_SCREENS,
  SCREENS,
  type Screen,
} from "./screens";

/**
 * 自動アクセシビリティ監査 E2E(スペック5 5.5 / #70)。
 *
 * spec 5 5.5 は `@axe-core/playwright` による自動 a11y 監査を「主要画面の
 * アクセシビリティ違反を自動検知するシナリオ」として必須化している。本ファイルは
 * 実装済みの全画面(`/`・`/rules`・`/settings`・`/history`・`/game`・`/game/result`)に
 * 対して axe-core を実行し、WCAG 2.1 A/AA の重大違反ゼロを検証する。
 * ランドマーク監査(#409)だけは 404 を加えた 7 画面で回す(`LANDMARK_SCREENS`)。
 *
 * ダークモード(スペック5 5.4 / 5.5「ダークモードシナリオ」):
 * 各画面をライト・OS ダーク(`prefers-color-scheme: dark`)・手動ダーク
 * (`<html data-theme="dark">`)の 3 テーマで監査し、配色トークン(`globals.css`)の
 * ライト/ダーク双方が axe の `color-contrast`(WCAG 2.1 AA / 5.2.4)を満たすことを確認する。
 * 実対局を進める状態駆動監査(#148/#159/#261)は `STATE_DRIVEN_THEMES` の 2 テーマに
 * 統一する(方針の根拠は定数の doc コメントを参照 / #271)。
 *
 * axe のルールセットは WCAG 2.0/2.1 の A・AA タグに限定する(spec 5.2.4 の最低ライン)。
 * `disableRules` による全体無効化は行わない。現状は全画面・全ノードを無除外で監査している
 * (`/game` の OpponentHand / issue #73 は src 側で修正済みのため除外を撤去した)。既知の src 側
 * バグでスコープ外のものが再び出た場合のみ、理由と追跡 issue を明記して該当ノードを個別に
 * `.exclude()` する(`Screen.axeExclude`)。
 */

/** 監査対象の WCAG タグ(A・AA / 2.0・2.1)。spec 5.2.4 の最低ライン AA を含む。 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const;

type Theme = "ライト" | "OSダーク" | "手動ダーク";

const THEMES: readonly Theme[] = ["ライト", "OSダーク", "手動ダーク"];

/**
 * 状態駆動監査(#148/#159/#261)で共用するテーマ集合(#271 で統一)。
 *
 * 実対局を進める状態駆動シナリオは1件あたりの実行コストが高いため、配色トークン
 * (`globals.css`)のライト/ダーク双方を突く最小構成としてライト・手動ダークの
 * 2 テーマに統一する。OS ダーク(`prefers-color-scheme: dark`)は手動ダークと同一の
 * 配色トークンを共有するため配色検証としては重複であり、OS ダーク経路の適用確認
 * 自体は静的な全画面監査(`THEMES` の 3 テーマ)が担保済みなので省く。
 */
const STATE_DRIVEN_THEMES = [
  "ライト",
  "手動ダーク",
] as const satisfies readonly Theme[];

/** `AxeBuilder.analyze()` が返す違反配列の型(失敗メッセージ整形の引数用)。 */
type AxeViolations = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"];

/** axe 違反を rule id・impact・該当要素付きの読みやすい文字列へ整形する(失敗時の原因追跡用)。 */
function formatViolations(violations: AxeViolations): string {
  return violations
    .map(
      (v) =>
        `${v.id}(${v.impact}): ${v.help} [${v.nodes
          .map((n) => n.target.join(" "))
          .join(", ")}]`,
    )
    .join("\n");
}

/** ページ全体へ axe(WCAG 2.1 A/AA)を実行し違反ゼロを検証する(状態駆動監査で共用)。 */
async function auditPage(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags([...WCAG_TAGS])
    .analyze();
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
}

/**
 * 指定テーマで画面を開く。
 * - OSダーク: `prefers-color-scheme: dark` をエミュレート(未選択=OS 追従の経路)。
 * - 手動ダーク: `localStorage.theme="dark"` を先に仕込み、`layout.tsx` の初期化スクリプトに
 *   `<html data-theme="dark">` を適用させる(ThemeToggle 手動選択と同じ経路)。
 */
async function openScreen(
  page: Page,
  screen: Screen,
  theme: Theme,
  // 省略時のみ `screen.baseQuery` を使う。`""` を明示した呼び出しは「クエリ無し」の意味に
  // なるよう既定値を置かない(`||` だと空文字が既定へ差し替わってしまう)。
  query?: string,
): Promise<void> {
  if (theme === "OSダーク") {
    await page.emulateMedia({ colorScheme: "dark" });
  } else if (theme === "手動ダーク") {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("theme", "dark");
      } catch {
        // localStorage 不可環境ではダーク適用を諦める(監査はライト相当で走る)。
      }
    });
  }

  await page.goto(screen.path + (query ?? screen.baseQuery ?? ""));
  await expect(
    page.getByRole("heading", { level: 1, name: screen.heading }),
  ).toBeVisible();
  // `heading` は SSR 済みの殻に載るため hydration 前でも可視になる。クライアント
  // アイランドの描画完了はここで待たないと、**本文がプレースホルダのまま監査**され得る
  // (本番ビルドの `/game` の SSR HTML は `<h1>` と「対局を準備しています…」を含む一方
  // `data-phase` を含まないことを実測)。全呼び出し元へ効くようここで待つ。
  if (screen.clientReady) {
    await expect(screen.clientReady(page)).toBeAttached();
  }

  // 手動ダークは data-theme 適用経路が実際に効いていることを確認してから監査する。
  if (theme === "手動ダーク") {
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  }
}

test.describe("自動 a11y 監査(axe-core)", () => {
  for (const screen of SCREENS) {
    for (const theme of THEMES) {
      test(`${screen.name}(${screen.path})は WCAG 2.1 A/AA 違反ゼロ [${theme}]`, async ({
        page,
      }) => {
        await openScreen(page, screen, theme);

        let builder = new AxeBuilder({ page }).withTags([...WCAG_TAGS]);
        for (const selector of screen.axeExclude ?? []) {
          builder = builder.exclude(selector);
        }
        const results = await builder.analyze();

        // 違反があれば rule id と該当要素をメッセージに載せ、原因追跡を容易にする。
        expect(
          results.violations,
          formatViolations(results.violations),
        ).toEqual([]);
      });
    }
  }

  /**
   * ランドマーク構造(#409)。
   *
   * `LANDMARK_RULES` の 3 つはいずれも axe の **`best-practice` タグ**に属し、`WCAG_TAGS`
   * (A/AA)だけを渡している上の全画面監査には**一切入らない**。そのため `/game` と
   * `/game/result` だけ `<main>` を持たず、盤面・結果本文がランドマーク外に取り残されていた
   * のに、`disableRules` を使っていないのに素通りしていた。
   *
   * ルールの分担と `toHaveCount(1)` との併用が必須な理由は `e2e/screens.ts` の
   * `LANDMARK_RULES` の doc コメント(spec 5.2.6 の表と対応)を参照。
   *
   * 上の A/AA 監査と違い `screen.axeExclude` は**意図的に適用しない**。ランドマーク構造は
   * ページ全体の性質(`<main>` の個数 / 全コンテンツがランドマークに属するか)なので、
   * 一部ノードを外すと検査の意味が変わってしまう。個別の a11y バグを避けるための除外を
   * ここへ効かせたくなった場合は、除外ではなく構造側を直すこと。
   */
  for (const screen of LANDMARK_SCREENS) {
    test(`${screen.name}(${screen.path})は本文が単一の <main> に収まり <h1> を内側に持つ(#409 / #431)`, async ({
      page,
    }) => {
      await openScreen(page, screen, "ライト");

      // `<main>` はちょうど 1 つ(0 個=ランドマーク無し / 2 個以上=どれが本文か曖昧)。
      // このロケータは `<div role="main">` を数えないため、`role` 属性だけで代替した形は
      // ここが 0 件で落ちる(axe の 3 ルールはその形を通してしまう)。
      await expect(page.locator("main")).toHaveCount(1);

      // ページヘッダー(`<h1>` を含む)は `<main>` の内側(spec 5.2.6 / #431)。外へ出すと
      // `<header>` が banner ランドマークになり、ルートごとにランドマーク構成が割れる。
      // axe の `region` は banner も「ランドマークに属する」と認めるため、この規約は
      // `LANDMARK_RULES` では強制できない(#409 の時点で内外が割れていた理由)。
      //
      // 主ゲートは `src/test/a11y-heading-placement.test.tsx`(全ルート + 404 を jsdom で
      // 数秒で回す)。ここが足すのは**実 DOM**での確認 — SSR + hydration + レイアウト +
      // 実 CSS を通った最終的な木を見る。判定アルゴリズムの独立検証ではない
      // (`getByRole` はブラウザの AX ツリーではなく Playwright 自前の `computeAriaRole` を
      // 注入して評価しており、主ゲートの判定式はその実装を写している)。
      //
      // banner 0 個は「現状サイト共通ヘッダーが無い」ことの裏返しでもある。将来
      // `src/app/layout.tsx` へ共通ヘッダーを置く場合は、ここを 0 個から**ちょうど 1 つ**へ
      // 更新する(spec 5.2.6: banner は 1 ページに 1 つ)。ページ側の `<header>` を外へ
      // 戻す変更は、そのときも引き続きこの行と `main h1` が落とす。
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("main h1")).toHaveCount(1);
      await expect(page.getByRole("banner")).toHaveCount(0);

      const results = await new AxeBuilder({ page })
        .withRules([...LANDMARK_RULES])
        .analyze();
      expect(results.violations, formatViolations(results.violations)).toEqual(
        [],
      );
    });
  }

  test("卓情報の generic 要素を aria-label で命名しない(#204)", async ({
    page,
  }) => {
    await page.goto("/game?seed=0");
    await expect(page.getByTestId("dice-info").first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('[data-testid="dice-info"]')
      .include('[data-testid="remaining-live-tiles"]')
      .analyze();
    const prohibited = [...results.violations, ...results.incomplete].filter(
      (result) => result.id === "aria-prohibited-attr",
    );

    expect(prohibited, formatViolations(prohibited)).toEqual([]);
  });
});

/**
 * 状態駆動 a11y 監査(#148 項目3: カバレッジギャップの補完)。
 *
 * 既定の自動監査は初期局面・幅 1280px のみを走査するため、狭幅(卓の描画幅 < 360px)で現れる
 * 「自分手番フォーカス表示」のコンパクト帯レイアウトと、そこから開く全体盤面モーダル
 * (`role="dialog"`)の展開状態が未走査だった。ここでは狭幅ビューポートで /game を開き、
 * コンパクト帯そのものとモーダル展開状態を axe で監査する。テーマは状態駆動監査の
 * 共通方針 `STATE_DRIVEN_THEMES`(ライト・手動ダークの 2 テーマ / #271)に従う。
 */
test.describe("状態駆動 a11y 監査(狭幅・モーダル / #148)", () => {
  // 卓の描画幅 < 360px(段階②)を確実に踏むための狭幅ビューポート。
  const NARROW = { width: 320, height: 800 } as const;
  const gameScreen = SCREENS.find((s) => s.path === "/game");
  if (gameScreen === undefined) throw new Error("SCREENS に /game がない");

  for (const theme of STATE_DRIVEN_THEMES) {
    test(`/game 狭幅のコンパクト帯と全体盤面モーダルは WCAG 2.1 A/AA 違反ゼロ [${theme}]`, async ({
      page,
    }) => {
      await page.setViewportSize(NARROW);
      await openScreen(page, gameScreen, theme);

      // 段階②に入ると「自分手番フォーカス表示」帯と「全体盤面」ボタンが現れる。
      const openButton = page.getByRole("button", { name: "全体盤面" });
      await expect(openButton).toBeVisible();

      // (1) コンパクト帯レイアウト(モーダル閉)を監査する。
      const compact = await new AxeBuilder({ page })
        .withTags([...WCAG_TAGS])
        .analyze();
      expect(compact.violations, formatViolations(compact.violations)).toEqual(
        [],
      );

      // (2) 全体盤面モーダル(role="dialog")の展開状態を監査する。
      await openButton.click();
      await expect(
        page.getByRole("dialog", { name: "全体盤面" }),
      ).toBeVisible();
      const modal = await new AxeBuilder({ page })
        .withTags([...WCAG_TAGS])
        .analyze();
      expect(modal.violations, formatViolations(modal.violations)).toEqual([]);
    });
  }

  test("モーダル中はPortal外のページ全体を隔離し、外部フォーカスを回収・復元する(#252)", async ({
    page,
  }) => {
    await page.setViewportSize(NARROW);
    await openScreen(page, gameScreen, "ライト", "?seed=0");
    const openButton = page.getByRole("button", { name: "全体盤面" });
    await openButton.focus();
    await openButton.press("Enter");

    const dialog = page.getByRole("dialog", { name: "全体盤面" });
    await expect(dialog).toBeFocused();
    const backgroundLink = page.locator('a[href="/"]');
    await expect(backgroundLink).not.toHaveAttribute("tabindex");
    expect(
      await backgroundLink.evaluate((link) => {
        const pageRoot = Array.from(document.body.children).find((child) =>
          child.contains(link),
        );
        return {
          inert: pageRoot?.hasAttribute("inert"),
          ariaHidden: pageRoot?.getAttribute("aria-hidden"),
        };
      }),
    ).toEqual({ inert: true, ariaHidden: "true" });

    // 支援技術やスクリプトが背景へ直接 focus() しても dialog へ即時回収される。
    await backgroundLink.evaluate((link: HTMLElement) => link.focus());
    await expect(dialog).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(openButton).toBeFocused();
    expect(
      await backgroundLink.evaluate((link) => {
        const pageRoot = Array.from(document.body.children).find((child) =>
          child.contains(link),
        );
        return {
          inert: pageRoot?.hasAttribute("inert"),
          ariaHidden: pageRoot?.getAttribute("aria-hidden"),
        };
      }),
    ).toEqual({ inert: false, ariaHidden: null });
  });

  test("強制色・reduced-motionでも閲覧専用モーダルは静的listでaxe違反ゼロ(#187)", async ({
    page,
  }) => {
    await page.setViewportSize(NARROW);
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await openScreen(page, gameScreen, "ライト", "?seed=1");
    await page.getByRole("button", { name: "全体盤面" }).click();

    const dialog = page.getByRole("dialog", { name: "全体盤面" });
    await expect(
      dialog.getByRole("list", { name: "自家の手牌" }),
    ).toBeVisible();
    await expect(dialog.getByRole("listbox")).toHaveCount(0);
    await expect(dialog.getByRole("option")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          matchMedia("(forced-colors: active)").matches &&
          matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);

    const results = await new AxeBuilder({ page })
      .withTags([...WCAG_TAGS])
      // forced-colorsではUAが描画色を置換する一方、axeは置換前後を混在させて
      // 白地に元の白文字(1.05:1)と誤判定する。通常色のcontrastは上の監査で担保し、
      // ここでは強制色時の構造・名前・ロールを無除外で監査する。
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations, formatViolations(results.violations)).toEqual(
      [],
    );
  });

  test("reduced-motionでは対局操作のトランジションを無効化する(#364)", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openScreen(page, gameScreen, "ライト", "?seed=1");

    const handTile = page.getByRole("option").first();
    const action = page.getByRole("button", { name: "ツモ" }).first();
    await expect(handTile).toBeVisible();
    await expect(action).toBeVisible();

    for (const target of [handTile, action]) {
      await expect
        .poll(() =>
          target.evaluate((element) =>
            getComputedStyle(element)
              .transitionDuration.split(",")
              .map((duration) => duration.trim()),
          ),
        )
        .toEqual(["0s"]);
    }

    // 動きを止めても、キーボードの現在位置は専用アウトラインで判別できる。
    await handTile.focus();
    expect(
      await handTile.evaluate(
        (element) => getComputedStyle(element).outlineStyle,
      ),
    ).not.toBe("none");

    // ツモ/差替後の新規牌も即時に表示し、トランジションを残さない。表示スナップショット
    // だけでは通常の「打牌+次のツモ」と北抜き/カンの差替を区別できないため、どちらの
    // 一枚入場cueも対象にする。seed=4 は先頭牌の打牌から更新へ進む決定的な経路である。
    await openScreen(page, gameScreen, "ライト", "?seed=4");
    const reducedHand = page
      .getByRole("listbox", { name: "自家の手牌" })
      .filter({ visible: true })
      .first();
    await reducedHand.getByRole("option").first().click();
    const reducedHandEntrance = page
      .locator(
        '[data-hand-animation="draw"], [data-hand-animation="replacement"]',
      )
      .filter({ visible: true })
      .first();
    await expect(reducedHandEntrance).toBeVisible();
    await expect
      .poll(() =>
        reducedHandEntrance.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            opacity: style.opacity,
            transitionDuration: style.transitionDuration,
            transitionProperty: style.transitionProperty,
            animationName: style.animationName,
          };
        }),
      )
      .toEqual({
        opacity: "1",
        transitionDuration: "0s",
        transitionProperty: "none",
        animationName: "none",
      });

    // イベントcueも動かさずに表示し、意味のある文言は aria-hidden の装飾ではなく
    // live region 側で通知されることを確認する。
    await openScreen(page, gameScreen, "ライト", "?seed=1");
    await advanceUntil(
      page,
      async () =>
        (await page.locator('[data-testid="effect-overlay"]').count()) > 0,
      { maxSteps: 600 },
    );
    const reducedOverlay = page
      .locator('[data-testid="effect-overlay"]')
      .filter({ visible: true });
    await expect(reducedOverlay).toBeVisible();
    await expect(reducedOverlay).toHaveAttribute("aria-hidden", "true");
    await expect(reducedOverlay).toHaveCSS("pointer-events", "none");
    const reducedAnimatedCue = reducedOverlay.locator(":scope > div");
    await expect
      .poll(() =>
        reducedAnimatedCue.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            animationName: style.animationName,
            animationDuration: style.animationDuration,
            transitionDuration: style.transitionDuration,
            transitionProperty: style.transitionProperty,
          };
        }),
      )
      .toEqual({
        animationName: "none",
        animationDuration: "1e-05s",
        transitionDuration: "0s",
        transitionProperty: "none",
      });

    const reducedCueDetail = await reducedOverlay.evaluate(
      (element) =>
        element
          .querySelector<HTMLElement>(
            ":scope > div > span:nth-of-type(2) > span:nth-of-type(2)",
          )
          ?.textContent?.trim() ?? "",
    );
    if (reducedCueDetail) {
      await expect(
        page
          .locator('[aria-live="polite"], [role="alert"]')
          .filter({ hasText: reducedCueDetail }),
      ).toHaveCount(1);
    }
  });

  test("通常時はツモ牌とイベントcueの動きを表示し、cueの文言をlive regionへ渡す", async ({
    page,
  }) => {
    // HandTileAnimation の入場トランジションが、reduced-motion の全体停止規則で
    // 常時無効化されていないことを確認する。
    await openScreen(page, gameScreen, "ライト", "?seed=4");
    const hand = page
      .getByRole("listbox", { name: "自家の手牌" })
      .filter({ visible: true })
      .first();
    await hand.getByRole("option").first().click();
    const handEntrance = page
      .locator(
        '[data-hand-animation="draw"], [data-hand-animation="replacement"]',
      )
      .filter({ visible: true })
      .first();
    await expect(handEntrance).toBeVisible();
    await expect
      .poll(() =>
        handEntrance.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            transitionDuration: style.transitionDuration,
            animatesOpacity: style.transitionProperty.includes("opacity"),
          };
        }),
      )
      .toEqual({
        transitionDuration: "0.2s",
        animatesOpacity: true,
      });

    // seed=1 は決定的なイベント状態を生む。演出は装飾として隠し、同じ詳細文を
    // polite/assertive のいずれかの live region で利用者へ伝える。
    await openScreen(page, gameScreen, "ライト", "?seed=1");
    await advanceUntil(
      page,
      async () =>
        (await page.locator('[data-testid="effect-overlay"]').count()) > 0,
      { maxSteps: 600 },
    );
    const overlay = page
      .locator('[data-testid="effect-overlay"]')
      .filter({ visible: true });
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute("aria-hidden", "true");
    await expect(overlay).toHaveCSS("pointer-events", "none");
    await expect(overlay.locator(":scope > div")).toHaveCSS(
      "animation-name",
      "pulse",
    );
    await expect(overlay.locator(":scope > div")).toHaveCSS(
      "animation-duration",
      "2s",
    );

    const cueDetail = await overlay.evaluate(
      (element) =>
        element
          .querySelector<HTMLElement>(
            ":scope > div > span:nth-of-type(2) > span:nth-of-type(2)",
          )
          ?.textContent?.trim() ?? "",
    );
    if (cueDetail) {
      await expect(
        page
          .locator('[aria-live="polite"], [role="alert"]')
          .filter({ hasText: cueDetail }),
      ).toHaveCount(1);
    }
  });

  test("同じ二次polite cueでも別eventならスクリーンリーダー用子ノードを交換する(#803)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openScreen(page, gameScreen, "ライト", "?seed=1");

    // React keyそのものはDOMへ公開されないため、実ブラウザ上の同一要素identityを
    // WeakMapで観測する。視覚cueのDOMやゲーム状態へテスト用属性は追加しない。
    await page.evaluate(() => {
      type SecondaryLiveRegionState = {
        nextId: number;
        nodeIds: WeakMap<Element, number>;
      };
      type TestWindow = Window & {
        __secondaryLiveRegionState?: SecondaryLiveRegionState;
      };
      (window as TestWindow).__secondaryLiveRegionState = {
        nextId: 0,
        nodeIds: new WeakMap<Element, number>(),
      };
    });

    const seen = new Map<string, { effectKey: string; nodeId: number }>();
    type RepeatedCue = {
      message: string;
      previousNodeId: number;
      currentNodeId: number;
    };
    const repeatedCue = { value: null as RepeatedCue | null };

    await advanceUntil(
      page,
      async () => {
        const sample = await page.evaluate(() => {
          type SecondaryLiveRegionState = {
            nextId: number;
            nodeIds: WeakMap<Element, number>;
          };
          type TestWindow = Window & {
            __secondaryLiveRegionState?: SecondaryLiveRegionState;
          };
          const testWindow = window as TestWindow;
          const state = testWindow.__secondaryLiveRegionState;
          const region = document.querySelectorAll<HTMLElement>(
            '.sr-only[aria-live="polite"]',
          )[1];
          const overlay = document.querySelector<HTMLElement>(
            '[data-testid="effect-overlay"]',
          );
          const child = region?.firstElementChild;
          const effectKey = overlay?.getAttribute("data-effect-key") ?? "";
          const message = region?.textContent?.trim() ?? "";
          if (
            !state ||
            region === undefined ||
            child === null ||
            effectKey === "" ||
            message === ""
          ) {
            return null;
          }
          let nodeId = state.nodeIds.get(child);
          if (nodeId === undefined) {
            nodeId = state.nextId;
            state.nextId += 1;
            state.nodeIds.set(child, nodeId);
          }
          return { effectKey, message, nodeId };
        });
        if (sample === null) return false;

        const previous = seen.get(sample.message);
        if (previous && previous.effectKey !== sample.effectKey) {
          repeatedCue.value = {
            message: sample.message,
            previousNodeId: previous.nodeId,
            currentNodeId: sample.nodeId,
          };
          return true;
        }
        seen.set(sample.message, {
          effectKey: sample.effectKey,
          nodeId: sample.nodeId,
        });
        return false;
      },
      { maxSteps: 600 },
    );

    expect(repeatedCue.value).not.toBeNull();
    const duplicate = repeatedCue.value;
    if (duplicate === null)
      throw new Error("同じ二次polite cueを検出できなかった");
    expect(duplicate.currentNodeId).not.toBe(duplicate.previousNodeId);
  });
});

/**
 * 状態駆動 a11y 監査(局面依存の動的描画 / #159)。
 *
 * 既定の自動監査(初期局面)と #148 の狭幅/モーダル監査は、対局を**進めて**初めて DOM に
 * 現れる局面依存の描画 — リーチ宣言バッジ(`StatusBadge variant="riichi"`)・鳴き副露
 * (`Melds` の `aria-label="副露"`)・和了/流局の `role="alert"` 通知と点差表示(`ScoreDisplay`
 * の `--danger` / `--positive` デルタ)— を走査できていなかった。ここでは実対局エンジンを
 * **決定的 seed**(`/game?seed=…`)で固定し、各動的状態を実際に描画させた状態で axe を回す。
 *
 * 補足(点差表示の監査範囲): `ScoreDisplay` の色付き数値(`--danger`/`--positive`)は装飾扱いで
 * `aria-hidden` のため axe の `color-contrast` 対象外であり、意味は色非依存の `sr-only` テキスト
 * (「マイナス〇点」等)が担う(スペック5 5.2.1)。本シナリオは点差を伴う roundEnd 状態を実描画して
 * `role="alert"` 通知・強調ボタン・周辺 DOM を axe で監査し、点差表示が色非依存で描かれることを
 * `sr-only` テキストの存在で確認する(色そのもののコントラスト検証は axe の走査範囲に依存する)。
 *
 * 到達手段(設計判断): これらの状態は乱数依存で、通常の `createGame()` では現れる局面・タイミングが
 * 非決定的なため、E2E から安定して踏めない。そこで `GameProvider` が既に持つ決定的再現フック
 * (`?seed`)を使い、AI・壁が固定された半荘を実際に**プレイして**目的の DOM を出現させる
 * (状態を捏造せず本番の描画経路を通す)。seed は本番導線(クエリ無しの `/game`)では発火せず、
 * 盤面の牌列を固定するだけで席割り・進行規則・UI 分岐は一切変えない(本番挙動不変)。
 *
 * テーマは状態駆動監査の共通方針 `STATE_DRIVEN_THEMES`(ライト・手動ダークの 2 テーマ /
 * #271)に従う(OS ダークの配色は手動ダークと同一トークンのため省く)。
 */
test.describe("状態駆動 a11y 監査(リーチ/鳴き/和了アラート/トビ / #159)", () => {
  const gameScreen = SCREENS.find((s) => s.path === "/game");
  if (gameScreen === undefined) throw new Error("SCREENS に /game がない");

  // 決定的再現 seed(オフラインで engine を「先頭牌打牌+可能ならリーチ/ポン」の DOM ドライバと
  // 同一戦略で走査して選定。同じ seed + 同じ操作列は完全再現するため局面到達は決定的)。
  // ドライバ戦略の唯一の実装は `e2e/helpers/gameDriver.ts`(#260)で、本ファイルの seed は
  // そこに明記された標準戦略(先頭牌打牌・スルー/ポン優先・次局送り)を前提とする:
  // - RIICHI: 自家(起家=東家)が序盤の自手番で門前テンパイし、数手でリーチ宣言できる半荘。
  // - MELD  : 自家が序盤の他家打牌をポンして副露が卓に出る半荘。
  // - RESULT: 素点移動のある和了で1局目が終わり、`role="alert"` と点差表示が出る半荘。
  //
  // 保守メモ: これらの seed と各ドライバの探索上限(60/400/800)は engine/AI の打牌ロジックに依存する。
  // engine を変更して目的局面へ到達しなくなった場合は、gameDriver.ts 記載の手順どおり同一戦略の
  // オフライン走査で seed を再選定すること(到達失敗は advanceUntil の明示エラーか末尾の
  // toBeVisible/属性アサーションで顕在化し、誤 pass にはならない)。
  // SEED_MELD と SEED_RESULT が同一(1)なのは、ドライバ戦略が異なり別局面に至るため意図的。
  const SEED_RIICHI = 381;
  const SEED_MELD = 1;
  const SEED_RESULT = 1;

  for (const theme of STATE_DRIVEN_THEMES) {
    test(`リーチ宣言バッジが描画された状態で WCAG 2.1 A/AA 違反ゼロ [${theme}]`, async ({
      page,
    }) => {
      await openScreen(page, gameScreen, theme, `?seed=${SEED_RIICHI}`);

      // リーチ宣言バッジ(variant="riichi")は安定したテスト用アンカー(#162)で特定する。
      // 操作パネルの「リーチ」ボタンは testid を持たないため、表示テキスト部分一致に依存せず
      // バッジのみを一意に掴める(レイアウト変更に対して堅牢)。自家スロット(section)へ
      // 限定し、監査対象が自家バッジであることを明示する。
      const riichiBadge = page
        .getByRole("region", { name: /^粗悪品/ })
        .getByTestId("status-badge-riichi");

      // 標準戦略で進め、「リーチ」ボタンが出た手番で武装 →「リーチ可」の牌で宣言する。
      // seed 固定によりこの半荘は数手でリーチ可能局面へ決定的に到達する。
      await declareRiichi(page);

      // リーチ宣言バッジ(variant="riichi")が自家スロットに描画された状態を監査する。
      await expect(riichiBadge.first()).toBeVisible();
      await auditPage(page);
    });

    test(`鳴き副露が描画された状態で WCAG 2.1 A/AA 違反ゼロ [${theme}]`, async ({
      page,
    }) => {
      await openScreen(page, gameScreen, theme, `?seed=${SEED_MELD}`);

      // 副露(ポン/カン)の卓表示は `Melds` の `<ul aria-label="副露">`(role=list)。
      const melds = page.getByRole("list", { name: "副露" });

      // 自家は先頭牌で進め、鳴ける場面ではポン/カンする。AIの自動鳴きも含め、最初に
      // 実対局経路で副露が現れた時点で停止して監査する(issue #169)。
      await advanceUntil(page, async () => (await melds.count()) > 0, {
        maxSteps: 400,
        onHumanReact: "ponOrKan",
      });

      // 副露が卓に描画された状態を監査する。
      await expect(melds.first()).toBeVisible();
      await auditPage(page);
    });

    test(`和了の役表示(role="alert")と --danger 点差が描画された状態で WCAG 2.1 A/AA 違反ゼロ [${theme}]`, async ({
      page,
    }) => {
      await openScreen(page, gameScreen, theme, `?seed=${SEED_RESULT}`);

      const board = page.locator("[data-phase]").first();
      // 自家は打牌(先頭牌)・ロン/鳴きは見送り(スルー)で進め、素点移動のある決着(マイナス点差)
      // を伴う局終了(roundEnd)まで到達させる。点差ゼロの流局が来たら次局へ進めて続行する。
      // 目的局面前に半荘が終わる想定外(gameEnd)も停止し、直後の roundEnd アサーションで顕在化させる。
      await advanceUntil(
        page,
        async (state) =>
          state?.phase === "gameEnd" ||
          (state?.phase === "roundEnd" &&
            (await page.getByText(/マイナス/).count()) > 0),
        { maxSteps: 800 },
      );

      // 局終了の決着通知が `role="alert"`(assertive ライブリージョン)へ入る。
      await expect(board).toHaveAttribute("data-phase", "roundEnd");
      await expect(page.getByRole("alert").first()).not.toHaveText("");
      // 点差の減少(`--danger`)が色のみに依存せず `sr-only` テキストで併記されている
      // (スペック5 5.2.1)。色付き数値自体は `aria-hidden` の装飾のため、意味はこのテキストが担う。
      await expect(page.getByText(/マイナス/).first()).toBeAttached();
      await auditPage(page);
    });
  }
});

/**
 * 状態駆動 a11y 監査(裏ドラ開示 / #261)。
 *
 * 裏ドラ表示牌は自家リーチ和了の局終了時にのみ開示され、#159 の各シナリオ(リーチ宣言・
 * 副露・和了アラート)ではこの画面状態を走査できていなかった。ここでは決定的 seed で
 * 「自家がリーチ宣言 → そのまま和了」する半荘を実プレイし、裏ドラが開示された局終了
 * パネルを表示した状態で axe を回す。あわせて表ドラ/裏ドラが並び順ではなく**グループ名**
 * (`表ドラ表示牌` / `裏ドラ表示牌`)で判別できることを DOM 構造で検証する(スペック5 5.2.1)。
 *
 * seed 選定: gameDriver.ts 記載の標準戦略に「リーチ後はツモ和了優先・不可ならツモ切り、
 * 他家打牌へはロン優先(ronOrPass)」を加えた同一戦略で engine をオフライン走査して選定した。
 * seed=180 は1局目の数手で自家リーチ→ロン和了に決定的到達する。engine/AI 変更で到達しなく
 * なった場合は同一戦略のオフライン走査で再選定すること(到達失敗は advanceUntil の明示エラー
 * か末尾のアサーションで顕在化し、誤 pass にはならない)。
 *
 * テーマは状態駆動監査の共通方針 `STATE_DRIVEN_THEMES`(ライト・手動ダークの 2 テーマ /
 * #271)に従う。
 */
test.describe("状態駆動 a11y 監査(裏ドラ開示 / #261)", () => {
  const gameScreen = SCREENS.find((s) => s.path === "/game");
  if (gameScreen === undefined) throw new Error("SCREENS に /game がない");

  // 自家(起家)が1局目の序盤でリーチ宣言し、そのままロン和了する半荘(オフライン走査で選定)。
  const SEED_URA_WIN = 180;

  for (const theme of STATE_DRIVEN_THEMES) {
    test(`裏ドラ開示(自家リーチ和了)状態で表裏がグループ判別でき WCAG 2.1 A/AA 違反ゼロ [${theme}]`, async ({
      page,
    }) => {
      await openScreen(page, gameScreen, theme, `?seed=${SEED_URA_WIN}`);

      // 標準戦略で進めてリーチ宣言し、以降はドライバのリーチ後分岐(ツモ和了優先/ツモ切り)と
      // ロン優先(ronOrPass)で局終了まで進める。seed=180 は自家リーチ→ロン和了に決定的到達する。
      await declareRiichi(page);
      // predicate は各 step 冒頭で評価されるため、roundEnd 到達時点で停止する
      // (onRoundEnd 指定は不要 — 「次の局へ」を押す分岐には到達しない)。
      await advanceUntil(page, (state) => state?.phase === "roundEnd", {
        maxSteps: 200,
        onHumanReact: "ronOrPass",
      });

      // 自家リーチ和了(ロン)で局が終わり、裏ドラが開示されている。決着種別まで固定することで、
      // engine 変更で seed=180 が別決着(ツモ等)へ変わった場合にコメントごと陳腐化せず検知できる。
      const board = page.locator("[data-phase]").first();
      await expect(board).toHaveAttribute("data-phase", "roundEnd");
      await expect(board).toHaveAttribute("data-round-kind", "win");
      await expect(page.getByRole("alert").first()).toContainText(
        "粗悪品のロン",
      );
      await expect(page.getByText("裏ドラ開示").first()).toBeVisible();

      // 表/裏が並び順ではなくグループ名で判別できる(スペック5 5.2.1 / #261)。
      const omote = page
        .getByRole("list", { name: "表ドラ表示牌" })
        .filter({ visible: true })
        .first();
      const ura = page
        .getByRole("list", { name: "裏ドラ表示牌" })
        .filter({ visible: true })
        .first();
      await expect(omote).toBeVisible();
      await expect(ura).toBeVisible();
      // 開示済みの裏グループは伏せ牌ではなく実牌で構成される。
      await expect(ura.getByRole("img").first()).toBeVisible();
      await expect(ura.getByRole("img", { name: "伏せ牌" })).toHaveCount(0);

      // 裏ドラ開示状態のページ全体を axe(WCAG 2.1 A/AA)で監査する。
      await auditPage(page);
    });
  }
});

/**
 * キーボードのみ操作の E2E 補強(スペック5 5.2.2 / #70 受け入れ基準)。
 *
 * 既存 `game.spec.ts` はリーチボタンの Enter 起動と手牌の ArrowRight 移動を検証済み。
 * ここではそれと重複しない a11y 観点の穴 — `/settings` の radiogroup をマウス不使用で
 * 操作できること、`/game` の手牌選択(Enter で aria-selected 反映)・操作パネルの
 * Space 起動 — を埋める。
 */
test.describe("キーボードのみ操作(a11y 補強)", () => {
  test("/settings のテーマ選択が矢印キーだけで完結し data-theme に反映される(5.2.2)", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Tab で「ロビーへ戻る」→共通ナビゲーション→radiogroup の順に到達できる。
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "ロビーへ戻る" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("navigation", { name: "画面メニュー" }).locator("summary"),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    const systemRadio = page.getByRole("radio", { name: "システム設定に従う" });
    await expect(systemRadio).toBeFocused();
    await expect(systemRadio).toBeChecked();

    // #327: フォーカスを受ける radio だけにグローバルリングを描画し、
    // 外側 label には outline を追加しない。両方に描画すると二重リングが再発する。
    await expect
      .poll(async () =>
        systemRadio.evaluate((radio) => {
          const radioStyle = getComputedStyle(radio);
          const labelStyle = getComputedStyle(radio.closest("label")!);
          return {
            radioOutlineStyle: radioStyle.outlineStyle,
            radioOutlineWidth: radioStyle.outlineWidth,
            radioOutlineColor: radioStyle.outlineColor,
            focusRingColor: getComputedStyle(document.documentElement)
              .getPropertyValue("--focus-ring")
              .trim(),
            labelOutlineStyle: labelStyle.outlineStyle,
          };
        }),
      )
      .toEqual({
        radioOutlineStyle: "solid",
        radioOutlineWidth: "2px",
        radioOutlineColor: "rgb(29, 78, 216)",
        focusRingColor: "#1d4ed8",
        labelOutlineStyle: "none",
      });

    // 矢印キー移動でネイティブ radiogroup の選択が移り、選択が即 DOM に反映される(マウス不使用)。
    await page.keyboard.press("ArrowDown");
    const lightRadio = page.getByRole("radio", { name: "ライト" });
    await expect(lightRadio).toBeFocused();
    await expect(lightRadio).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.keyboard.press("ArrowDown");
    const darkRadio = page.getByRole("radio", { name: "ダーク" });
    await expect(darkRadio).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // 実効テーマの通知が色非依存のテキストで届く(5.2.3 の polite ライブリージョン)。
    // `/settings` には対局者名フォーム(#291)の polite 領域もあるため、テーマ側へ限定する。
    await expect(
      page
        .getByRole("group", { name: "テーマ(表示モード)" })
        .locator('[aria-live="polite"]'),
    ).toContainText("ダーク");
  });

  test("/game の手牌はキーボードのみで到達・打牌でき、ロービングタブインデックスに従う(5.2.2)", async ({
    page,
  }) => {
    // seed を固定する。`?seed` 無しだと `freshSeed()`(crypto 乱数)で配牌が決まり、下の
    // 打牌が局を終わらせる配牌を引いた回に手牌 listbox が消えて落ちる(30 回中 1 回で再現)。
    // ロービングタブインデックスの検証に配牌のばらつきは不要なので、他の実盤面テストと
    // 同じく seed を固定する(`Screen.baseQuery` と同じ方針)。
    await page.goto("/game?seed=0");

    const hand = page.getByRole("listbox", { name: "自家の手牌" });
    const firstTile: Locator = hand.getByRole("option").first();

    // ロービングタブインデックス: フォーカス中の option だけが Tab 到達可能(tabindex=0)。
    await firstTile.focus();
    await expect(firstTile).toHaveAttribute("tabindex", "0");

    // Enter で打牌でき、対局が進行する。手牌の DOM/key が更新されても実フォーカスを
    // active option に維持し、次の矢印操作を Tab なしで継続できる(#248)。
    await firstTile.press("Enter");
    const updatedHand = page.getByRole("listbox", { name: "自家の手牌" });
    await expect(updatedHand).toBeVisible();
    await expect(updatedHand.locator('[role="option"]:focus')).toHaveCount(1);
    await page.keyboard.press("ArrowRight");
    await expect(updatedHand.locator('[role="option"]:focus')).toHaveCount(1);
  });

  test("/game は手番をライブリージョンで通知し、打牌をキーボードのみで実行でき、復帰先の着地点が名前を持つ(5.2.2 / 5.2.3 / #405)", async ({
    page,
  }) => {
    // seed=4 は開始時に北抜候補がなく、通常の手番通知を決定的に検証できる。
    await page.goto("/game?seed=4");

    // 進行通知(色非依存)は polite ライブリージョンへ反映される(sr-only だが DOM 常駐)。
    await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
      "あなたの手番です。",
    );

    // 操作パネルはネイティブ button で構成される(APG のボタン要件)。ツモが局面上不可なら
    // disabled で伝わる(色ではなく状態)。打牌はキーボードのみで完結できる操作が本筋のため、
    // 手牌の現行 option をフォーカスして操作可能であることを検証する。
    await expect(page.getByRole("group", { name: "操作パネル" })).toBeVisible();
    // モーダル復帰先の着地点(盤面ルート)は名前付きの group として静的にも露出している
    // (5.2.2 / #405)。復帰の連鎖そのものは e2e/modal-focus.spec.ts が担保するので、
    // ここが足すのは「監査と同じ既定ビューポート・同じファイルで名前付き group が
    // /game に存在する」ことだけ。ランドマーク構造との共存は同ファイルの #409 の
    // ランドマーク監査テストが別途固定する。
    await expect(page.getByRole("group", { name: "対局盤面" })).toBeVisible();
    const activeOption = page
      .getByRole("listbox", { name: "自家の手牌" })
      .getByRole("option")
      .first();
    await activeOption.focus();
    await expect(activeOption).toBeFocused();
  });
});

/**
 * 状態駆動 a11y 監査(戦績の展開状態 / #293)。
 *
 * `SCREENS` の静的監査は保存ゼロ件の `/history`(空状態)しか走査しない。戦績一覧は
 * `<details>` で折りたたまれており、閉じたままの中身は axe の走査対象にならないため、
 * 実際に見出しレベル飛び(h1 → h3)を作り込んでも静的監査では検知できなかった。
 * ここでは戦績を1件仕込んだうえで、(1)一覧、(2)`<details>` 展開後の内訳、
 * (3)全件削除の確認 UI をそれぞれ監査し、展開状態のカバレッジ欠落を埋める。
 * テーマは状態駆動監査の共通方針 `STATE_DRIVEN_THEMES`(#271)に従う。
 */
test.describe("状態駆動 a11y 監査(戦績の展開状態 / #293)", () => {
  const historyScreen = SCREENS.find((s) => s.path === "/history");
  if (historyScreen === undefined)
    throw new Error("SCREENS に /history がない");

  /** 実 engine の確定結果と同形の妥当な戦績1件(保存形式 v1)。 */
  const storedHistory = JSON.stringify({
    version: 1,
    entries: [
      {
        seed: 1,
        finishedAt: 1_753_100_000_000,
        players: ["一郎", "二郎", "三郎", "四郎"].map((name, i) => ({
          name,
          rank: i + 1,
          rawScore: [23_000, 8_000, -11_000, -20_000][i],
          uma: [10_000, 5_000, -5_000, -10_000][i],
          bonus: 0,
          soshiiTotal: [33_000, 13_000, -16_000, -30_000][i],
        })),
      },
    ],
  });

  test("reduced-motionでは戦績の開閉矢印を即時に切り替える(#364)", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((raw) => {
      localStorage.setItem("four-bros-mahjong.history.v1", raw);
    }, storedHistory);
    await openScreen(page, historyScreen, "ライト");

    const details = page.locator("details").first();
    const arrow = details.locator("summary [aria-hidden='true']").first();
    await expect(arrow).toBeVisible();
    await expect
      .poll(() =>
        arrow.evaluate((element) =>
          getComputedStyle(element)
            .transitionDuration.split(",")
            .map((duration) => duration.trim()),
        ),
      )
      .toEqual(["0s"]);

    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
  });

  for (const theme of STATE_DRIVEN_THEMES) {
    test(`/history の一覧・展開内訳・削除確認は WCAG 2.1 A/AA 違反ゼロ [${theme}]`, async ({
      page,
    }) => {
      await page.addInitScript((raw) => {
        try {
          localStorage.setItem("four-bros-mahjong.history.v1", raw);
        } catch {
          // localStorage 不可環境では空状態のまま監査する。
        }
      }, storedHistory);
      await openScreen(page, historyScreen, theme);

      // (1) 保存済み1件の一覧(折りたたみ状態)。
      const list = page.getByRole("list", { name: "保存された半荘結果" });
      await expect(list.getByRole("listitem")).toHaveCount(1);
      await auditPage(page);

      // (2) <details> 展開後の内訳(最終順位テーブル + ソシー内訳の見出し階層)。
      await list.locator("summary").first().click();
      await expect(list.getByRole("table")).toBeVisible();
      await auditPage(page);

      // (3) 全件削除の2段階確認 UI。
      await page.getByRole("button", { name: "戦績をすべて削除" }).click();
      await expect(
        page.getByRole("button", { name: "削除する" }),
      ).toBeVisible();
      await auditPage(page);
    });
  }
});
