/**
 * 和了時の持ち点移動の解決(スペック3 3.1・3.4 / issue #66・#86)。
 *
 * {@link "./points".computeScore} が求めた点数を、実際の各プレイヤーの持ち点
 * 増減へ落とし込む。ロン(放銃者払い)/ツモ(サンマ北家折半)、パオ(責任払い)、
 * 本場、供託(リーチ棒)回収、チョンボ罰符を扱う。
 *
 * 席・親の決定(#81 round)には依存せず、呼び出し側(#67 統合)が渡す
 * **プレイヤーID + 親フラグ**のみで動作する(疎結合)。
 *
 * 純ロジック・決定的・React/DOM 非依存。
 */

import type { ScoreResult } from "./points";

/** プレイヤー識別子(呼び出し側が席から写像する)。 */
export type PlayerId = string;

/** 在席プレイヤーの参照(親か否か)。 */
export interface SeatedPlayerRef {
  readonly id: PlayerId;
  readonly isDealer: boolean;
}

/** 役満1単位の責任払い情報。`multiplier` は役満倍数(通常は1)。 */
interface YakumanPaymentComponent {
  readonly multiplier: number;
  /** この役満単位のパオ責任者。未指定なら通常の支払い。 */
  readonly paoResponsibleId?: PlayerId;
}

/** 本場1つあたりの加点(標準)。 */
const HONBA_UNIT_TSUMO = 100;
const HONBA_UNIT_RON = 300;
/** 供託リーチ棒1本の点。 */
const RIICHI_STICK_POINTS = 1000;

/** 和了時の点数移動の入力。 */
export interface WinPaymentInput {
  readonly winner: SeatedPlayerRef;
  readonly winType: "tsumo" | "ron";
  readonly score: ScoreResult;
  /** ロン時の放銃者ID(ロンでは必須)。 */
  readonly discarderId?: PlayerId;
  /** 和了者以外の在席プレイヤー(サンマでは2人)。 */
  readonly others: readonly SeatedPlayerRef[];
  /**
   * パオ責任者ID(役満のパオ成立時のみ)。指定時は従来の集約型責任払い:
   * ツモは責任者が全額、ロンは放銃者と責任者で折半。
   *
   * 役満単位の内訳を渡す新規呼び出しでは {@link yakumanComponents} を使う。
   * このフィールドは既存呼び出しとの互換性のため残し、指定時は `score` 総額全体に
   * 責任払いを適用する。
   *
   * 本関数は役満か否かを検査しない。折半規則は任意の `score.ronTotal` に対して
   * 定義され、端数は 100 点単位へ切り上げて責任者が負担する(スペック3 3.1)。
   */
  readonly paoResponsibleId?: PlayerId;
  /**
   * 構成役満を役満単位へ分解した責任払い情報。各要素の合計 `multiplier` は
   * `score.basePoints / 8,000` と一致しなければならない。パオ対象単位だけに
   * `paoResponsibleId` を指定し、非対象単位は省略する。
   *
   * `paoResponsibleId` とは併用しない。複合役満では、パオ対象単位を責任者ごとに
   * ロン折半/ツモ全額、非対象単位を通常支払いとして処理する。
   */
  readonly yakumanComponents?: readonly YakumanPaymentComponent[];
  /** 本場数(0 以上の整数)。既定 0。 */
  readonly honba?: number;
  /** 場の供託リーチ棒の本数(和了者が回収)。既定 0。 */
  readonly riichiSticks?: number;
}

/** 和了時の点数移動の結果。 */
export interface WinPaymentResult {
  /**
   * プレイヤーIDごとの持ち点増減(点数移動のみ、**総和ゼロ**)。
   * 供託回収は含めない({@link stickPayout} を参照)。
   */
  readonly deltas: Record<PlayerId, number>;
  /** 和了者が回収した供託点(= 本数 × 1000)。和了者に別途加算する。 */
  readonly stickPayout: number;
}

function ceil100(value: number): number {
  return Math.ceil(value / 100) * 100;
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${name} must be a non-negative safe integer, received ${value}.`,
    );
  }
}

function safeAdd(left: number, right: number, name: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${name} exceeds the safe integer range.`);
  }
  return result;
}

function safeMultiply(left: number, right: number, name: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${name} exceeds the safe integer range.`);
  }
  return result;
}

function assertSafeScore(score: ScoreResult): void {
  for (const [name, value] of [
    ["score.basePoints", score.basePoints],
    ["score.ronTotal", score.ronTotal],
    ["score.tsumo.fromDealer", score.tsumo.fromDealer],
    ["score.tsumo.fromNonDealer", score.tsumo.fromNonDealer],
    ["score.tsumo.total", score.tsumo.total],
  ] as const) {
    assertNonNegativeSafeInteger(value, name);
  }
}

interface ResolvedYakumanPaymentComponent {
  readonly multiplier: number;
  readonly paoResponsibleId?: PlayerId;
  readonly ronTotal: number;
  readonly tsumo: ScoreResult["tsumo"];
}

/**
 * 複合役満の内訳を検証し、ScoreResult の各支払額へ比例展開する。
 * 構成役満の点数は役満倍数に対して線形なので、各値は整数のまま分解できる。
 */
function resolveYakumanComponents(
  input: WinPaymentInput,
): readonly ResolvedYakumanPaymentComponent[] | null {
  const components = input.yakumanComponents;
  if (components === undefined) return null;
  if (input.paoResponsibleId !== undefined) {
    throw new RangeError(
      "paoResponsibleId and yakumanComponents cannot be used together.",
    );
  }
  if (!input.score.isTrueYakuman || components.length === 0) {
    throw new RangeError(
      "yakumanComponents require a non-empty true-yakuman score.",
    );
  }

  const totalMultiplier = input.score.basePoints / 8000;
  if (!Number.isSafeInteger(totalMultiplier) || totalMultiplier < 1) {
    throw new RangeError(
      "true-yakuman score.basePoints must be a positive multiple of 8000.",
    );
  }

  const knownPayers = new Set(input.others.map((player) => player.id));
  let componentMultiplier = 0;
  const resolved = components.map((component, index) => {
    if (
      !Number.isSafeInteger(component.multiplier) ||
      component.multiplier < 1
    ) {
      throw new RangeError(
        `yakumanComponents[${index}].multiplier must be a positive safe integer.`,
      );
    }
    if (
      component.paoResponsibleId !== undefined &&
      (component.paoResponsibleId === input.winner.id ||
        !knownPayers.has(component.paoResponsibleId))
    ) {
      throw new RangeError(
        `yakumanComponents[${index}].paoResponsibleId must identify an opponent.`,
      );
    }
    componentMultiplier = safeAdd(
      componentMultiplier,
      component.multiplier,
      "yakuman component multiplier",
    );

    const scale = (value: number, name: string): number => {
      if (value % totalMultiplier !== 0) {
        throw new RangeError(
          `${name} cannot be split into ${totalMultiplier} yakuman units.`,
        );
      }
      return safeMultiply(
        value / totalMultiplier,
        component.multiplier,
        `${name} component`,
      );
    };

    return {
      multiplier: component.multiplier,
      paoResponsibleId: component.paoResponsibleId,
      ronTotal: scale(input.score.ronTotal, "score.ronTotal"),
      tsumo: {
        fromDealer: scale(
          input.score.tsumo.fromDealer,
          "score.tsumo.fromDealer",
        ),
        fromNonDealer: scale(
          input.score.tsumo.fromNonDealer,
          "score.tsumo.fromNonDealer",
        ),
        total: scale(input.score.tsumo.total, "score.tsumo.total"),
      },
    };
  });

  if (componentMultiplier !== totalMultiplier) {
    throw new RangeError(
      `yakumanComponents must total ${totalMultiplier} yakuman units, received ${componentMultiplier}.`,
    );
  }
  return resolved;
}

/**
 * 和了の持ち点移動を解決する。
 *
 * @throws RangeError ロンで `discarderId` 未指定、本場/供託が不正なとき。
 */
export function resolveWinPayment(input: WinPaymentInput): WinPaymentResult {
  const honba = input.honba ?? 0;
  const riichiSticks = input.riichiSticks ?? 0;
  assertNonNegativeSafeInteger(honba, "honba");
  assertNonNegativeSafeInteger(riichiSticks, "riichiSticks");
  assertSafeScore(input.score);
  const yakumanComponents = resolveYakumanComponents(input);

  const deltas: Record<PlayerId, number> = { [input.winner.id]: 0 };
  for (const o of input.others) deltas[o.id] = 0;
  const pay = (id: PlayerId, amount: number): void => {
    assertNonNegativeSafeInteger(amount, "payment amount");
    deltas[id] = safeAdd(deltas[id] ?? 0, -amount, `delta for ${id}`);
    deltas[input.winner.id] = safeAdd(
      deltas[input.winner.id],
      amount,
      `delta for ${input.winner.id}`,
    );
  };

  if (input.winType === "ron") {
    if (yakumanComponents === null) {
      resolveRon(input, honba, pay);
    } else {
      resolveYakumanRon(input, honba, pay, yakumanComponents);
    }
  } else {
    if (yakumanComponents === null) {
      resolveTsumo(input, honba, pay);
    } else {
      resolveYakumanTsumo(input, honba, pay, yakumanComponents);
    }
  }

  return {
    deltas,
    stickPayout: safeMultiply(riichiSticks, RIICHI_STICK_POINTS, "stickPayout"),
  };
}

function resolveYakumanRon(
  input: WinPaymentInput,
  honba: number,
  pay: (id: PlayerId, amount: number) => void,
  components: readonly ResolvedYakumanPaymentComponent[],
): void {
  const discarderId = input.discarderId;
  if (discarderId === undefined) {
    throw new RangeError("ron win requires discarderId.");
  }

  for (const component of components) {
    if (component.paoResponsibleId === undefined) {
      pay(discarderId, component.ronTotal);
      continue;
    }
    if (component.paoResponsibleId === discarderId) {
      pay(discarderId, component.ronTotal);
      continue;
    }
    const paoShare = ceil100(component.ronTotal / 2);
    pay(component.paoResponsibleId, paoShare);
    pay(discarderId, component.ronTotal - paoShare);
  }

  // 本場は役満の構成単位とは独立し、ロンでは常に放銃者が一括負担する。
  const honbaBonus = safeMultiply(HONBA_UNIT_RON, honba, "honba bonus");
  if (honbaBonus > 0) pay(discarderId, honbaBonus);
}

function resolveYakumanTsumo(
  input: WinPaymentInput,
  honba: number,
  pay: (id: PlayerId, amount: number) => void,
  components: readonly ResolvedYakumanPaymentComponent[],
): void {
  for (const component of components) {
    if (component.paoResponsibleId !== undefined) {
      pay(component.paoResponsibleId, component.tsumo.total);
      continue;
    }
    for (const other of input.others) {
      const base = other.isDealer
        ? component.tsumo.fromDealer
        : component.tsumo.fromNonDealer;
      pay(other.id, base);
    }
  }

  const honbaEach = safeMultiply(HONBA_UNIT_TSUMO, honba, "honba payment");
  if (honbaEach === 0) return;

  const paoResponsibleIds = [
    ...new Set(
      components
        .map((component) => component.paoResponsibleId)
        .filter((id): id is PlayerId => id !== undefined),
    ),
  ];
  // 既存の単独パオ・ツモの簡略(責任者が300×本場を一括負担)を維持する。
  // 複数責任者/非パオ役満との複合では、1人を恣意的に選ばず通常ツモ本場に戻す。
  const solePaoResponsibleId = paoResponsibleIds[0];
  if (
    components.every((component) => component.paoResponsibleId !== undefined) &&
    solePaoResponsibleId !== undefined &&
    paoResponsibleIds.length === 1
  ) {
    pay(
      solePaoResponsibleId,
      safeMultiply(HONBA_UNIT_RON, honba, "pao tsumo honba"),
    );
    return;
  }
  for (const other of input.others) pay(other.id, honbaEach);
}

function resolveRon(
  input: WinPaymentInput,
  honba: number,
  pay: (id: PlayerId, amount: number) => void,
): void {
  const discarderId = input.discarderId;
  if (discarderId === undefined) {
    throw new RangeError("ron win requires discarderId.");
  }
  const honbaBonus = safeMultiply(HONBA_UNIT_RON, honba, "honba bonus");
  const total = input.score.ronTotal;

  if (input.paoResponsibleId !== undefined) {
    // パオ・ロン: 放銃者と責任者で点数を折半(責任者=放銃者なら全額1人)。
    // 折半はスペック3 3.1「端数」に従い 100 点単位へ切り上げ、残差は放銃者が負担する。
    // パオ対象は構成役満のみで、その総額は基本点 8,000 × 役満倍数 の 4 倍(子)/6 倍(親)
    // = 必ず 200 の倍数になるため、現行仕様で端数は発生しない。点数体系やパオ対象が
    // 変わったときに切り上げ側が静かに入れ替わらないよう確定挙動として固定してある
    // (win-payment.test.ts「パオ・ロンの折半端数」/ #389)。
    const paoShare = ceil100(total / 2);
    const discarderShare = total - paoShare;
    if (input.paoResponsibleId === discarderId) {
      pay(discarderId, total);
    } else {
      pay(input.paoResponsibleId, paoShare);
      pay(discarderId, discarderShare);
    }
  } else {
    pay(discarderId, total);
  }
  // 本場は放銃者が負担(パオでも放銃者持ち = 標準)。
  if (honbaBonus > 0) pay(discarderId, honbaBonus);
}

function resolveTsumo(
  input: WinPaymentInput,
  honba: number,
  pay: (id: PlayerId, amount: number) => void,
): void {
  const honbaEach = safeMultiply(HONBA_UNIT_TSUMO, honba, "honba payment");

  if (input.paoResponsibleId !== undefined) {
    // パオ・ツモ: 責任者が全額を負担。本場も責任者が全額。
    pay(
      input.paoResponsibleId,
      safeAdd(
        input.score.tsumo.total,
        safeMultiply(HONBA_UNIT_RON, honba, "honba bonus"),
        "pao tsumo payment",
      ),
    );
    return;
  }

  const { fromDealer, fromNonDealer } = input.score.tsumo;
  for (const o of input.others) {
    const base = o.isDealer ? fromDealer : fromNonDealer;
    pay(o.id, safeAdd(base, honbaEach, "tsumo payment"));
  }
}

/** チョンボ罰符の結果(スペック3 3.4)。 */
export interface ChomboResult {
  /** 罰符点(満貫罰符相当: 親 12,000 / 子 8,000)。 */
  readonly penalty: number;
}

/**
 * チョンボ罰符を算出する(スペック3 3.4)。
 *
 * **暫定運用**: 満貫罰符相当を**供託扱い**とする(spec 明記)。呼び出し側で
 * チョンボ者の持ち点から {@link ChomboResult.penalty} を引き、同額を場の供託へ
 * 積む。誰に支払うか(直接授受 vs 供託)は spec が「供託扱い(暫定)」とする。
 */
export function chomboPenalty(offenderIsDealer: boolean): ChomboResult {
  return { penalty: offenderIsDealer ? 12000 : 8000 };
}
