/**
 * 対局エンジン状態(`src/domain/game/engine.ts`)→ UI 表示ビューモデル(`./types`)への写像。
 *
 * スペック6 6.8 の方針(UI は「値を受け取って表示する」)を保ちつつ、ダミーではなく**実対局状態**を
 * 表示用に投影する層。ドメイン(engine)と UI 型の境界に位置し、決定ロジックは engine 側が持つ。
 *
 * 物理スロット(自家/上家/対面/下家)の割当は**自家を常に下段(self)**に固定し、
 * 残り3人を固定円環の相対位置で上家/対面/下家へ写す(局が進んでも見た目の座席は安定)。
 * その局の役割(東/南/西/抜け番)は engine の席割りから求める。
 */
import {
  type EngineState,
  HUMAN_ID,
  type PlayerId,
  seatOfPlayer,
} from "@/domain/game/engine";
import { evaluateFuriten } from "@/domain/hand/furiten";
import { seatingOf } from "@/domain/round/round";
import type { Seating } from "@/domain/round/seat";
import { createTile, type Tile } from "@/domain/tiles/tile";
import type {
  BenchPlayerView,
  DoraData,
  GameResultView,
  GameViewState,
  RiverTileData,
  SeatedPlayerView,
  SeatPosition,
  SeatWind,
  SlotContent,
  TableInfoData,
  TileData,
} from "./viewTypes";

/** ドメイン `Tile` → 表示 `TileData`(構造互換の写像)。 */
function toTileData(tile: Tile): TileData {
  return { suit: tile.suit, rank: tile.rank, isRed: tile.isRed };
}

/**
 * ドメインの河牌を表示用へ写像する。宣言牌の位置は engine が記録した表示メタデータ
 * だけを参照し、合法性や得点の再判定は行わない。
 */
function toRiverTileData(
  tile: Tile,
  index: number,
  riichiDiscardIndex: number | null,
): RiverTileData {
  const data = toTileData(tile);
  return index === riichiDiscardIndex ? { ...data, isRiichi: true } : data;
}

/** 表示 `TileData` → ドメイン `Tile`(打牌をエンジンへ戻す際に使用)。 */
export function toTile(tile: TileData): Tile {
  return createTile(tile.suit, tile.rank);
}

/** 牌の表示ソート(萬→筒→索→字、同スートは rank 昇順、赤は同種内で後ろ)。 */
const SUIT_ORDER: Record<Tile["suit"], number> = {
  man: 0,
  pin: 1,
  sou: 2,
  honor: 3,
};
/** 自家手牌と和了形開示(`WinDetails` #259)で共用する表示ソート。 */
export function sortTiles(tiles: readonly Tile[]): Tile[] {
  return [...tiles].sort(
    (a, b) =>
      SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] ||
      a.rank - b.rank ||
      Number(a.isRed) - Number(b.isRed),
  );
}

/** 席 → 表示用の席風ラベル。 */
function seatWindOf(seat: "east" | "south" | "west"): SeatWind {
  return seat;
}

/** 円環インデックス差 → 物理スロット(自家基準)。 */
const OFFSET_TO_SLOT: readonly SeatPosition[] = [
  "self",
  "right",
  "across",
  "left",
];

function nameOf(engine: EngineState, id: PlayerId): string {
  return engine.players.find((p) => p.id === id)?.name ?? id;
}

/** 1プレイヤー分のスロット内容(着席 or 抜け番)を作る。 */
function buildSlotContent(
  engine: EngineState,
  id: PlayerId,
  selfId: PlayerId,
): SlotContent {
  const hand = engine.hand;
  const seating: Seating<PlayerId> = hand
    ? hand.seating
    : seatingOf(engine.round);
  const seat = seatOfPlayer(seating, id);

  // 半荘を終える局は roundEnd を経由せず gameEnd へ直行する(engine spec 2.8)ため、
  // 最終局の点数増減(±デルタ)は gameEnd でも表示する(#277)。gameEnd の残存供託
  // 畳み込み(#282)は抜け番にも及び得るため、着席・抜け番の両方で写像する。
  const showDelta =
    (engine.phase === "roundEnd" || engine.phase === "gameEnd") &&
    engine.lastRound
      ? engine.lastRound.deltas[id]
      : 0;

  if (seat === null) {
    const bench: BenchPlayerView = {
      playerId: id,
      name: nameOf(engine, id),
      points: engine.points[id],
      ...(showDelta !== 0 ? { pointsDelta: showDelta } : {}),
    };
    return { kind: "bench", player: bench };
  }

  const isSelf = id === selfId;
  const isTurn = engine.phase === "playing" && hand?.turn === seat;
  const melds = hand
    ? hand.melds[seat].map((m) => ({
        type: m.type,
        tiles: m.tiles.map(toTileData),
        concealed: m.concealed,
      }))
    : [];
  const furiten =
    isSelf && hand
      ? evaluateFuriten({
          concealedTiles: hand.hands[seat],
          melds: hand.melds[seat].map((meld) => ({
            tiles: meld.tiles,
            isKan: meld.type === "kan",
            concealed: meld.concealed,
          })),
          ownDiscardHistory: hand.discardHistory[seat],
          temporaryMiss: hand.tempMiss[seat],
          riichiMiss: hand.riichiMiss[seat],
        })
      : null;

  const seated: SeatedPlayerView = {
    playerId: id,
    name: nameOf(engine, id),
    points: engine.points[id],
    ...(showDelta !== 0 ? { pointsDelta: showDelta } : {}),
    seatWind: seatWindOf(seat),
    status: {
      isDealer: seat === "east",
      isCurrentTurn: isTurn,
      hasDeclaredRiichi: hand ? hand.riichi[seat] : false,
      ...(furiten?.reason ? { furitenReason: furiten.reason } : {}),
    },
    ...(melds.length > 0 ? { melds } : {}),
    kitaCount: hand?.kita[seat] ?? 0,
    discards: hand
      ? hand.discards[seat].map((tile, index) =>
          toRiverTileData(tile, index, hand.riichiDiscardIndex[seat]),
        )
      : [],
    ...(isSelf && hand
      ? {
          hand: sortTiles([
            ...hand.hands[seat],
            ...(isTurn && hand.drawn ? [hand.drawn.tile] : []),
          ]).map(toTileData),
        }
      : {
          handCount:
            (hand ? hand.hands[seat].length : 0) +
            (isTurn && hand?.drawn ? 1 : 0),
        }),
  };
  return { kind: "seated", player: seated };
}

function buildResult(engine: EngineState): GameResultView | null {
  if (engine.result === null) return null;
  return {
    players: engine.result.map((r) => ({
      playerId: r.playerId,
      name: r.name,
      rank: r.rank,
      rawScore: r.rawScore,
      uma: r.uma,
      bonus: r.bonus,
      soshiiTotal: r.soshiiTotal,
    })),
  };
}

/** エンジン状態を対局画面のビューモデルへ写像する。 */
export function selectView(
  engine: EngineState,
  selfId: PlayerId = HUMAN_ID,
): GameViewState {
  const humanIndex = engine.order.indexOf(selfId);
  const slots = {} as Record<SeatPosition, SlotContent>;
  engine.order.forEach((id, ringIndex) => {
    const offset = (ringIndex - humanIndex + 4) % 4;
    slots[OFFSET_TO_SLOT[offset]] = buildSlotContent(engine, id, selfId);
  });

  const tableInfo: TableInfoData = {
    roundWind: engine.round.wind,
    handNumber: engine.round.roundNumber,
    honba: engine.round.honba,
    riichiSticks: engine.riichiSticks,
    remainingLiveTiles: engine.hand?.wall.remainingLiveTiles ?? 0,
    dice: engine.hand?.dice ?? [1, 2],
    doraCount: engine.hand?.doraSet.count ?? 0,
  };

  // 裏ドラはリーチ和了の局終了時のみ開示する(スペック2 2.2)。半荘を終える局は
  // roundEnd を経由せず gameEnd へ直行する(engine spec 2.8 / #277)ため、最終局の
  // リーチ和了でも開示できるよう両 phase を対象にする(#290)。
  const revealUra =
    (engine.phase === "roundEnd" || engine.phase === "gameEnd") &&
    engine.lastRound?.riichiWin === true &&
    engine.hand !== null;
  const dora: DoraData = engine.hand
    ? {
        indicators: engine.hand.doraSet.indicators.map(toTileData),
        uraIndicatorCount: engine.hand.doraSet.count,
        ...(revealUra
          ? { uraIndicators: engine.hand.doraSet.uraIndicators.map(toTileData) }
          : {}),
      }
    : { indicators: [], uraIndicatorCount: 0 };

  return { slots, tableInfo, dora, result: buildResult(engine) };
}
