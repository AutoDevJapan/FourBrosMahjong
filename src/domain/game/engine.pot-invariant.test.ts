/**
 * engine レベルの点棒保存則 **`Σ持ち点 + 場に残る供託 = 140,000`** の不変条件テスト(#430)。
 *
 * spec `documents/spec/scoring-and-settlement.md` 3.3「供託の集約と保存則」の保存則を、
 * **精算入口ではなく engine の公開アクション境界**で固定する。
 * `src/domain/scoring/settlement.test.ts` は `SoshiiLedger` の入口(= 供託を畳み込んだ後の
 * 最終持ち点)しか見ないため、engine 側で場へ点棒を移す経路が増えても入口に届くまで無言で
 * 破れる。ここでは供託レジストリの集約 {@link potTotal} を使い、**ドライバが実行した各遷移の
 * 直後**で保存則を確認する。
 *
 * **カバレッジの実態(過大主張を避けるための明示)**:
 * - 検査点は「1回の公開アクション呼び出しの直後」であり、**AI の手番境界は含まない**
 *   (1回の公開アクションの内部で AI の手番が複数進むため)。
 * - 当初の単一の貪欲ドライバでは**公開アクション11種のうち6種**(`passRon` / `declareKan` /
 *   `tsumogiri` / `declareTsumo` / `declareRon` / `declareAnkan`)に一度も到達しておらず、
 *   それらの経路に点棒漏れを注入しても本ファイルは緑のままだった(`passRon` へ 1,000点の
 *   漏れを入れても本ファイル3件は全て緑 / 精算入口の `RangeError` でしか捕まらない)。
 *   そこで**方策の異なる4ドライバ**({@link POLICIES})と、自家の打牌に AI と同じ
 *   `chooseDiscard`(ツモ切り固定では手が前進せずテンパイ系の手が出ない)を使い、
 *   **全公開アクション種別を1回以上踏むこと自体をアサート**する(`公開アクション種別の網羅`)。
 *   踏んでいない種別がある = その経路の保存則が未検査、なのでこれは空振り検出そのものである。
 * - 同様に、終局時の畳み込み分岐(`endGame` の `residual > 0`)も旧シードでは一度も
 *   踏んでおらず `potTotal(end) === 0` が空振りで通っていた。最終局が流局で供託が残る
 *   シード(12 / 14 / 37)を混ぜ、`endGameFolds` で実際に踏んだ回数を固定する。
 * - それでも本テストが保証するのは「**踏んだ経路**で保存則が成立すること」に限られる。
 *   現状 engine から到達不能な経路(`質問リスト.md` Q29 のチョンボ罰符 = `chomboPenalty` は
 *   engine に呼び出し元が無い)に供託を足しても本テストは緑のままなので、**新種別の
 *   `POT_SOURCES` 登録は結線 PR のレビュー確認事項として残る**。
 *
 * **なぜ `potTotal` を使うか**: 個別種別(`state.riichiSticks`)ではなく集約を参照することで、
 * 供託レジストリ `POT_SOURCES` へ新種別を登録すれば本テストは**自動的に**その種別を含む。
 * 逆に「ドライバが踏む経路で場へ点棒を移すのにレジストリへ登録しない」実装は red になる。
 *
 * **両方向の欠陥注入(実測 / #430 の PR で実施)**: 仮の供託種別(チョンボ満貫罰符 8,000点 =
 * `chomboSticks` 8本)を `EngineState` へ足し、`createGame` の時点で持ち点から場へ移した。
 * - **`POT_SOURCES` へ登録した場合** … 保存則も `endGame` も緑のまま。畳み込み後に
 *   `potTotal = 0` / `Σ持ち点 = 140,000` へ復し、ソシー精算も zero-sum(= 種別を足すだけで
 *   自動的に畳み込まれる)。
 * - **登録しなかった場合** … 保存則が red(`expected 132000 to be 140000`)になり、`endGame` は
 *   精算入口 `SoshiiLedger.applyUma` で
 *   `RangeError: final points must total 140000 (35000 x 4), received 132000 …` を投げる
 *   (= issue #430 が指摘する対局中クラッシュ)。
 * 注入は検証後に完全に復元済み(engine 側に残骸なし)。
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { RoundNumber, RoundState, RoundWind } from "../round/round";
import type { PlayerRing } from "../round/seat";
import { TOTAL_POINTS } from "../scoring/settlement";
import type { Tile } from "../tiles/tile";
import { chooseDiscard } from "./ai";
import {
  createGame,
  declareAnkan,
  declareKakan,
  declareKan,
  declarePon,
  declareRiichi,
  declareRon,
  declareTsumo,
  discard,
  type EngineState,
  finishRound,
  type Pending,
  type PlayerId,
  POT_SOURCES,
  passRon,
  potTotal,
  proceedToNextRound,
  type RoundConclusion,
  seatOfPlayer,
  tsumogiri,
  withdrawPot,
} from "./engine";

/** 起家=p0 の固定円環(createGame と同一)。 */
const ORDER: PlayerRing<PlayerId> = ["p0", "p1", "p2", "p3"];

/** 4人の持ち点合計。 */
function pointsSum(state: EngineState): number {
  return ORDER.reduce((acc, id) => acc + state.points[id], 0);
}

/**
 * 保存則: `Σ持ち点 + 場の供託 = 140,000`。
 * 供託は**集約**で数えるため、登録済みの種別はすべて自動的に対象になる。
 */
function expectPointsConserved(state: EngineState, label: string): void {
  expect(pointsSum(state) + potTotal(state), label).toBe(TOTAL_POINTS);
}

// ---------------------------------------------------------------------------
// 公開アクションを網羅するドライバ
// ---------------------------------------------------------------------------

/** 走査で踏んだ公開アクションの識別子。 */
type ActionKind =
  | "discard"
  | "tsumogiri"
  | "declareRiichi"
  | "declarePon"
  | "declareKan"
  | "declareAnkan"
  | "declareKakan"
  | "declareTsumo"
  | "declareRon"
  | "passRon"
  | "proceedToNextRound";

/** 網羅を要求する公開アクション(= 点棒を動かし得る `engine.ts` の export)。 */
const ALL_ACTIONS: readonly ActionKind[] = [
  "discard",
  "tsumogiri",
  "declareRiichi",
  "declarePon",
  "declareKan",
  "declareAnkan",
  "declareKakan",
  "declareTsumo",
  "declareRon",
  "passRon",
  "proceedToNextRound",
];

/**
 * ドライバの方策。合法手の**選び方**だけを変える(engine には手を入れない)。
 *
 * 貪欲な `aggressive` 単独では `passRon`(鳴かずに流す)・`declareKan`(ポンより先に大明槓)・
 * `tsumogiri`(リーチ後の自動ツモ切り)へ構造的に到達できない。優先順位を変えた方策を
 * 併走させることで全公開アクションを踏む。
 */
const POLICIES = [
  /** 常に最大限鳴く(ロン > ポン > 明槓)。 */
  "aggressive",
  /** ポンより明槓を優先し、加槓より暗槓を優先する(大明槓・暗槓の到達用)。 */
  "kanFirst",
  /** 一切鳴かず・リーチせず(`passRon` と流局→供託持ち越しの到達用)。 */
  "passive",
  /** 鳴かないが必ずリーチする(門前を保ち `declareRiichi` → `tsumogiri` の到達用)。 */
  "riichiFirst",
] as const;

type Policy = (typeof POLICIES)[number];

/**
 * 自家の打牌を選ぶ。**AI と同じ `chooseDiscard`(向聴/受け入れ)を使う**。
 *
 * ツモ切り固定にすると自家の手が配牌から一切前進せず、テンパイ由来の公開アクション
 * (`declareRiichi` → `tsumogiri`、`declareTsumo`、`declareRon`)へ実質的に到達できない。
 * 打牌の巧拙は本テストの関心事ではないので、既存の AI 方策をそのまま借りる。
 */
function humanDiscardTile(
  s: EngineState,
  pending: Extract<Pending, { kind: "humanDiscard" }>,
): Tile {
  const hand = s.hand;
  const seat = hand ? seatOfPlayer(hand.seating, "p0") : null;
  if (hand == null || seat == null)
    throw new Error("humanDiscard without a hand");
  const tiles = [...hand.hands[seat], ...(hand.drawn ? [hand.drawn] : [])];
  return chooseDiscard({
    tiles,
    meldCount: hand.melds[seat].length,
    forbiddenDiscards: pending.forbiddenDiscards,
  });
}

/** 提示された合法手を方策に従って1つ選び、1手進める。 */
function advance(
  s: EngineState,
  policy: Policy,
): { readonly next: EngineState; readonly action: ActionKind } {
  if (s.phase === "roundEnd")
    return { next: proceedToNextRound(s), action: "proceedToNextRound" };

  const pending = s.pending;

  if (pending?.kind === "humanReact") {
    // 和了は方策によらず取る(取らないと保存則の「場 → 持ち点」方向が痩せる)。
    if (pending.canRon) return { next: declareRon(s), action: "declareRon" };
    if (policy === "passive" || policy === "riichiFirst")
      return { next: passRon(s), action: "passRon" };
    if (policy === "kanFirst" && pending.canKan)
      return { next: declareKan(s), action: "declareKan" };
    if (pending.canPon) return { next: declarePon(s), action: "declarePon" };
    if (pending.canKan) return { next: declareKan(s), action: "declareKan" };
    return { next: passRon(s), action: "passRon" };
  }

  if (pending?.kind === "humanDiscard") {
    if (pending.canTsumo)
      return { next: declareTsumo(s), action: "declareTsumo" };
    // リーチ後は打牌がツモ切りに固定される(= `tsumogiri` の唯一の到達経路)。
    if (pending.locked) return { next: tsumogiri(s), action: "tsumogiri" };

    if (policy !== "passive") {
      if (policy === "kanFirst" && pending.ankanTiles.length > 0)
        return {
          next: declareAnkan(s, pending.ankanTiles[0]),
          action: "declareAnkan",
        };
      if (pending.kakanTiles.length > 0)
        return {
          next: declareKakan(s, pending.kakanTiles[0]),
          action: "declareKakan",
        };
      if (pending.ankanTiles.length > 0)
        return {
          next: declareAnkan(s, pending.ankanTiles[0]),
          action: "declareAnkan",
        };
    }

    if (pending.canRiichi && policy !== "passive")
      return {
        next: declareRiichi(s, pending.riichiTiles[0]),
        action: "declareRiichi",
      };

    return {
      next: discard(s, humanDiscardTile(s, pending)),
      action: "discard",
    };
  }

  throw new Error(
    `stuck: phase=${s.phase} pending=${s.pending?.kind ?? "none"}`,
  );
}

/** 走査全体の集計(空振り防止の実測値つき)。 */
interface SweepTotals {
  /** 実行した遷移数。 */
  steps: number;
  /** 途中で場に載った供託の最大額。 */
  maxPotSeen: number;
  /** 供託が増えた遷移の数(リーチ宣言 = 持ち点 → 場)。 */
  potIn: number;
  /** 供託が減った遷移の数(和了時の回収・終局時の畳み込み = 場 → 持ち点)。 */
  potOut: number;
  /** 完走した半荘の数。 */
  games: number;
  /** **終局時に供託が場に残っていて `endGame` が畳み込んだ**半荘の数。 */
  endGameFolds: number;
  /** 公開アクション種別ごとの実行回数。 */
  actions: Map<ActionKind, number>;
}

/** 1半荘を方策 `policy` で完走させ、**各遷移の直後**に保存則を確認する。 */
function playChecked(
  seed: number,
  policy: Policy,
  totals: SweepTotals,
): EngineState {
  let s = createGame({ seed });
  expectPointsConserved(s, `${policy} seed=${seed} step=init`);
  let step = 0;
  for (let guard = 0; guard < 8000 && s.phase !== "gameEnd"; guard++) {
    const beforePot = potTotal(s);
    const { next, action } = advance(s, policy);
    s = next;
    step += 1;
    totals.steps += 1;
    totals.actions.set(action, (totals.actions.get(action) ?? 0) + 1);
    const afterPot = potTotal(s);
    totals.maxPotSeen = Math.max(totals.maxPotSeen, afterPot);
    if (afterPot > beforePot) totals.potIn += 1;
    if (afterPot < beforePot) totals.potOut += 1;
    expectPointsConserved(s, `${policy} seed=${seed} step=${step}`);
  }
  totals.games += 1;
  // `endGame` が残存供託を畳み込んだ半荘か(内訳が記録されるのは残存があったときだけ)。
  if (s.lastRound?.residualSticks != null) totals.endGameFolds += 1;
  return s;
}

/** 指定の場/局の局状態(`engine.residual-riichi.test.ts` と同じ組み立て)。 */
function roundAt(
  wind: RoundWind,
  roundNumber: RoundNumber,
): RoundState<PlayerId> {
  return { order: ORDER, wind, roundNumber, honba: 0 };
}

/**
 * オーラス(南4)親流れ流局で `finishRound` → `endGame` を発火させる状態。
 *
 * **まず `withdrawPot` で全種別を場から下ろしてから** `overrides` で必要な供託だけを置く。
 * こうしないと「供託はリーチ棒だけ」を暗黙に仮定した固定値(`potTotal === 2000` など)に
 * なり、`POT_SOURCES` へ種別を1つ足しただけでこのファイルが red になる — つまり本 PR の
 * 主張(「1エントリ足すだけでよい」)を、テスト側が自分で反証してしまう。
 *
 * 供託カウンタは `overrides` で個別に差し替える(`{ riichiSticks: 2 }` など)。位置引数では
 * 供託種別が増えるたびに引数が増えるため、`Partial<EngineState>` で受ける。
 */
function endGameStateWith(
  points: Record<PlayerId, number>,
  overrides: Partial<EngineState> = {},
): EngineState {
  const base = withdrawPot(createGame({ seed: 430 }));
  return { ...base, round: roundAt("south", 4), points, ...overrides };
}

/** 南4親流れ流局(オーラス完了で半荘終了)の決着結果。 */
const OORASU_DRAW: RoundConclusion = {
  outcome: "dealerPasses",
  isDraw: true,
  summary: {
    kind: "draw",
    label: "流局",
    deltas: { p0: 0, p1: 0, p2: 0, p3: 0 },
  },
};

describe("engine 不変条件: Σ持ち点 + 場の供託 = 140,000(#430)", () => {
  // 4方策 × 6シード = 24半荘を1度だけ走らせ、以降の it で集計値を検査する。
  // 12 / 14 / 37 は**最終局が流局で供託が場に残る**シード(= `endGame` の残存供託の
  // 畳み込み分岐を実際に踏む)。他のシードはいずれも最終局が和了決着になり、この分岐へ
  // 入らないため、意図的に混ぜてある(空振り防止 / 下の `endGameFolds` を参照)。
  const SEEDS = [1, 8, 12, 14, 37, 99] as const;
  const totals: SweepTotals = {
    steps: 0,
    maxPotSeen: 0,
    potIn: 0,
    potOut: 0,
    games: 0,
    endGameFolds: 0,
    actions: new Map(),
  };
  const ends: { policy: Policy; seed: number; end: EngineState }[] = [];

  // 既定の hookTimeout(10s)では CI の並列実行下で不安定になり得るため明示的に伸ばす
  // (`vitest.config.ts` の unit プロジェクトが testTimeout を伸ばしているのと同じ理由 / #262)。
  beforeAll(() => {
    for (const policy of POLICIES) {
      for (const seed of SEEDS) {
        ends.push({ policy, seed, end: playChecked(seed, policy, totals) });
      }
    }
  }, 60_000);

  it("各遷移の直後で保存則が成立し、終局時には供託が場に残らない", () => {
    expect(ends).toHaveLength(POLICIES.length * SEEDS.length);
    for (const { policy, seed, end } of ends) {
      const label = `${policy} seed=${seed}`;
      expect(end.phase, label).toBe("gameEnd");
      // 終局時は全種別の供託が畳み込まれ、場には何も残らない。
      expect(potTotal(end), `${label} pot at gameEnd`).toBe(0);
      expect(pointsSum(end), `${label} points at gameEnd`).toBe(TOTAL_POINTS);
      // 精算はゼロサム(供託の畳み込み漏れがあると成立しない)。
      // `result` が null だと reduce が黙って 0 を返すため、先に存在を固定する。
      expect(end.result, `${label} result`).toHaveLength(ORDER.length);
      const soshii = (end.result ?? []).reduce((a, r) => a + r.soshiiTotal, 0);
      expect(soshii, `${label} soshii`).toBe(0);
    }
  });

  it("公開アクション種別の網羅(踏んでいない経路は保存則が未検査になる)", () => {
    const missing = ALL_ACTIONS.filter(
      (a) => (totals.actions.get(a) ?? 0) === 0,
    );
    expect(
      missing,
      `未踏の公開アクション。実測=${JSON.stringify(
        Object.fromEntries(totals.actions),
      )}`,
    ).toEqual([]);
  });

  it("走査が実質的である(空振り防止の下限)", () => {
    // 閾値は実測値(下記)に対して十分低く取り、AI 方策(`documents/adr/0002-ai-policy.md`)や
    // 配牌側の調整で不安定にならない範囲で「走査が実質的である」ことだけを固定する。
    //   steps=2,348 / maxPotSeen=4,000 / potIn=167 / potOut=131 / games=24 / endGameFolds=6
    expect(totals.games, "完走した半荘数").toBe(POLICIES.length * SEEDS.length);
    expect(totals.steps, "遷移数").toBeGreaterThan(1000);
    // **持ち点 → 場**(リーチ宣言)と **場 → 持ち点**(和了時の回収・終局時の畳み込み)の
    // 双方向の点棒移動を実際に跨いで保存則を検査していること。単なる `> 0` だと
    // 1半荘だけが供託を動かしても通ってしまうため、実測より十分低い実数で固定する。
    expect(totals.maxPotSeen, "場に載った供託の最大額").toBeGreaterThanOrEqual(
      2000,
    );
    expect(totals.potIn, "供託が増えた遷移(リーチ宣言)").toBeGreaterThanOrEqual(
      40,
    );
    expect(
      totals.potOut,
      "供託が減った遷移(回収・畳み込み)",
    ).toBeGreaterThanOrEqual(40);
    // 走査が `endGame` の**残存供託の畳み込み分岐**(`residual > 0`)を実際に踏むこと。
    // 貪欲ドライバ単独・旧シードでは最終局が必ず和了決着になり、この分岐へ一度も入って
    // いなかった(= `potTotal(end) === 0` が空振りで通っていた)。実測 6。
    expect(
      totals.endGameFolds,
      "終局時に供託を畳み込んだ半荘数",
    ).toBeGreaterThanOrEqual(2);
  });

  it("終局時の畳み込みは供託の集約に対して行われる(残存あり → 場は 0・合計は 140,000)", () => {
    // sum(points) = 138,000 = 140,000 − 供託2本。畳み込み前は保存則が「供託込み」で成立し、
    // 畳み込み後は持ち点だけで 140,000 に復する。
    const points: Record<PlayerId, number> = {
      p0: 50000,
      p1: 40000,
      p2: 30000,
      p3: 18000,
    };
    const before = endGameStateWith(points, { riichiSticks: 2 });
    expect(pointsSum(before)).toBe(TOTAL_POINTS - 2000);
    expect(potTotal(before)).toBe(2000);
    expectPointsConserved(before, "before endGame");

    const end = finishRound(before, OORASU_DRAW);
    expect(end.phase).toBe("gameEnd");
    expect(potTotal(end)).toBe(0);
    expect(pointsSum(end)).toBe(TOTAL_POINTS);
    expectPointsConserved(end, "after endGame");
  });

  it("供託が場に無ければ終局処理は持ち点を動かさない", () => {
    const points: Record<PlayerId, number> = {
      p0: 50000,
      p1: 40000,
      p2: 30000,
      p3: 20000,
    };
    const end = finishRound(
      endGameStateWith(points, { riichiSticks: 0 }),
      OORASU_DRAW,
    );
    expect(end.points).toEqual(points);
    expect(potTotal(end)).toBe(0);
    expectPointsConserved(end, "no pot");
  });
});

describe("供託レジストリの契約(#430)", () => {
  const points: Record<PlayerId, number> = {
    p0: 50000,
    p1: 40000,
    p2: 30000,
    p3: 18000,
  };

  it("種別ごとの points は非負整数で、合計が potTotal に一致する", () => {
    const state = endGameStateWith(points, { riichiSticks: 2 });
    let sum = 0;
    for (const source of POT_SOURCES) {
      const p = source.points(state);
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      sum += p;
    }
    expect(sum).toBe(potTotal(state));
  });

  it("カウンタが 0 の種別は同一参照を返す(no-op が no-op のまま保たれる)", () => {
    // `endGame` が `potTotal > 0` のガード無しで `withdrawPot` を呼べる根拠。この契約が
    // 破れても保存則は破れないため、契約そのものをここで固定する。
    const empty = endGameStateWith(points, { riichiSticks: 0 });
    for (const source of POT_SOURCES) {
      expect(source.withdraw(empty)).toBe(empty);
    }
    expect(withdrawPot(empty)).toBe(empty);
  });

  it("withdrawPot 後は全種別が 0 になり、持ち点と lastRound は変えない", () => {
    // 下ろした点数を帰属先の持ち点へ移すのは呼び出し側(`endGame`)の責務であり、
    // `withdraw` は自分のカウンタ以外に触れてはならない。
    const state = endGameStateWith(points, { riichiSticks: 3 });
    const withdrawn = withdrawPot(state);
    expect(potTotal(withdrawn)).toBe(0);
    for (const source of POT_SOURCES) {
      expect(source.points(withdrawn)).toBe(0);
    }
    expect(withdrawn.points).toEqual(state.points);
    expect(withdrawn.lastRound).toBe(state.lastRound);
  });
});
