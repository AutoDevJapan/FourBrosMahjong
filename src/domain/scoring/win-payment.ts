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
   * パオ責任者ID(役満のパオ成立時のみ)。指定時は責任払い:
   * ツモは責任者が全額、ロンは放銃者と責任者で折半。
   *
   * 本関数は役満か否かを検査しない。折半規則は任意の `score.ronTotal` に対して
   * 定義され、端数は 100 点単位へ切り上げて責任者が負担する(スペック3 3.1)。
   */
  readonly paoResponsibleId?: PlayerId;
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
    ["score.ronTotal", score.ronTotal],
    ["score.tsumo.fromDealer", score.tsumo.fromDealer],
    ["score.tsumo.fromNonDealer", score.tsumo.fromNonDealer],
    ["score.tsumo.total", score.tsumo.total],
  ] as const) {
    assertNonNegativeSafeInteger(value, name);
  }
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
    resolveRon(input, honba, pay);
  } else {
    resolveTsumo(input, honba, pay);
  }

  return {
    deltas,
    stickPayout: safeMultiply(riichiSticks, RIICHI_STICK_POINTS, "stickPayout"),
  };
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
