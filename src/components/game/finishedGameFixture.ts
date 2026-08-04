/**
 * 半荘を完走させる**テスト専用**フィクスチャ(unit / e2e 共用)。本番コードからは import しない。
 *
 * 打牌はツモ切り・ロン/鳴きは見送り・局終了ごとに次局へ、という単純方針で実エンジンを
 * 決定的に進める(engine は安全上限を持つため必ず終局する)。
 *
 * engine の遷移は内部状態(Wall 等)を破壊的に更新するため、**途中局面を state の参照で
 * 取り置くことはできない**。途中局面が必要な場合は、返り値の `journal` を `replayJournal`
 * で途中まで再生して新規に構築すること。
 */
import {
  createGame,
  DEFAULT_NAMES,
  discard,
  type EngineState,
  passRon,
  proceedToNextRound,
} from "@/domain/game/engine";
import type { GameAction, GameJournal } from "./gamePersistence";

export interface FinishedGameFixture {
  /** 終局までの検証済み操作列(sessionStorage 注入・部分再生用)。 */
  readonly journal: GameJournal;
  /** 完走後の終局(gameEnd)状態。 */
  readonly state: EngineState;
}

/** 実エンジンで1半荘を完走させ、操作列と終局状態を返す(seed 固定で決定的)。 */
export function walkToGameEnd(seed: number): FinishedGameFixture {
  let s = createGame({ seed });
  const actions: GameAction[] = [];
  for (let guard = 0; guard < 5000 && s.phase !== "gameEnd"; guard++) {
    if (s.phase === "roundEnd") {
      actions.push({ type: "nextRound" });
      s = proceedToNextRound(s);
    } else if (s.pending?.kind === "humanDiscard") {
      const drawn = s.hand?.drawn?.tile;
      if (!drawn) throw new Error("打牌待ちなのにツモ牌がない");
      actions.push({ type: "discard", tile: drawn });
      s = discard(s, drawn);
    } else if (s.pending?.kind === "humanReact") {
      actions.push({ type: "passRon" });
      s = passRon(s);
    } else {
      throw new Error(`予期しない局面: phase=${s.phase}`);
    }
  }
  if (s.phase !== "gameEnd") throw new Error("半荘が終了しなかった");
  return {
    journal: { version: 2, seed, names: DEFAULT_NAMES, actions },
    state: s,
  };
}
