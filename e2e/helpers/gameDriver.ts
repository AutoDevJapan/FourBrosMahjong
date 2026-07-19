import type { Page } from "@playwright/test";

/**
 * 対局進行ドライバ(#260)。3スペック(`game.spec.ts` / `a11y.spec.ts` / `persistence.spec.ts`)で
 * 共有する**唯一の進行ループ実装**。盤面ルートのテスト用フック `data-phase` / `data-pending` /
 * `data-round-kind` を読み、局面に応じて操作を1つずつ選んで「目的条件(predicate)まで進める」。
 *
 * ## ドライバ標準戦略(seed 選定の前提)
 *
 * 決定的 seed(`/game?seed=…`)+ 同一操作列は完全再現するため、各スペックの seed はこの戦略で
 * 目的局面へ到達することを前提に選定されている。戦略を変えると既存 seed が到達しなくなるので、
 * 変更時は必ず seed を再選定すること(オフラインで engine を同一戦略 — 表示順ソート
 * `gameView.ts sortTiles` の先頭牌打牌・`passRon`・`proceedToNextRound` — で走査して選ぶ)。
 *
 * - 自家の打牌: **表示手牌(ソート済み)の先頭牌**を切る。`legalOnly` 指定時は
 *   `aria-disabled` でない先頭牌(自家が鳴かない限り両者は同一)。
 * - リーチ後の自手番(打牌ロック中): ツモ和了できれば「ツモ」、できなければ「ツモ切り」
 *   (ロック中は手牌から打牌できないため。`declareRiichi` の後に進める場合のみ通る分岐)。
 * - 他家打牌への反応(`humanReact`): `onHumanReact` に従いスルー / ポン優先 / ポン→カン優先 /
 *   ロン優先(`ronOrPass`: ロンできればロン、できなければスルー)。
 * - 局終了(`roundEnd`): `onRoundEnd` に従い「次の局へ」を押すか、そこで停止する。
 * - 半荘終了(`gameEnd`): 最終局の決着表示(#277)から `onGameEnd` に従い「結果を見る」を
 *   押して結果画面へ進む("result")か、そこで停止する("stop")。自動遷移は無い。
 *
 * 到達失敗(step 上限まで predicate が真にならない)は明示エラーで顕在化する(誤 pass しない)。
 */

/** 盤面ルートのテスト用フック(`GameBoard` の data-*)のスナップショット。 */
export interface BoardState {
  readonly phase: string | null;
  readonly pending: string | null;
  /** `data-round-kind`(局終了時 "win" / "draw"、それ以外は "none")。 */
  readonly kind: string | null;
}

/** `humanReact`(他家打牌への反応)時の戦略。 */
type ReactStrategy = "pass" | "pon" | "ponOrKan" | "ronOrPass";

export interface AdvanceOptions {
  /** 探索 step 上限(超過で明示エラー)。既定 1500。 */
  readonly maxSteps?: number;
  /** `humanReact` 時の戦略。既定 "pass"(スルー)。 */
  readonly onHumanReact?: ReactStrategy;
  /** 打牌を `aria-disabled` でない牌に限定するか。既定 false(先頭牌)。 */
  readonly legalOnly?: boolean;
  /** `roundEnd` 時に「次の局へ」を押す("next")か、そこで停止する("stop")か。既定 "next"。 */
  readonly onRoundEnd?: "next" | "stop";
  /** `gameEnd` 時に「結果を見る」を押す("result")か、そこで停止する("stop")か。既定 "result"。 */
  readonly onGameEnd?: "result" | "stop";
}

/**
 * 盤面ルートの進行状態を即時 DOM 参照で読む(盤面が無ければ null)。
 *
 * `locator.evaluate` は対象が遷移で消えた場合も既定タイムアウトまで待つため、結果画面への
 * 遷移中(「結果を見る」push 直後に盤面が外れる / #277)でも止まらないよう `page.evaluate` の
 * 即時参照にしている。
 */
async function readBoardState(page: Page): Promise<BoardState | null> {
  return page.evaluate(() => {
    const el = document.querySelector("[data-phase]");
    return el
      ? {
          phase: el.getAttribute("data-phase"),
          pending: el.getAttribute("data-pending"),
          kind: el.getAttribute("data-round-kind"),
        }
      : null;
  });
}

/** 可視の自家手牌 listbox(2レイアウト分 DOM にあるため可視側に限定)。 */
export function visibleHand(page: Page) {
  return page
    .getByRole("listbox", { name: "自家の手牌" })
    .filter({ visible: true })
    .first();
}

/**
 * 可視の操作パネルボタン(段階①/段階② の2レイアウト分 DOM にあるため可視側に限定)。
 * 狭幅ビューポートで局終了/半荘終了に到達しても display:none 側を掴んで click タイムアウトしない。
 */
function visibleActionButton(page: Page, name: string) {
  return page.getByRole("button", { name }).filter({ visible: true }).first();
}

/** 自家の打牌: 表示手牌の先頭牌(`legalOnly` 時は `aria-disabled` でない先頭牌)を切る。 */
async function discardFirstTile(page: Page, legalOnly: boolean): Promise<void> {
  const hand = visibleHand(page);
  const tile = legalOnly
    ? hand.locator('[role="option"]:not([aria-disabled="true"])').first()
    : hand.getByRole("option").first();
  await tile.click();
}

/** `humanReact` の反応: 戦略に応じてロン/ポン/カン/スルーのボタンを1つ押す。 */
async function react(page: Page, strategy: ReactStrategy): Promise<void> {
  if (strategy === "ronOrPass") {
    const ron = page.getByRole("button", { name: "ロン" });
    if (await ron.count()) {
      await ron.first().click();
      return;
    }
    await page.getByRole("button", { name: "スルー" }).first().click();
    return;
  }
  if (strategy !== "pass") {
    const pon = page.getByRole("button", { name: "ポン" });
    if (await pon.count()) {
      await pon.first().click();
      return;
    }
    if (strategy === "ponOrKan") {
      const kan = page.getByRole("button", { name: "カン" });
      if (await kan.count()) {
        await kan.first().click();
        return;
      }
    }
  }
  await page.getByRole("button", { name: "スルー" }).first().click();
}

/**
 * 目的条件 `until` が真になるまで対局を進める。
 *
 * 各 step の冒頭で `until(state)` を評価し、真なら即座に戻る(roundEnd の「次の局へ」より先に
 * 判定するため、「win の局終了で停止」等も predicate だけで書ける)。`maxSteps` を使い切ったら
 * 明示エラーを投げる(到達失敗が後段アサーションのタイムアウトに化けない)。
 */
export async function advanceUntil(
  page: Page,
  until: (state: BoardState | null) => boolean | Promise<boolean>,
  options: AdvanceOptions = {},
): Promise<void> {
  const {
    maxSteps = 1500,
    onHumanReact = "pass",
    legalOnly = false,
    onRoundEnd = "next",
    onGameEnd = "result",
  } = options;

  let lastState: BoardState | null = null;
  for (let step = 0; step < maxSteps; step++) {
    const state = await readBoardState(page);
    lastState = state;
    if (await until(state)) return;
    if (state === null) {
      // 遷移直後などで盤面が一時的に取れないときは少し待って再判定する。
      await page.waitForTimeout(20);
      continue;
    }
    if (state.phase === "gameEnd") {
      // 半荘終了は最終局の決着表示で停止する(#277: 自動遷移は無い)。既定は
      // 「結果を見る」を押して結果画面へ進む(predicate が URL 側で停止を判定できる)。
      // predicate が phase="gameEnd" で真になる呼び出しでは、ループ冒頭の until 評価で先に
      // 返るため本分岐には到達しない("stop" は predicate が gameEnd を含まない場合の保険)。
      if (onGameEnd === "stop") return;
      await visibleActionButton(page, "結果を見る").click();
      // push の完了を待ってから次ループへ(未完了のまま再クリックして履歴を重複させない)。
      // 失敗は握り潰さず throw させ、advanceUntil の「到達失敗は明示エラー」保証を保つ。
      await page.waitForURL((url) => url.pathname === "/game/result", {
        timeout: 10_000,
      });
      continue;
    }
    if (state.phase === "roundEnd") {
      if (onRoundEnd === "stop") return;
      await visibleActionButton(page, "次の局へ").click();
      continue;
    }
    if (state.pending === "humanReact") {
      await react(page, onHumanReact);
      continue;
    }
    if (state.pending === "humanDiscard") {
      // リーチ後の自手番は打牌がロックされ、手牌クリックは no-op になる(「ツモ切り」ボタンは
      // ロック中のみ描画される)。ツモ和了できれば「ツモ」、できなければ「ツモ切り」で進める。
      const tsumogiri = page.getByRole("button", { name: "ツモ切り" });
      if (await tsumogiri.count()) {
        const tsumo = page
          .getByRole("button", { name: "ツモ", exact: true })
          .first();
        if (await tsumo.isEnabled()) await tsumo.click();
        else await tsumogiri.first().click();
        continue;
      }
      await discardFirstTile(page, legalOnly);
      continue;
    }
    // AI の手番など操作対象が無い局面は進行を待つ。
    await page.waitForTimeout(20);
  }
  throw new Error(
    `advanceUntil: ${maxSteps} step 以内に目的局面へ到達しなかった` +
      `(最終状態: phase=${lastState?.phase ?? "盤面なし"}, pending=${lastState?.pending ?? "-"})`,
  );
}

/**
 * 標準戦略で進め、「リーチ」ボタンが現れた手番(門前テンパイ)でそれを押して宣言モードに入る。
 * 宣言牌の選択はしない(候補/非候補の検証はこの直後に呼び出し側で行う)。
 */
export async function armRiichi(
  page: Page,
  options: AdvanceOptions = {},
): Promise<void> {
  const riichiButton = page.getByRole("button", {
    name: "リーチ",
    exact: true,
  });
  await advanceUntil(page, async () => (await riichiButton.count()) > 0, {
    maxSteps: 60,
    onRoundEnd: "stop",
    ...options,
  });
  // onRoundEnd: "stop" の早期 return(局終了)をボタン click の不明瞭なタイムアウトに
  // 化けさせず、seed 退行を明示エラーで診断できるようにする。
  if (!(await riichiButton.count())) {
    throw new Error("armRiichi: リーチ可能手番へ到達する前に局が終了した");
  }
  await riichiButton.first().click();
}

/**
 * リーチ宣言を完了する: `armRiichi` の後、engine が合法とした「リーチ可」の牌を切る。
 * 合法性は aria-label にも公開されるため、無効牌の試行に依存せず決定的に操作できる。
 */
export async function declareRiichi(
  page: Page,
  options: AdvanceOptions = {},
): Promise<void> {
  await armRiichi(page, options);
  await visibleHand(page)
    .getByRole("option", { name: /リーチ可/ })
    .first()
    .click();
}
