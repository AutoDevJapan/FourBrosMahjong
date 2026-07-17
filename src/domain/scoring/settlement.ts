/**
 * ソシー精算台帳 `SoshiiLedger`(スペック3 3.3 / スペック4 4.1 / issue #66・#86)。
 *
 * 半荘を通じてプレイヤーごとのソシー累計を保持する。精算は3要素の合算:
 * - **① 素点**(1点=1ソシー、返し 40,000 基準) … {@link SoshiiLedger.applyRawScore}
 * - **② 順位ウマ + オカ**(4人の最終順位、Q13) … {@link SoshiiLedger.applyUma}
 * - **③ 役満祝儀**(抜け番含む他3兄弟から各1,000・先着1名・数え役満対象外) … {@link SoshiiLedger.applyBonus}
 *
 * **ゼロサム不変条件**: 素点(返し)は総和 −(オカ) になり、ウマ+オカで総和 0 に戻る。
 * すなわち `applyRawScore` と `applyUma` を各半荘で1回ずつ適用した合計は総和ゼロ
 * (35,000持ち×4 − 返し40,000×4 = −20,000 を、オカ +20,000 が1位で相殺)。
 * 祝儀は和了者以外の3兄弟(抜け番含む)からの授受でこれも総和ゼロ。
 *
 * 席・親(#81 round)には依存せず、プレイヤーIDのみで動作する。
 * 純ロジック・決定的・React/DOM 非依存。
 */

import type { ScoreResult } from "./points";
import type { PlayerId } from "./win-payment";

export type { PlayerId };

/** 配給原点(各プレイヤーの半荘開始持ち点)。 */
export const STARTING_POINTS = 35000;
/** 返し(オカ算出の基準点)。 */
export const RETURN_POINTS = 40000;
/**
 * オカ(1位が受け取る額)= (返し − 配給原点) × 人数 = (40,000 − 35,000) × 4 = 20,000。
 */
export const OKA = (RETURN_POINTS - STARTING_POINTS) * 4;
/** 順位ウマ(千ソシー単位、順位 0=1位 … 3=4位)。総和ゼロ。 */
export const UMA: readonly [number, number, number, number] = [
  10000, 5000, -5000, -10000,
];
/** 役満祝儀1件あたりの額(和了者以外の3兄弟が各々1,000ソシーを支払う)。 */
export const YAKUMAN_BONUS = 1000;

/** 順位付け対象の1プレイヤーの最終持ち点。 */
export interface PlayerPoints {
  readonly playerId: PlayerId;
  /** 半荘終了時の持ち点(1点=1ソシー)。 */
  readonly points: number;
}

/** 役満祝儀の適用入力。 */
export interface BonusInput {
  readonly winnerId: PlayerId;
  /**
   * 祝儀を支払う者。四兄弟麻雀では**抜け番を含む和了者以外の3兄弟**
   * (Q14 確定・ユーザー承認 2026-07-17 / #129)。各々 {@link YAKUMAN_BONUS} を支払う。
   * 支払者の選定は呼び出し側(engine `settleWin`)が行い、本メソッドは中立に授受する。
   */
  readonly loserIds: readonly PlayerId[];
  /** 点数区分の判定結果({@link "./points".computeScore})。 */
  readonly score: Pick<ScoreResult, "isTrueYakuman" | "isCountedYakuman">;
}

/** ウマ+オカの1プレイヤー分の内訳(監査・テスト用)。 */
export interface UmaBreakdown {
  readonly playerId: PlayerId;
  /** 0=1位 … 3=4位。 */
  readonly rank: number;
  readonly uma: number;
  /** オカ(1位のみ >0)。 */
  readonly oka: number;
}

/**
 * ソシー精算台帳。半荘単位で生成し、局中(祝儀)と半荘終了時(素点・ウマ)に適用する。
 */
export class SoshiiLedger {
  private readonly _balances: Map<PlayerId, number>;
  private _bonusAwarded = false;

  /** @param playerIds 4兄弟のID。重複不可。 */
  constructor(playerIds: readonly PlayerId[]) {
    this._balances = new Map(playerIds.map((id) => [id, 0]));
    if (this._balances.size !== playerIds.length) {
      throw new RangeError("playerIds must be unique.");
    }
  }

  /** 半荘中に役満祝儀が既に確定済みか(先着1名判定用)。 */
  get bonusAwarded(): boolean {
    return this._bonusAwarded;
  }

  private add(id: PlayerId, amount: number): void {
    const current = this._balances.get(id);
    if (current === undefined) {
      throw new RangeError(`unknown playerId: ${id}`);
    }
    this._balances.set(id, current + amount);
  }

  /**
   * ① 素点をソシーへ反映(1点=1ソシー、返し 40,000 基準)。
   * 各プレイヤーに `points − 返し40,000` を加算する。オカ(1位加点)は
   * {@link applyUma} 側で付与し、両者の合計で総和ゼロになる。
   */
  applyRawScore(finalPoints: readonly PlayerPoints[]): void {
    for (const { playerId, points } of finalPoints) {
      this.add(playerId, points - RETURN_POINTS);
    }
  }

  /**
   * ② 順位ウマ + オカを反映(Q13)。半荘終了時、着席/抜け番を問わず
   * **4兄弟全員**を最終持ち点で順位付けし、ウマ +10/+5/−5/−10(千ソシー)を
   * 適用、オカ +20,000 を1位へ付与する。
   *
   * 同点のタイブレークは `finalPoints` の**配列順(起家/席順)**で確定する
   * (先の要素が上位)。spec がタイブレークを明示しないための決定的規則。
   *
   * @returns 各プレイヤーのウマ/オカ内訳(順位順・監査用)。
   * @throws RangeError プレイヤー数が4でない、または未知のIDのとき。
   */
  applyUma(finalPoints: readonly PlayerPoints[]): UmaBreakdown[] {
    if (finalPoints.length !== 4) {
      throw new RangeError(
        `applyUma requires exactly 4 players, received ${finalPoints.length}.`,
      );
    }
    const ranked = finalPoints
      .map((p, index) => ({ p, index }))
      .sort((a, b) => b.p.points - a.p.points || a.index - b.index);

    const breakdown: UmaBreakdown[] = [];
    ranked.forEach(({ p }, rank) => {
      const uma = UMA[rank];
      const oka = rank === 0 ? OKA : 0;
      this.add(p.playerId, uma + oka);
      breakdown.push({ playerId: p.playerId, rank, uma, oka });
    });
    return breakdown;
  }

  /**
   * ③ 役満祝儀を反映(スペック3 3.3③)。
   * **構成役満**(大三元等)かつ**数え役満でない**かつ**その半荘で先着1名**の
   * ときのみ、各 loser が {@link YAKUMAN_BONUS} を和了者へ支払う。支払者は
   * **抜け番を含む和了者以外の3兄弟**(Q14 確定 / #129)を呼び出し側が渡す。
   *
   * パオ(責任払い)は点数側({@link "./win-payment"})の話で、祝儀は
   * spec 通り「全員から1,000」を維持する(パオでも祝儀の支払者は変わらない)。
   *
   * @returns 祝儀が確定したか(先着済み・数え役満・非役満なら false)。
   */
  applyBonus(input: BonusInput): boolean {
    if (this._bonusAwarded) return false;
    if (!input.score.isTrueYakuman || input.score.isCountedYakuman)
      return false;

    for (const loserId of input.loserIds) {
      this.add(loserId, -YAKUMAN_BONUS);
      this.add(input.winnerId, YAKUMAN_BONUS);
    }
    this._bonusAwarded = true;
    return true;
  }

  /** 現在のソシー残高スナップショット。 */
  balances(): Record<PlayerId, number> {
    return Object.fromEntries(this._balances);
  }

  /** 指定プレイヤーのソシー残高。 */
  balanceOf(id: PlayerId): number {
    const v = this._balances.get(id);
    if (v === undefined) throw new RangeError(`unknown playerId: ${id}`);
    return v;
  }

  /** ソシー残高の降順で並べたプレイヤーID(同点は初期登録順)。 */
  ranking(): PlayerId[] {
    return [...this._balances.entries()]
      .map(([id, balance], index) => ({ id, balance, index }))
      .sort((a, b) => b.balance - a.balance || a.index - b.index)
      .map((x) => x.id);
  }
}
