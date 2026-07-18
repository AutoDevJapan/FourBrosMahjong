import { expect, test } from "@playwright/test";

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
    test.setTimeout(180_000);
    await page.goto("/game");

    // 盤面ルートの data-phase / data-pending(進行状態のテスト用フック)を読み、局面に応じて
    // 操作を1つ選んで進める。自家は打牌(ツモ切り相当)・ロンは見送り、局終了ごとに次局へ。
    // 半荘終了で GameBoard が /game/result へ自動遷移する(スペック6 6.3)。
    const board = page.locator("[data-phase]").first();
    for (let step = 0; step < 1500; step++) {
      if (new URL(page.url()).pathname === "/game/result") break;
      const state = await board
        .evaluate((el) => ({
          phase: el.getAttribute("data-phase"),
          pending: el.getAttribute("data-pending"),
        }))
        .catch(() => null);
      if (state === null) {
        // 遷移直後などで盤面が一時的に取れないときは URL 確認へ回す。
        await page.waitForTimeout(20);
        continue;
      }
      if (state.phase === "gameEnd") {
        await page.waitForTimeout(50);
        continue;
      }
      if (state.phase === "roundEnd") {
        await page.getByRole("button", { name: "次の局へ" }).first().click();
        continue;
      }
      if (state.pending === "humanReact") {
        // 鳴き/ロンは見送り(スルー)して進める。
        await page.getByRole("button", { name: "スルー" }).first().click();
        continue;
      }
      if (state.pending === "humanDiscard") {
        await page
          .getByRole("listbox", { name: "自家の手牌" })
          .first()
          .getByRole("option")
          .first()
          .click();
        continue;
      }
      await page.waitForTimeout(20);
    }

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

  test("サイコロ根拠と和了時の役・ドラ・支払い内訳を確認できる(#170)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/game?seed=1");
    await expect(
      page.getByLabel(/サイコロ .*ドラ\d枚/).filter({ visible: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(
      page.getByLabel(/サイコロ .*ドラ\d枚/).filter({ visible: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const board = page.locator("[data-phase]").first();
    for (let step = 0; step < 1200; step++) {
      const state = await board.evaluate((el) => ({
        phase: el.getAttribute("data-phase"),
        pending: el.getAttribute("data-pending"),
        kind: el.getAttribute("data-round-kind"),
      }));
      if (state.phase === "roundEnd") {
        if (state.kind === "win") break;
        await page.getByRole("button", { name: "次の局へ" }).first().click();
      } else if (state.pending === "humanReact") {
        await page.getByRole("button", { name: "スルー" }).first().click();
      } else if (state.pending === "humanDiscard") {
        await page
          .getByRole("listbox", { name: "自家の手牌" })
          .first()
          .getByRole("option")
          .first()
          .click();
      }
    }
    await expect(
      page.getByRole("heading", { name: "和了内訳" }).first(),
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

    const board = page.locator("[data-phase]").first();
    let sawAiRiichi = false;
    let sawAiMeld = false;
    for (let step = 0; step < 600 && (!sawAiRiichi || !sawAiMeld); step++) {
      // 自家はリーチも鳴きもしないため、現れたバッジ/副露は必ずAIのもの。
      sawAiRiichi ||=
        (await page.getByTestId("status-badge-riichi").count()) > 0;
      sawAiMeld ||=
        (await page.getByRole("list", { name: "副露" }).count()) > 0;
      if (sawAiRiichi && sawAiMeld) break;

      const state = await board
        .evaluate((element) => ({
          phase: element.getAttribute("data-phase"),
          pending: element.getAttribute("data-pending"),
        }))
        .catch(() => null);
      if (state === null) {
        await page.waitForTimeout(20);
      } else if (state.phase === "roundEnd") {
        await page.getByRole("button", { name: "次の局へ" }).first().click();
      } else if (state.pending === "humanReact") {
        await page.getByRole("button", { name: "スルー" }).first().click();
      } else if (state.pending === "humanDiscard") {
        await page
          .getByRole("listbox", { name: "自家の手牌" })
          .first()
          .getByRole("option")
          .first()
          .click();
      } else {
        await page.waitForTimeout(20);
      }
    }

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

  test("リーチ宣言候補と非候補をマウス・キーボード・SRへ明示する(#168)", async ({
    page,
  }) => {
    await page.goto("/game?seed=381");
    const board = page.locator("[data-phase]").first();
    const hand = page.getByRole("listbox", { name: "自家の手牌" }).first();

    for (let step = 0; step < 60; step++) {
      const riichi = page.getByRole("button", { name: "リーチ", exact: true });
      if (await riichi.count()) {
        await riichi.first().click();
        break;
      }
      const pending = await board.getAttribute("data-pending");
      if (pending === "humanReact") {
        await page.getByRole("button", { name: "スルー" }).first().click();
      } else if (pending === "humanDiscard") {
        await hand.getByRole("option").first().click();
      } else {
        await page.waitForTimeout(20);
      }
    }

    const eligible = hand.getByRole("option", { name: /リーチ可/ });
    const ineligible = hand.getByRole("option", {
      name: /リーチ宣言できません/,
    });
    await expect(eligible.first()).toBeVisible();
    await expect(eligible.first()).not.toHaveAttribute("aria-disabled");
    await expect(ineligible.first()).toHaveAttribute("aria-disabled", "true");
    await expect(ineligible.first()).toContainText("禁止");

    // `aria-disabled` を尊重する Playwright の通常 click は拒否されるため、実ブラウザでの
    // ポインターイベントを再現する force click で理由通知を検証する。
    await ineligible.first().click({ force: true });
    await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
      "この牌ではテンパイを保てないため、リーチ宣言できません。",
    );
    await ineligible.first().focus();
    await page.keyboard.press("Enter");
    await expect(ineligible.first()).toHaveAttribute("aria-disabled", "true");

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
    await page.goto("/game?seed=29");
    const board = page.locator("[data-phase]").first();
    const hand = page.getByRole("listbox", { name: "自家の手牌" }).first();
    let forbidden = hand.getByRole("option", { name: /喰い替え禁止/ });

    for (let step = 0; step < 50 && !(await forbidden.count()); step++) {
      const phase = await board.getAttribute("data-phase");
      const pending = await board.getAttribute("data-pending");
      if (phase === "roundEnd") {
        await page.getByRole("button", { name: "次の局へ" }).first().click();
      } else if (pending === "humanReact") {
        const pon = page.getByRole("button", { name: "ポン" });
        if (await pon.count()) await pon.first().click();
        else await page.getByRole("button", { name: "スルー" }).first().click();
      } else if (pending === "humanDiscard") {
        const legal = hand.locator(
          '[role="option"]:not([aria-disabled="true"])',
        );
        await legal.first().click();
      } else {
        await page.waitForTimeout(20);
      }
      forbidden = hand.getByRole("option", { name: /喰い替え禁止/ });
    }

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
    await page.goto("/game?seed=47");
    const board = page.locator("[data-phase]").first();
    const hand = page.getByRole("listbox", { name: "自家の手牌" }).first();

    for (let step = 0; step < 1500; step++) {
      if (await page.getByText("四槓散了", { exact: true }).count()) break;
      const phase = await board.getAttribute("data-phase");
      const pending = await board.getAttribute("data-pending");
      if (phase === "roundEnd") {
        await page.getByRole("button", { name: "次の局へ" }).first().click();
      } else if (pending === "humanReact") {
        await page.getByRole("button", { name: "スルー" }).first().click();
      } else if (pending === "humanDiscard") {
        await hand.getByRole("option").first().click();
      } else {
        await page.waitForTimeout(20);
      }
    }

    await expect(board).toHaveAttribute("data-phase", "roundEnd");
    await expect(board).toHaveAttribute("data-round-kind", "draw");
    await expect(
      page.getByText("四槓散了", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "次の局へ" }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "次の局へ" }).first().click();
    await expect(board).toHaveAttribute("data-phase", "playing");
  });
});
