import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * 自動アクセシビリティ監査 E2E(スペック5 5.5 / #70)。
 *
 * spec 5 5.5 は `@axe-core/playwright` による自動 a11y 監査を「主要画面の
 * アクセシビリティ違反を自動検知するシナリオ」として必須化している。本ファイルは
 * 実装済みの全画面(`/`・`/rules`・`/settings`・`/game`・`/game/result`)に対して
 * axe-core を実行し、WCAG 2.1 A/AA の重大違反ゼロを検証する。
 *
 * ダークモード(スペック5 5.4 / 5.5「ダークモードシナリオ」):
 * 各画面をライト・OS ダーク(`prefers-color-scheme: dark`)・手動ダーク
 * (`<html data-theme="dark">`)の 3 テーマで監査し、配色トークン(`globals.css`)の
 * ライト/ダーク双方が axe の `color-contrast`(WCAG 2.1 AA / 5.2.4)を満たすことを確認する。
 *
 * axe のルールセットは WCAG 2.0/2.1 の A・AA タグに限定する(spec 5.2.4 の最低ライン)。
 * `disableRules` による全体無効化は行わない。既知の src 側バグでスコープ外のものだけ、理由と
 * 追跡 issue を明記して該当ノードを個別に `.exclude()` する(現状は `/game` の OpponentHand /
 * issue #73 の1件のみ)。
 */

/** 監査対象の WCAG タグ(A・AA / 2.0・2.1)。spec 5.2.4 の最低ライン AA を含む。 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const;

type Theme = "ライト" | "OSダーク" | "手動ダーク";

interface Screen {
  readonly path: string;
  readonly name: string;
  /** 描画完了の目印。監査前にこの要素の可視化を待ち、未ペイント状態での誤検知を避ける。 */
  readonly heading: string;
  /**
   * 監査から除外する CSS セレクタ(既知の src 側 a11y バグで、本 PR のスコープ外のもの)。
   * 全ルール無効化は行わず、該当ノードだけを外して他は監査対象のまま残す。
   */
  readonly axeExclude?: readonly string[];
}

const SCREENS: readonly Screen[] = [
  { path: "/", name: "ロビー", heading: "四兄弟麻雀" },
  { path: "/rules", name: "ルール説明", heading: "ルール説明" },
  { path: "/settings", name: "設定", heading: "設定" },
  {
    path: "/game",
    name: "対局画面",
    heading: "対局画面",
    // 他家の伏せ手牌 `OpponentHand` が role を持たない <div> に aria-label を付与しており
    // axe の aria-prohibited-attr(WCAG 4.1.2)に触れる。src 側の既知バグで本 PR のスコープ外
    // (e2e / 依存追加のみ)のため issue #73 で追跡し、当該ノードのみ監査から除外する。
    // #73 で src を修正したらこの除外を削除すること。
    axeExclude: ['[aria-label*="伏せ"]'],
  },
  { path: "/game/result", name: "対局結果", heading: "対局結果" },
];

const THEMES: readonly Theme[] = ["ライト", "OSダーク", "手動ダーク"];

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

  await page.goto(screen.path);
  await expect(
    page.getByRole("heading", { level: 1, name: screen.heading }),
  ).toBeVisible();

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
          results.violations
            .map(
              (v) =>
                `${v.id}(${v.impact}): ${v.help} [${v.nodes
                  .map((n) => n.target.join(" "))
                  .join(", ")}]`,
            )
            .join("\n"),
        ).toEqual([]);
      });
    }
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

    // Tab で「ロビーへ戻る」→ radiogroup の順に到達できる(フォーカス到達・操作可能性)。
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "ロビーへ戻る" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    const systemRadio = page.getByRole("radio", { name: "システム設定に従う" });
    await expect(systemRadio).toBeFocused();
    await expect(systemRadio).toBeChecked();

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
    await expect(page.locator('[aria-live="polite"]')).toContainText("ダーク");
  });

  test("/game の手牌は Enter で打牌候補を選択でき aria-selected が反映される(5.2.2)", async ({
    page,
  }) => {
    await page.goto("/game");

    const hand = page.getByRole("listbox", { name: "自家の手牌" });
    const firstTile: Locator = hand.getByRole("option").first();

    // ロービングタブインデックス: フォーカス中の option だけが Tab 到達可能(tabindex=0)。
    await firstTile.focus();
    await expect(firstTile).toHaveAttribute("tabindex", "0");

    // Enter で打牌候補として選択でき、状態が色ではなく aria-selected で伝わる(5.2.1 / 5.2.2)。
    await firstTile.press("Enter");
    await expect(firstTile).toHaveAttribute("aria-selected", "true");
  });

  test("/game の操作パネルは Space でも起動できライブリージョンへ通知される(5.2.2 / 5.2.3)", async ({
    page,
  }) => {
    await page.goto("/game");

    const ponButton = page
      .getByRole("group", { name: "操作パネル" })
      .getByRole("button", { name: "ポン" });

    // Enter 起動は既存テストが担保済み。ここは Space 起動(APG のボタン要件)を検証する。
    await ponButton.focus();
    await expect(ponButton).toBeFocused();
    await ponButton.press(" ");

    await expect(page.locator('[aria-live="polite"]')).toHaveText(
      "ポンを選択しました",
    );
  });
});
