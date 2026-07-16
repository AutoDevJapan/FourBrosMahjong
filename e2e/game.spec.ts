import { expect, test } from "@playwright/test";

/**
 * 対局画面(`/game`)への遷移と主要表示要素の E2E 検証(#30)。
 *
 * #53(PR #58)で `/game` ルート・コンポーネントツリーが骨組み実装され、ロビーの
 * 「対局を開始」が実リンク化したため、スペック6 6.3(画面遷移)の
 * ロビー → 対局画面 導線と、6.4.2(表示要素の割り当て)の主要要素の存在を検証する。
 *
 * セレクタは実装文言に脆く依存しないよう role / aria-label ベースを優先する。
 * `/game` は骨組み段階で固定サンプル(`sampleGame.ts`)を描画するため、値そのものではなく
 * 「要素が存在し、遷移が成立すること」を安定検証の対象とする(スペック6 6.8)。
 *
 * `/game/result`(#54)など未実装ルートに依存するシナリオはここには書かない。
 */
test.describe("対局画面(/game)", () => {
  test("ロビーの「対局を開始」導線から /game へ遷移できる(スペック6 6.3)", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /対局を開始/ }).click();

    await expect(page).toHaveURL(/\/game$/);
    await expect(page).toHaveTitle("対局 | 四兄弟麻雀");
    await expect(
      page.getByRole("heading", { level: 1, name: "対局画面" }),
    ).toBeVisible();
  });

  test("/game に直接アクセスすると 200 で表示され、主要要素が揃う(スペック6 6.4.2)", async ({
    page,
  }) => {
    const response = await page.goto("/game");
    expect(response?.status()).toBe(200);

    // 見出し
    await expect(
      page.getByRole("heading", { level: 1, name: "対局画面" }),
    ).toBeVisible();

    // 卓中央: 場風/局/本場/供託(TableInfo)。
    // GameBoard は md 用と狭幅用の 2 レイアウトを描画し片方を display:none にするため、
    // テキストは DOM 上に 2 つ存在する。可視側(現ビューポート)に限定して検証する。
    await expect(
      page.getByText("東1局").filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText("本場").filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText("供託").filter({ visible: true }),
    ).toBeVisible();

    // ドラ表示(DoraIndicator: section aria-label="ドラ表示")
    await expect(page.getByRole("region", { name: "ドラ表示" })).toBeVisible();

    // 4スロット: 着席3人 + 抜け番1人(PlayerArea / BenchArea の aria-label)
    await expect(
      page.getByRole("region", { name: "あなた(東家)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "上家(南家)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "下家(西家)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "対面(抜け番)" }),
    ).toBeVisible();

    // 抜け番の状態はテキストでも伝わる(色のみ依存禁止 / スペック5 5.2.1)
    await expect(
      page.getByRole("region", { name: "対面(抜け番)" }).getByText("抜け番"),
    ).toBeVisible();

    // 自家の手牌(Hand: role=listbox)と点数表示(ScoreDisplay)
    await expect(
      page.getByRole("listbox", { name: "自家の手牌" }),
    ).toBeVisible();
    // 点数は自家スロット内にサンプルの持ち点が表示される(ja-JP 桁区切り)。
    await expect(
      page.getByRole("region", { name: "あなた(東家)" }),
    ).toContainText("35,000");

    // 操作パネル(ActionPanel: role=group)と各操作ボタン
    const actionPanel = page.getByRole("group", { name: "操作パネル" });
    await expect(actionPanel).toBeVisible();
    for (const name of ["リーチ", "ポン", "カン", "北抜き(ガリ)", "スキップ"]) {
      await expect(actionPanel.getByRole("button", { name })).toBeVisible();
    }
  });

  test("/game から「ロビーへ戻る」導線でロビーに戻れる(スペック6 6.3)", async ({
    page,
  }) => {
    await page.goto("/game");

    await page.getByRole("link", { name: "ロビーへ戻る" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "四兄弟麻雀" }),
    ).toBeVisible();
  });

  test("操作パネルのボタンをキーボードで活性化でき、進行がライブリージョンに通知される(スペック5 5.2.2 / 5.2.3)", async ({
    page,
  }) => {
    await page.goto("/game");

    const riichiButton = page
      .getByRole("group", { name: "操作パネル" })
      .getByRole("button", { name: "リーチ" });

    // キーボードのみで到達・決定できる(ネイティブ button)。
    await riichiButton.focus();
    await expect(riichiButton).toBeFocused();
    await riichiButton.press("Enter");

    // 進行通知は polite ライブリージョンへ反映される(sr-only だが DOM 常駐)。
    await expect(page.locator('[aria-live="polite"]')).toHaveText(
      "リーチを選択しました",
    );
  });

  test("自家の手牌は矢印キーでフォーカス移動できる(ロービングタブインデックス / スペック5 5.2.2)", async ({
    page,
  }) => {
    await page.goto("/game");

    const hand = page.getByRole("listbox", { name: "自家の手牌" });
    // 先頭牌(一萬)を起点に、右矢印で次牌(九萬)へフォーカスが移る。
    await hand.getByRole("option", { name: "一萬" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(hand.getByRole("option", { name: "九萬" })).toBeFocused();
  });

  test("ダークモード設定でも主要要素が見える(スペック5 5.4)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const response = await page.goto("/game");

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "対局画面" }),
    ).toBeVisible();
    await expect(page.getByRole("group", { name: "操作パネル" })).toBeVisible();
  });
});
