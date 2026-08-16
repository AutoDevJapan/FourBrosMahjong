import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { advanceUntil, armRiichi, visibleHand } from "./helpers/gameDriver";
import { LANDMARK_RULES } from "./screens";

/**
 * wheel を送った後、スクロール適用が終わるまで 2 フレーム進める。
 *
 * 「スクロールしないこと」を検証する箇所では `expect.poll` が未適用のまま即成立して
 * しまうため、フレームを進めてから確認して検証を空振りさせない。
 */
async function settleScroll(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * CSS の色文字列を比較用に正規化する(`#b45309` / `rgb(180, 83, 9)` / `rgb(180,83,9)` を同一視)。
 * トークン値(HEX)と `getComputedStyle` の返す `rgb()` を突き合わせるために使う。
 */
function normalizeColor(color: string): string {
  const hex = color.trim().match(/^#([0-9a-fA-F]{6})$/);
  if (hex !== null) {
    const n = Number.parseInt(hex[1], 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  const rgb = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgb === null) return color.trim();
  const parts = rgb[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((v) => Math.round(Number(v)));
  return parts.join(",");
}

/**
 * 対局画面(`/game`)の E2E 検証(#30 / #67)。
 *
 * #67 で `/game` は固定サンプルから**実対局エンジン**駆動へ統合された。ロビー導線・主要表示要素に加え、
 * 「1半荘を実プレイして `/game/result` に到達する」ループ(スペック2 2.1・2.6・2.8 / スペック6 6.3)を検証する。
 *
 * 盤面の牌はクライアントで乱数生成されるため、値そのものではなく role/aria-label ベースで安定検証する。
 * 席割りは起家=自家 p0 固定(engine)のため、東1 の席(あなた=東家 / 抜け番=三郎)は決定的。
 */
test.describe("対局画面(/game)", () => {
  test("自家の捨て牌フリテンを色だけでなく理由付きバッジで表示する(#408)", async ({
    page,
  }) => {
    await page.goto("/game?seed=255");
    const furiten = page
      .getByRole("region", { name: /^あなた/ })
      .filter({ visible: true })
      .getByTestId("status-badge-furiten");

    await advanceUntil(page, async () => (await furiten.count()) > 0, {
      maxSteps: 30,
      onRoundEnd: "stop",
    });

    await expect(furiten).toHaveText("禁フリテン（捨て牌）");
  });

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

    await expect(
      page.getByRole("heading", { level: 1, name: "対局画面" }),
    ).toBeVisible();

    // 卓中央: 場風/局/本場/供託(TableInfo)。2レイアウト分 DOM にあるため可視側に限定。
    await expect(
      page.getByText("東1局").filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText("本場").filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText("供託").filter({ visible: true }),
    ).toBeVisible();

    // ドラ表示。
    await expect(page.getByRole("region", { name: "ドラ表示" })).toBeVisible();

    // 4スロット: 着席3人(あなた=東家 / 一郎=南家 / 二郎=西家)+ 抜け番(三郎)。
    await expect(
      page.getByRole("region", { name: "あなた(東家)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "一郎(南家)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "二郎(西家)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "三郎(抜け番)" }),
    ).toBeVisible();

    // 抜け番の状態はテキストでも伝わる(色のみ依存禁止 / スペック5 5.2.1)。
    // バッジの特定は安定したテスト用アンカー(#162)で行い、その上でテキスト併記を検証する
    // (テキスト部分一致でのバッジ特定に依存せず、色非依存の可視ラベルは引き続き担保)。
    await expect(
      page
        .getByRole("region", { name: "三郎(抜け番)" })
        .getByTestId("status-badge-bench"),
    ).toContainText("抜け番");

    // 自家の手牌(role=listbox)と持ち点(35,000 スタート)。
    await expect(
      page.getByRole("listbox", { name: "自家の手牌" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "あなた(東家)" }),
    ).toContainText("35,000");

    // 操作パネル(role=group)。開始直後は自家の打牌待ちで「ツモ」ボタンが現れる。
    const actionPanel = page.getByRole("group", { name: "操作パネル" }).first();
    await expect(actionPanel).toBeVisible();
    await expect(
      actionPanel.getByRole("button", { name: "ツモ" }),
    ).toBeVisible();
  });

  test("対局中の用語を狭幅でもキーボードで開閉でき、牌操作を邪魔しない(#610)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/game?seed=0");

    const opener = page
      .getByRole("button", { name: "対局中の用語を見る" })
      .filter({ visible: true });
    await expect(opener).toBeVisible();
    await expect(opener).toHaveCSS("min-height", "44px");

    await opener.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "対局中の用語" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("ガリ（抜き北）");
    await expect(dialog).toContainText("スルー");
    await expect(
      dialog.getByRole("link", { name: "ルール説明を詳しく見る" }),
    ).toHaveAttribute("href", "/rules");
    await expect(
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    await expect(
      page.getByRole("button", { name: "ツモ" }).filter({ visible: true }),
    ).toBeVisible();
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

  test("1半荘を実プレイして結果画面へ到達し、「もう一半荘」で対局へ戻れる(スペック2 2.8 / 6.3)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // 決定的 seed で固定し実行時間を安定させる(#260)。seed=106 はドライバ標準戦略
    // (先頭牌打牌・スルー・次局送り)で約20手・2局で終局する短い半荘(オフラインで
    // engine を同一戦略で走査して選定。戦略の定義と再選定手順は e2e/helpers/gameDriver.ts)。
    await page.goto("/game?seed=106");

    // 半荘終了(gameEnd)で最終局の決着が表示され、ドライバが「結果を見る」を押して
    // /game/result へ進む(スペック6 6.3 / #277: 自動遷移は無い)。
    await advanceUntil(
      page,
      () => new URL(page.url()).pathname === "/game/result",
      { maxSteps: 200 },
    );

    await expect(page).toHaveURL((url) => url.pathname === "/game/result");
    await expect(page).toHaveTitle("対局結果 | 四兄弟麻雀");
    await expect(
      page.getByRole("heading", { level: 1, name: "対局結果" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "最終順位" })).toBeVisible();
    // 確定済みの結果本文もランドマーク外へ出ない(#409)。`ResultPageClient` は
    // 読み込み中/未確定/確定の 3 分岐を持ち、静的監査(`e2e/a11y.spec.ts`)が踏むのは
    // 未確定分岐だけなので、最大の本文(最終順位・ソシー内訳・導線 nav)を持つこの分岐は
    // ここで固定する。個数と包含の両方を見る(個数だけでは本文が `<main>` の外でも通る)。
    await expect(page.locator("main")).toHaveCount(1);
    await expect(
      page.locator("main").getByRole("heading", { name: "最終順位" }),
    ).toHaveCount(1);
    // spec 5.2.6 の強制点(2)「全コンテンツが何らかのランドマークに属する」もこの分岐で見る。
    // ここを省くと、確定分岐にだけランドマーク外の要素を足しても何も落ちない。
    const landmark = await new AxeBuilder({ page })
      .withRules([...LANDMARK_RULES])
      .analyze();
    expect(
      landmark.violations.map((violation) => violation.id),
      JSON.stringify(landmark.violations, null, 2),
    ).toEqual([]);

    // 「もう一半荘」で新規半荘を生成し対局画面へ戻る。
    await page.getByRole("button", { name: "もう一半荘" }).click();
    await expect(page).toHaveURL(/\/game$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "対局画面" }),
    ).toBeVisible();
  });

  test("半荘を終える局の決着(和了内訳・点数移動)を表示してからボタンで結果画面へ進める(issue #277)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // seed=60 はドライバ標準戦略(先頭牌打牌・スルー・次局送り)で東3にトビ決着する:
    // 二郎が自家から三倍満 36,000点をロン(自家 11,000 → −25,000 でトビ → 半荘即終了)。
    await page.goto("/game?seed=60");

    // gameEnd で停止(自動遷移が無いことの検証を兼ねる)。
    await advanceUntil(page, (state) => state?.phase === "gameEnd", {
      maxSteps: 400,
      onGameEnd: "stop",
    });
    // 自動遷移せず /game(?seed=60)に留まる。
    await expect(page).toHaveURL(/\/game(\?.*)?$/);

    // 最終局の和了内訳(和了者・点数区分)が表示される(#259 の検算可能性を最終局にも)。
    await expect(
      page.getByRole("heading", { name: "和了内訳" }).first(),
    ).toBeVisible();
    await expect(page.getByText("三倍満").first()).toBeVisible();
    // 各家の点数増減(±デルタ): 自家 −36,000(放銃)/ 二郎 +37,000(供託込み)。
    await expect(page.getByText("−36,000").first()).toBeVisible();
    await expect(page.getByText("+37,000").first()).toBeVisible();

    // 最終局表示中のリロードでも journal 再生で同じ決着表示が復元される(#193)。
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "和了内訳" }).first(),
    ).toBeVisible();
    await expect(page.getByText("−36,000").first()).toBeVisible();

    // ユーザー操作(ボタン)で結果画面へ進める。
    await page.getByRole("button", { name: "結果を見る" }).first().click();
    await expect(page).toHaveURL(/\/game\/result$/);
    await expect(page.getByRole("heading", { name: "最終順位" })).toBeVisible();
  });

  test("seed 無しの乱数半荘でも冒頭数手が進行する(乱数経路のスモーク / #260)", async ({
    page,
  }) => {
    // 半荘完走は決定的 seed のテストが担う。乱数経路(本番導線)は「数手進むこと」だけを
    // 短く確認し、実行時間の変動とフレークを持ち込まない(#260)。
    await page.goto("/game");

    const ownDiscards = page
      .getByRole("region", { name: /^あなた/ })
      .getByRole("list", { name: "捨て牌" })
      .first()
      .getByRole("listitem");
    await advanceUntil(page, async () => (await ownDiscards.count()) >= 3, {
      maxSteps: 60,
    });
    await expect(page.locator("[data-phase]").first()).toHaveAttribute(
      "data-phase",
      /playing|roundEnd/,
    );
  });

  test("/game/result への直接アクセスでもページ固有タイトルを表示する(issue #166)", async ({
    page,
  }) => {
    const response = await page.goto("/game/result");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("対局結果 | 四兄弟麻雀");
    await expect(
      page.getByRole("heading", { level: 1, name: "対局結果" }),
    ).toBeVisible();
    await expect(
      page.getByText(/まだ半荘の結果が確定していません/),
    ).toBeVisible();
  });

  test("開始時、自家の手番がライブリージョンへ通知され操作パネルが操作可能(スペック5 5.2.2 / 5.2.3)", async ({
    page,
  }) => {
    // seed=0 は開始ツモが北ではなく、通常の手番通知を決定的に検証できる。
    await page.goto("/game?seed=0");

    // 自家の手番(打牌待ち)は polite ライブリージョンへ通知される(sr-only だが DOM 常駐)。
    await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
      "あなたの手番です。",
    );

    // 操作パネルはキーボードで到達可能(ネイティブ button)。
    const actionPanel = page.getByRole("group", { name: "操作パネル" }).first();
    await expect(actionPanel).toBeVisible();
    await expect(actionPanel.getByRole("button").first()).toBeVisible();
  });

  test("配牌北とツモ北を公開し、320pxと全体盤面でもガリ枚数を確認できる(#171/#178)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await page.goto("/game?seed=1");

    const self = page.getByRole("region", { name: "あなた(東家)" });
    await expect(self.getByTestId("kita-display")).toContainText("ガリ2");
    await expect(
      self.getByTestId("kita-display").locator('[data-face="Pei"]'),
    ).toHaveCount(2);
    await expect(
      page
        .locator('[aria-live="polite"]')
        .filter({ hasText: "北を2枚抜きました" }),
    ).toHaveText(
      "北を2枚抜きました。嶺上牌を補充しました。ガリは合計2枚です。",
    );

    await page.setViewportSize({ width: 320, height: 800 });
    await expect(self.getByTestId("kita-display")).toContainText("ガリ2");
    await page.getByRole("button", { name: "全体盤面" }).click();
    const dialog = page.getByRole("dialog", { name: "全体盤面" });
    await expect(
      dialog
        .getByRole("region", { name: "あなた(東家)" })
        .getByTestId("kita-display"),
    ).toContainText("ガリ2");
  });

  test("残り山をdesktop・320px・全体盤面で表示し、進行に追従する(#189)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto("/game?seed=0");
    const board = page.locator("[data-phase]").first();
    const remaining = page.getByTestId("remaining-live-tiles").filter({
      hasText: /残り山\s*52枚/,
    });
    await expect(remaining.first()).toBeVisible();

    await page
      .getByRole("listbox", { name: "自家の手牌" })
      .first()
      .getByRole("option")
      .first()
      .click();
    await expect(remaining).toHaveCount(0);
    await expect(
      page
        .getByTestId("remaining-live-tiles")
        .filter({ visible: true })
        .first(),
    ).toBeVisible();

    await page.setViewportSize({ width: 320, height: 800 });
    await expect(
      page.getByTestId("remaining-live-tiles").filter({ visible: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);

    await page.getByRole("button", { name: "全体盤面" }).click();
    const dialog = page.getByRole("dialog", { name: "全体盤面" });
    await expect(dialog.getByTestId("remaining-live-tiles")).toBeVisible();
    await expect(board).toHaveAttribute("data-phase", "playing");
  });

  test("サイコロ根拠と和了時の役・ドラ・支払い内訳を確認できる(#170)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/game?seed=1");
    await expect(
      page.getByTestId("dice-info").filter({ visible: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(
      page.getByTestId("dice-info").filter({ visible: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    // 和了(kind === "win")の局終了まで進める(流局は次局へ送る)。
    await advanceUntil(
      page,
      (state) => state?.phase === "roundEnd" && state.kind === "win",
      { maxSteps: 1200 },
    );
    await expect(
      page.getByRole("heading", { name: "和了内訳" }).first(),
    ).toBeVisible();
    // 和了者の和了形(手牌+和了牌)が表向きで開示される(#259)。
    await expect(
      page.getByRole("list", { name: "和了形" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("listitem", { name: /和了牌/ }).first(),
    ).toBeVisible();
    for (const label of ["表ドラ", "裏ドラ", "赤5", "ガリ"]) {
      await expect(
        page.getByText(label, { exact: true }).filter({ visible: true }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("list", { name: "支払い内訳" }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });

  test("決定的seedでAIのリーチと副露が実際の卓に表示される(issue #169)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/game?seed=1");

    // 自家はリーチも鳴きもしない(標準戦略)ため、現れたバッジ/副露は必ずAIのもの。
    // 同一局で同時に出るとは限らないため、観測フラグを累積して両方見えたら停止する。
    let sawAiRiichi = false;
    let sawAiMeld = false;
    await advanceUntil(
      page,
      async () => {
        sawAiRiichi ||=
          (await page.getByTestId("status-badge-riichi").count()) > 0;
        sawAiMeld ||=
          (await page.getByRole("list", { name: "副露" }).count()) > 0;
        return sawAiRiichi && sawAiMeld;
      },
      { maxSteps: 600 },
    );

    expect(sawAiRiichi).toBe(true);
    expect(sawAiMeld).toBe(true);
  });

  test("自家の手牌は矢印キーでフォーカス移動できる(ロービングタブインデックス / スペック5 5.2.2)", async ({
    page,
  }) => {
    await page.goto("/game");

    const hand = page.getByRole("listbox", { name: "自家の手牌" }).first();
    const options = hand.getByRole("option");
    // 先頭牌を起点に、右矢印で次の牌へフォーカスが移る(牌の種類に依らず位置で検証)。
    await options.nth(0).focus();
    await expect(options.nth(0)).toHaveAttribute("tabindex", "0");
    await page.keyboard.press("ArrowRight");
    await expect(options.nth(1)).toBeFocused();
  });

  test("狭幅帯(700px)でもクロス卓が @container/clamp で成立し横スクロールしない(スペック5 5.3.2 段階①)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await page.goto("/game");
    await expect(
      page.getByRole("heading", { level: 1, name: "対局画面" }),
    ).toBeVisible();

    // 卓の描画幅 >= 360px のためクロス配置が有効。フォーカス表示専用の「全体盤面」ボタンは出ない。
    await expect(page.getByRole("button", { name: "全体盤面" })).toBeHidden();

    // 横スクロール(はみ出しの横スクロール解決)を発生させない(スペック5 5.3.2)。
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  /**
   * 主要スマホ幅(#387)。卓 container 幅が 360px 以上になるため必ず段階①に入る帯で、
   * 河が溜まった状態でも横スクロールしないことを固定する。
   *
   * 既存の 700px / 320px 固定の検査は (a) この帯を外し (b) 河が空の初期局面で測るため、
   * この破綻を構造的に検出できなかった。ここでは**実際に河を溜めてから**測る。
   *
   * 下限を 393px にしているのは、`/game` の `p-4`(左右 32px)により viewport 392px が
   * 卓 container 幅ちょうど 360.00px、つまり**段階①の下端(境界を含むので段階①側)**に
   * なるため。境界ぴったりの値で検査すると、ページ余白の微修正やスクロールバー幅の差で
   * 段階②側へ倒れ、意図しない失敗になる。393px は Pixel 8 / iPhone 15 Pro の実幅でもある。
   *
   * **393px を外さないこと**: 破綻量は卓が狭いほど大きく、実測では 6 列固定への巻き戻しも
   * `ScoreDisplay` の `nowrap` への巻き戻しも 460px では overflow 0 で、393px でのみ
   * 検出できる。414 / 460px は「上限 6 列に張り付く」別条件を見るための併走。
   */
  for (const width of [393, 414, 460]) {
    test(`主要スマホ幅(${width}px)で河が溜まっても横スクロールしない(#387 / スペック5 5.3.2)`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 850 });
      await page.goto("/game?seed=0");
      await expect(
        page.getByRole("heading", { level: 1, name: "対局画面" }),
      ).toBeVisible();

      // この帯は段階①(クロス配置)であることを先に固定する。段階②へ落ちて
      // 「たまたま横スクロールしない」状態を合格と誤認しないため。
      await expect(page.getByRole("button", { name: "全体盤面" })).toBeHidden();

      const maxOverflow = () =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
      expect(await maxOverflow()).toBeLessThanOrEqual(1);

      const visibleRivers = () =>
        page.getByRole("list", { name: "捨て牌" }).filter({ visible: true });
      const riverCounts = () =>
        visibleRivers().evaluateAll((lists) =>
          lists.map((list) => list.childElementCount),
        );

      // 全員の河が 6 枚(= 旧実装の固定列数)以上になるまで進める。6 枚を超えた時点で
      // 旧実装の河は最小幅が牌6枚ぶんに固定され、左右スロット幅を超えてはみ出していた。
      // 進行の各ステップで測り、途中の局面(局終了の和了内訳表示を含む)も見る。
      // 局が先に終わっても次局へ送って探索を続ける(1局目が早く終わる seed でも空振りしない)。
      let worst = 0;
      await advanceUntil(
        page,
        async () => {
          worst = Math.max(worst, await maxOverflow());
          const counts = await riverCounts();
          return counts.length >= 3 && counts.every((n) => n >= 6);
        },
        { maxSteps: 400, onGameEnd: "stop" },
      );

      // 到達失敗(半荘が先に終わる等)を「河が空のまま合格」に化けさせない。
      const counts = await riverCounts();
      expect(counts.length).toBeGreaterThanOrEqual(3);
      expect(counts.every((n) => n >= 6)).toBe(true);

      worst = Math.max(worst, await maxOverflow());
      expect(worst).toBeLessThanOrEqual(1);

      // 列数を可変にした副作用で河が全幅へ散らばっていないこと(#258 の不変条件)。
      // 上限 6 列は max-width で与えているため、実描画のトラック数で固定する。
      // 自家スロットは卓幅いっぱい(3列ぶん)あるため必ず上限に張り付く。`toBe(6)` は
      // 「上限が効かず 7 列以上になる」と「丸め誤差で 5 列に落ちる」の両方を検出する。
      const columnCounts = await visibleRivers().evaluateAll((lists) =>
        lists.map(
          (list) =>
            getComputedStyle(list).gridTemplateColumns.trim().split(/\s+/)
              .length,
        ),
      );
      expect(Math.max(...columnCounts)).toBe(6);

      // 和了の局終了まで進め、点差(ScoreDisplay の delta)が描画された状態でも測る。
      // 点差は局終了でしか出ないため、上の「河が6枚」到達時点では未描画で、
      // ScoreDisplay の折り返し修正がこのテストで守られない状態だった。
      // `delta === 0` は描画されない(全員テンパイ/全員ノーテンの流局)ため和了局に限定し、
      // 到達失敗を後段アサーションの不透明なタイムアウトではなく明示エラーにする。
      await advanceUntil(
        page,
        (state) => state?.phase === "roundEnd" && state.kind === "win",
        { maxSteps: 400, onGameEnd: "stop" },
      );
      await expect(
        page
          .getByText(/^[+−]\d/)
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      expect(await maxOverflow()).toBeLessThanOrEqual(1);
    });
  }

  test("河の牌幅と列幅が卓幅に連動して縮む(スペック5 5.3.2 段階①の流体縮小)", async ({
    page,
  }) => {
    // 牌寸法は `--u`(`.board-cross` でコンテナ幅連動の clamp() に差し替わる)の倍数で
    // 決まる。倍率トークンではなく「`--u` を掛け終えた長さ」を `:root` で定義すると、
    // カスタムプロパティの計算値が :root の `--u` で確定してしまい、卓内の上書きが
    // 効かなくなって河牌だけ縮まなくなる(幅は固定・高さだけ縮んで牌が歪む)。
    // CSS からは読み取れない退行なので実描画で固定する。
    test.setTimeout(60_000);
    // 自家の河(段階①のクロス配置側)。空の `ul` は高さ 0 で「不可視」判定になるため、
    // `filter({ visible: true })` ではなく席の region から一意に取る。
    const ownRiver = page
      .getByRole("region", { name: /^あなた/ })
      .getByRole("list", { name: "捨て牌" })
      .first();

    const measure = async (width: number) => {
      await page.setViewportSize({ width, height: 900 });
      await expect(ownRiver).toBeVisible();
      return ownRiver.evaluate((list) => {
        const style = getComputedStyle(list);
        const tile = list.querySelector(".game-tile--river");
        return {
          track: Number.parseFloat(style.gridTemplateColumns.split(/\s+/)[0]),
          tile: tile ? tile.getBoundingClientRect().width : Number.NaN,
        };
      });
    };

    await page.goto("/game?seed=0");
    // 河が 1 枚以上ある状態にする(空だと計測対象の牌が無い)。
    await advanceUntil(
      page,
      async () => (await ownRiver.getByRole("listitem").count()) > 0,
      { maxSteps: 60, onRoundEnd: "stop", onGameEnd: "stop" },
    );

    const wide = await measure(1280);
    const narrow = await measure(393);

    // トラック幅と牌幅は同じ倍率から導くため常に一致する。
    expect(narrow.track).toBeCloseTo(narrow.tile, 1);
    expect(wide.track).toBeCloseTo(wide.tile, 1);
    // 卓が狭まれば牌もトラックも縮む(固定長になっていない)。
    expect(narrow.tile).toBeLessThan(wide.tile);
  });

  test("極狭幅(320px)でフォーカス表示へ切替わり、全体盤面モーダルで盤面を確認できる(スペック5 5.3.2 段階② / 5.2.2)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/game");
    await expect(
      page.getByRole("heading", { level: 1, name: "対局画面" }),
    ).toBeVisible();

    // 卓の描画幅 < 360px のためフォーカス表示。全体盤面への導線が現れる。
    const openButton = page.getByRole("button", { name: "全体盤面" });
    await expect(openButton).toBeVisible();

    // 横スクロールなしで成立している(スペック5 5.3.2)。
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // モーダルでクロス配置の全体盤面を確認できる(role=dialog / aria-modal)。
    await openButton.click();
    const dialog = page.getByRole("dialog", { name: "全体盤面" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    // 閲覧専用の自家手牌は静的listであり、操作可能なlistbox/optionを公開しない(#187)。
    const modalHand = dialog.getByRole("list", { name: "自家の手牌" });
    await expect(modalHand).toBeVisible();
    await expect(dialog.getByRole("listbox")).toHaveCount(0);
    await expect(dialog.getByRole("option")).toHaveCount(0);
    await expect(modalHand.getByRole("listitem")).toHaveCount(14);

    // フォーカストラップ内の操作対象は閉じるボタンと本文スクロール領域。
    const scrollArea = dialog.locator("[data-modal-scroll-area]");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "閉じる" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(scrollArea).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "閉じる" })).toBeFocused();

    // Escape でフォーカストラップ付きモーダルを閉じられる(スペック5 5.2.2)。
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // 閉じた後はトリガー(全体盤面ボタン)へフォーカスが戻る。
    await expect(openButton).toBeFocused();
  });

  test("320/360px幅でも全体盤面の自家手牌までスクロールでき、操作を見失わない(#609)", async ({
    page,
  }) => {
    for (const width of [320, 360] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/game?seed=0");

      const openButton = page.getByRole("button", { name: "全体盤面" });
      await expect(openButton).toBeVisible();
      await openButton.click();

      const dialog = page.getByRole("dialog", { name: "全体盤面" });
      const scrollArea = dialog.locator("[data-modal-scroll-area]");
      const modalHand = dialog.getByRole("list", { name: "自家の手牌" });
      await expect(modalHand).toBeVisible();

      const scrollMax = await scrollArea.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      );
      expect(
        scrollMax,
        `${width}px幅の本文をスクロール可能にする`,
      ).toBeGreaterThan(0);
      await scrollArea.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect
        .poll(() => scrollArea.evaluate((element) => element.scrollTop))
        .toBe(scrollMax);

      const positions = await dialog.evaluate((element) => {
        const area = element.querySelector("[data-modal-scroll-area]");
        const hand = element.querySelector('[aria-label="自家の手牌"]');
        const heading = element.querySelector("h2");
        const close = element.querySelector('button[aria-label="閉じる"]');
        if (!area || !hand || !heading || !close) {
          throw new Error("モーダルの #609 検証対象が見つからない");
        }
        return {
          area: area.getBoundingClientRect().toJSON(),
          hand: hand.getBoundingClientRect().toJSON(),
          heading: heading.getBoundingClientRect().toJSON(),
          close: close.getBoundingClientRect().toJSON(),
        };
      });

      expect(positions.hand.bottom).toBeLessThanOrEqual(
        positions.area.bottom + 1,
      );
      expect(positions.heading.bottom).toBeLessThanOrEqual(positions.area.top);
      expect(positions.close.bottom).toBeLessThanOrEqual(positions.area.top);
      await expect(
        dialog.getByRole("heading", { name: "全体盤面" }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "閉じる" }),
      ).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
  });

  test("マウス操作では牌のクリックだけで即時に打牌する(#607)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/game?seed=0");
    await expect(page.locator('[data-pending="humanDiscard"]')).toHaveCount(1);

    const hand = visibleHand(page);
    const firstTile = hand.getByRole("option").first();
    const box = await firstTile.boundingBox();
    expect(box).not.toBeNull();
    const self = page
      .getByRole("region", { name: /^あなた/ })
      .filter({ visible: true })
      .first();
    const discards = self
      .getByRole("list", { name: "捨て牌" })
      .getByRole("listitem");
    const initialDiscards = await discards.count();

    await page.mouse.click(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );

    await expect
      .poll(async () => discards.count(), { timeout: 5_000 })
      .toBeGreaterThan(initialDiscards);
    await expect(
      page.getByRole("button", { name: /で打牌を確定$/ }).filter({
        visible: true,
      }),
    ).toHaveCount(0);
  });

  test("キーボード操作では牌のEnterだけで即時に打牌する(#607)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/game?seed=0");
    await expect(page.locator('[data-pending="humanDiscard"]')).toHaveCount(1);

    const hand = visibleHand(page);
    const firstTile = hand.getByRole("option").first();
    const self = page
      .getByRole("region", { name: /^あなた/ })
      .filter({ visible: true })
      .first();
    const discards = self
      .getByRole("list", { name: "捨て牌" })
      .getByRole("listitem");
    const initialDiscards = await discards.count();

    await firstTile.focus();
    await page.keyboard.press("Enter");

    await expect
      .poll(async () => discards.count(), { timeout: 5_000 })
      .toBeGreaterThan(initialDiscards);
    await expect(
      page.getByRole("button", { name: /で打牌を確定$/ }).filter({
        visible: true,
      }),
    ).toHaveCount(0);
  });

  test.describe("狭幅タッチの手牌確定(#607)", () => {
    test.use({
      viewport: { width: 320, height: 800 },
      isMobile: true,
      hasTouch: true,
    });

    test("320px/360pxの1回目のタップでは打牌せず、確定操作でのみ対局を進める", async ({
      page,
    }) => {
      for (const width of [320, 360] as const) {
        // 320px側の確定操作で保存された進行状態を、360px側の初期局面へ持ち越さない。
        if (width === 360) await page.evaluate(() => sessionStorage.clear());
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/game?seed=0");
        await expect(page.locator('[data-pending="humanDiscard"]')).toHaveCount(
          1,
        );
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              );
            }),
        );
        await page.evaluate(() => window.scrollTo(0, 0));

        const hand = visibleHand(page);
        const firstTile = hand.getByRole("option").first();
        await expect(firstTile).toBeVisible();
        const box = await firstTile.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);

        const self = page
          .getByRole("region", { name: /^あなた/ })
          .filter({ visible: true })
          .first();
        const discards = self
          .getByRole("list", { name: "捨て牌" })
          .getByRole("listitem");
        const initialDiscards = await discards.count();

        // Next dev の開発用ポータルが 320px 画面の下中央に重なるため、
        // 44px の操作領域内で上端寄りをタップする。本番にはこのポータルは存在しない。
        const tapX = (box?.x ?? 0) + Math.max(8, (box?.width ?? 0) - 8);
        const tapY = (box?.y ?? 0) + Math.min(8, (box?.height ?? 0) / 2);
        await page.touchscreen.tap(tapX, tapY);

        await expect(hand.getByRole("option")).toHaveCount(14);
        await expect(discards).toHaveCount(initialDiscards);
        await expect(
          page.getByRole("status").filter({ visible: true }).first(),
        ).toContainText("を選択中です");

        const confirm = page
          .getByRole("button", { name: /で打牌を確定$/ })
          .filter({ visible: true })
          .first();
        await expect(confirm).toBeVisible();
        await expect(confirm).toBeFocused();
        const confirmInViewport = await confirm.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= window.innerHeight;
        });
        expect(confirmInViewport).toBe(true);

        await page.getByRole("button", { name: "選択を解除" }).click();
        await expect(firstTile).toBeFocused();
        await expect(
          page.getByRole("button", { name: /で打牌を確定$/ }).filter({
            visible: true,
          }),
        ).toHaveCount(0);

        await firstTile.scrollIntoViewIfNeeded();
        const retryBox = await firstTile.boundingBox();
        expect(retryBox).not.toBeNull();
        await page.touchscreen.tap(
          (retryBox?.x ?? 0) + Math.max(8, (retryBox?.width ?? 0) - 8),
          (retryBox?.y ?? 0) + Math.min(8, (retryBox?.height ?? 0) / 2),
        );
        await expect(confirm).toBeFocused();
        await expect(confirm).toBeVisible();
        await confirm.click();

        await expect
          .poll(async () => discards.count(), { timeout: 5_000 })
          .toBeGreaterThan(initialDiscards);
        await expect(
          page.getByRole("button", { name: /で打牌を確定$/ }).filter({
            visible: true,
          }),
        ).toHaveCount(0);
      }
    });
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
    await expect(
      page.getByRole("group", { name: "操作パネル" }).first(),
    ).toBeVisible();
  });

  test("「リーチ可」リングはフォーカス中も見える(フォーカスリングと帯が重ならない / #399)", async ({
    page,
  }) => {
    await page.goto("/game?seed=381");
    // 2 レイアウト分 DOM にあるため可視側に限定する(狭幅レイアウト追加時に壊れない)。
    const hand = visibleHand(page);
    await armRiichi(page);

    const eligible = hand.getByRole("option", { name: /リーチ可/ }).first();
    await expect(eligible).toBeVisible();
    await eligible.focus();
    // `:focus-visible` はキーボード操作を経ないと一致しない(直前が click 由来だと
    // グローバルの `:focus-visible` 規則が適用されず、UA 既定の outline を測ってしまう)。
    // ロービングタブインデックスの矢印移動で往復し、キーボードモダリティにしてから測る。
    // 両方向ともラップアラウンドするため、端の牌でも必ず元の牌へ戻る。
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await expect(eligible).toBeFocused();

    // 「リーチ可」の琥珀色。トークン(--turn-highlight。`@theme inline` は CSS 変数を出力しない
    // ため生トークンを読む)経由で突き合わせ、リングが**実際にその状態表示として**
    // 描かれていることまで主張する(正の spread があるだけでは、無関係な shadow-* でも通る)。
    const highlight = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--turn-highlight")
        .trim(),
    );

    const band = await eligible.evaluate((el) => {
      const style = getComputedStyle(el);
      // `ring-*` は `<offset-x> <offset-y> <blur> <spread> <color>` の box-shadow として
      // 描画される。外側リングの到達距離は spread(4 番目)そのもの。
      const shadows = [
        ...style.boxShadow.matchAll(
          /(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g,
        ),
      ].map((m) => ({ color: m[1], spread: Number(m[5]) }));
      return {
        boxShadow: style.boxShadow,
        shadows,
        ringOuter: shadows.reduce((max, s) => Math.max(max, s.spread), 0),
        outlineWidth: Number.parseFloat(style.outlineWidth),
        outlineOffset: Number.parseFloat(style.outlineOffset),
      };
    });

    // グローバル `:focus-visible` が当たっていること(当たっていないと以降の比較が無意味)。
    expect(band.outlineWidth, `outline=${band.boxShadow}`).toBe(2);
    expect(band.outlineOffset).toBe(2);

    // 「リーチ可」リングが実際に描かれていること(状態表示が消えていない)。
    // 外縁(spread 最大)の層を見る。`ring-offset-*` が付くと内側にオフセット色の層が
    // 増えるため、先頭一致で拾うと状態表示の色ではなくオフセット色を検査してしまう。
    const ring = band.shadows.reduce<(typeof band.shadows)[number] | undefined>(
      (max, s) =>
        s.spread > 0 && (max === undefined || s.spread > max.spread) ? s : max,
      undefined,
    );
    expect(
      ring,
      `「リーチ可」リングが描画されていない: box-shadow=${band.boxShadow}`,
    ).toBeDefined();
    expect(
      normalizeColor(ring?.color ?? ""),
      `box-shadow=${band.boxShadow}`,
    ).toBe(normalizeColor(highlight));

    // outline は 2〜4px を占める。リングの外縁がその開始位置以下なら覆われない。
    expect(
      band.ringOuter,
      `リングが outline の帯(2〜4px)へ食い込んでいる: box-shadow=${band.boxShadow}`,
    ).toBeLessThanOrEqual(band.outlineOffset);
  });

  test("リーチ宣言候補と非候補をマウス・キーボード・SRへ明示し、同じ禁止理由も再通知する(#168 / #250)", async ({
    page,
  }) => {
    await page.goto("/game?seed=381");
    const hand = page.getByRole("listbox", { name: "自家の手牌" }).first();

    // リーチ可能手番まで進めて「リーチ」で武装する(宣言牌の候補/非候補をこの後検証する)。
    await armRiichi(page);

    const eligible = hand.getByRole("option", { name: /リーチ可/ });
    const ineligible = hand.getByRole("option", {
      name: /リーチ宣言できません/,
    });
    await expect(eligible.first()).toBeVisible();
    await expect(eligible.first()).not.toHaveAttribute("aria-disabled");
    await expect(ineligible.first()).toHaveAttribute("aria-disabled", "true");
    await expect(ineligible.first()).toContainText("禁止");

    const liveRegion = page.locator('[aria-live="polite"]').first();
    await liveRegion.evaluate((region) => {
      region.setAttribute("data-test-mutations", "0");
      new MutationObserver((records) => {
        const childListChanges = records.filter(
          (record) => record.type === "childList",
        ).length;
        const previous = Number(
          region.getAttribute("data-test-mutations") ?? "0",
        );
        region.setAttribute(
          "data-test-mutations",
          String(previous + childListChanges),
        );
      }).observe(region, { childList: true, subtree: true });
    });

    // `aria-disabled` を尊重する Playwright の通常 click は拒否されるため、実ブラウザでの
    // ポインターイベントを再現する force click で理由通知を検証する。
    await ineligible.first().click({ force: true });
    await expect(liveRegion).toHaveText(
      "この牌ではテンパイを保てないため、リーチ宣言できません。",
    );
    const firstEventMutations = Number(
      await liveRegion.getAttribute("data-test-mutations"),
    );
    expect(firstEventMutations).toBeGreaterThan(0);
    await ineligible.first().focus();
    await page.keyboard.press("Enter");
    await expect(ineligible.first()).toHaveAttribute("aria-disabled", "true");
    // 文言が同じでも、別操作として子ノードが交換されれば AT が再通知を観測できる。
    await expect
      .poll(async () =>
        Number(await liveRegion.getAttribute("data-test-mutations")),
      )
      .toBeGreaterThan(firstEventMutations);

    await eligible.first().click();
    await expect(
      page
        .getByRole("region", { name: /^あなた/ })
        .getByTestId("status-badge-riichi"),
    ).toBeVisible();
  });

  test("ポン直後の喰い替え禁止牌を明示し、操作時に理由を通知する(#168)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // seed はドライバ戦略(ポン優先・合法牌のみ)のオフライン走査で「ポン直後の打牌待ちに
    // 喰い替え禁止牌が手牌に実在する」ことを確認して選定(#294 の AI 変更で 12 → 2 へ再選定)。
    await page.goto("/game?seed=2");
    const hand = page.getByRole("listbox", { name: "自家の手牌" }).first();
    const forbidden = hand.getByRole("option", { name: /喰い替え禁止/ });

    // ポンを優先して鳴き、直後の打牌待ちで喰い替え禁止牌が現れるまで合法牌のみで進める。
    await advanceUntil(page, async () => (await forbidden.count()) > 0, {
      maxSteps: 50,
      onHumanReact: "pon",
      legalOnly: true,
    });

    await expect(forbidden.first()).toHaveAttribute("aria-disabled", "true");
    await expect(forbidden.first()).toContainText("禁止");
    await forbidden.first().click({ force: true });
    await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
      "喰い替え禁止のため、この牌は打牌できません。",
    );
  });

  test("複数家の4組目のカンで四槓散了を表示し、次局へ進める(#183)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // seed は gameDriver 既定戦略(表示順先頭牌を打牌・スルー・次局送り)のオフライン走査で
    // 「四槓散了に到達する」ことを確認して選定(#294 の AI 変更で 62 → 1648 へ再選定)。
    await page.goto("/game?seed=1648");
    const board = page.locator("[data-phase]").first();

    // 四槓散了の表示(draw の roundEnd)が出るまで進める(他の局終了は次局へ送る)。
    await advanceUntil(
      page,
      async () =>
        (await page.getByText("四槓散了", { exact: true }).count()) > 0,
      { maxSteps: 1500 },
    );

    await expect(board).toHaveAttribute("data-phase", "roundEnd");
    await expect(board).toHaveAttribute("data-round-kind", "draw");
    await expect(
      page.getByText("四槓散了", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "次の局へ" }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "次の局へ" }).first().click();
    // 次局が AI の自動進行だけで即時決着する場合もあるため、playing 固定ではなく
    // 四槓散了の局から実際に遷移したことを検証する。
    await expect(page.getByText("四槓散了", { exact: true })).toHaveCount(0);
  });

  test("全体盤面モーダル表示中は背面へスクロールが連鎖せず、閉じると位置が戻る(#371)", async ({
    page,
  }) => {
    // 幅 320px で「自分手番フォーカス表示」(段階②)に入り「全体盤面」ボタンが出る。
    // 高さも 320px に絞ると、ダイアログ内部がはみ出して縦スクロールする状況になる。
    await page.setViewportSize({ width: 320, height: 320 });
    await page.goto("/game?seed=1");
    const openButton = page.getByRole("button", { name: "全体盤面" });
    await expect(openButton).toBeVisible();

    // 背面ページをスクロールした状態から開き、閉じた後の位置復元まで見る。
    // トリガーは画面内に残す(実利用と同じ条件)。画面外だと閉時のフォーカス復帰が
    // フォーカスリングを見せるためにスクロールし直すため、前提が変わってしまう。
    const scrollTarget = await openButton.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      // ボタンをビューポート上端から 40px の位置に置く。
      return Math.max(0, Math.round(rect.top + window.scrollY - 40));
    });
    await page.evaluate((y) => window.scrollTo(0, y), scrollTarget);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore).toBeGreaterThan(0);

    // locator 経由の click/press は要素を可視位置までスクロールし直すため、
    // フォーカス済みのトリガーへキーボードで直接送る。
    await openButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "全体盤面" });
    await expect(dialog).toBeVisible();
    // ロックの実現方法には踏み込まず、「表示中に背面が動かない」という受け入れ基準
    // だけを見るため、ロック適用後の値を基準にする。
    await settleScroll(page);
    const scrollWhileOpen = await page.evaluate(() => window.scrollY);

    // (1) オーバーレイ余白(左端)上の wheel は背面へ伝播しない。
    await page.mouse.move(4, 160);
    await page.mouse.wheel(0, 500);
    await settleScroll(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollWhileOpen);

    // (2) 本文領域は末尾までスクロールできる。タイトル・閉じる操作は本文の外に固定される
    // (#609)ため、本文のスクロール領域を対象にする。
    const scrollArea = dialog.locator("[data-modal-scroll-area]");
    await expect(scrollArea).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "全体盤面" }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "閉じる" })).toBeVisible();
    const box = await dialog.boundingBox();
    if (box === null) throw new Error("ダイアログの矩形が取得できない");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 2000);
    const scrollMax = await scrollArea.evaluate(
      (el) => el.scrollHeight - el.clientHeight,
    );
    expect(scrollMax).toBeGreaterThan(0);
    await expect
      .poll(() => scrollArea.evaluate((el) => el.scrollTop))
      .toBe(scrollMax);
    await expect(
      dialog.getByRole("heading", { name: "全体盤面" }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "閉じる" })).toBeVisible();

    // (3) 末尾に到達した状態でさらに送っても背面へ連鎖しない。
    await page.mouse.wheel(0, 500);
    await settleScroll(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollWhileOpen);
    expect(await scrollArea.evaluate((el) => el.scrollTop)).toBe(scrollMax);

    // (4) 閉じると開く前の document スクロール位置へ戻り、トリガーへフォーカスが返る。
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(openButton).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBe(scrollBefore);
  });
});
