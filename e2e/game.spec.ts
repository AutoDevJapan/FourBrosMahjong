import { expect, type Page, test } from "@playwright/test";
import { advanceUntil, armRiichi } from "./helpers/gameDriver";

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
 * 対局画面(`/game`)の E2E 検証(#30 / #67)。
 *
 * #67 で `/game` は固定サンプルから**実対局エンジン**駆動へ統合された。ロビー導線・主要表示要素に加え、
 * 「1半荘を実プレイして `/game/result` に到達する」ループ(スペック2 2.1・2.6・2.8 / スペック6 6.3)を検証する。
 *
 * 盤面の牌はクライアントで乱数生成されるため、値そのものではなく role/aria-label ベースで安定検証する。
 * 席割りは起家=自家 p0 固定(engine)のため、東1 の席(あなた=東家 / 抜け番=三郎)は決定的。
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

    // フォーカストラップ内で唯一の操作対象は閉じるボタン。Tab/Shift+Tabともそこに留まる。
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "閉じる" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "閉じる" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "閉じる" })).toBeFocused();

    // Escape でフォーカストラップ付きモーダルを閉じられる(スペック5 5.2.2)。
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // 閉じた後はトリガー(全体盤面ボタン)へフォーカスが戻る。
    await expect(openButton).toBeFocused();
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
    const hand = page.getByRole("listbox", { name: "自家の手牌" }).first();
    await armRiichi(page);

    const eligible = hand.getByRole("option", { name: /リーチ可/ }).first();
    await expect(eligible).toBeVisible();
    await eligible.focus();
    // `:focus-visible` はキーボード操作を経ないと一致しない(直前が click 由来だと
    // グローバルの `:focus-visible` 規則が適用されず、UA 既定の outline を測ってしまう)。
    // ロービングタブインデックスの矢印移動で往復し、キーボードモダリティにしてから測る。
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await expect(eligible).toBeFocused();

    // グローバル `:focus-visible` の outline は offset 2px / 幅 2px = border-box から 2〜4px。
    // 「リーチ可」のリング(box-shadow)がこの帯へ入ると outline に覆われて完全に消える。
    const band = await eligible.evaluate((el) => {
      const style = getComputedStyle(el);
      // `ring-*` は `<spread> <color>` の box-shadow として描画される。外側リングの
      // 最大到達距離(offset + spread)を取り出す。
      const distances = [
        ...style.boxShadow.matchAll(
          /(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px/g,
        ),
      ].map((m) => Number(m[4]));
      return {
        boxShadow: style.boxShadow,
        ringOuter: distances.length > 0 ? Math.max(...distances) : 0,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        outlineOffset: Number.parseFloat(style.outlineOffset),
      };
    });

    // リングが実際に描画されていること(状態表示が消えていない)。
    expect(band.ringOuter).toBeGreaterThan(0);
    // outline は 2〜4px を占める。リングの外縁がその開始位置以下なら覆われない。
    expect(band.ringOuter).toBeLessThanOrEqual(band.outlineOffset);
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

    // (2) ダイアログ内は末尾までスクロールできる。
    const box = await dialog.boundingBox();
    if (box === null) throw new Error("ダイアログの矩形が取得できない");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 2000);
    const scrollMax = await dialog.evaluate(
      (el) => el.scrollHeight - el.clientHeight,
    );
    expect(scrollMax).toBeGreaterThan(0);
    await expect
      .poll(() => dialog.evaluate((el) => el.scrollTop))
      .toBe(scrollMax);

    // (3) 末尾に到達した状態でさらに送っても背面へ連鎖しない。
    await page.mouse.wheel(0, 500);
    await settleScroll(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollWhileOpen);
    expect(await dialog.evaluate((el) => el.scrollTop)).toBe(scrollMax);

    // (4) 閉じると開く前の document スクロール位置へ戻り、トリガーへフォーカスが返る。
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(openButton).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBe(scrollBefore);
  });
});
