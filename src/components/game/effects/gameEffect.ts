import type { GamePhase, PlayerId, RoundSummary } from "@/domain/game/engine";
import type { GameViewState, MeldView, SeatPosition, TileData } from "../types";

/** UI-only effect categories. They never participate in game decisions. */
type GameEffectKind =
  | "riichi"
  | "pon"
  | "kan"
  | "tsumo"
  | "ron"
  | "draw"
  | "roundEnd";

export interface GameEffect {
  readonly kind: GameEffectKind;
  readonly icon: string;
  readonly title: string;
  readonly detail: string;
  readonly announcement: string;
  readonly assertive: boolean;
  readonly playerId?: PlayerId;
}

interface PlayerEffectSnapshot {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly hasDeclaredRiichi: boolean;
  readonly melds: readonly string[];
}

export interface GameEffectSnapshot {
  readonly phase: GamePhase;
  readonly roundKey: string;
  readonly players: readonly PlayerEffectSnapshot[];
  readonly summaryKey: string;
}

const SNAPSHOT_POSITIONS: readonly SeatPosition[] = [
  "self",
  "left",
  "across",
  "right",
];

function tileKey(tile: TileData): string {
  return `${tile.suit}-${tile.rank}-${tile.isRed ? "red" : "normal"}`;
}

function meldKey(meld: MeldView): string {
  return `${meld.type}-${meld.concealed ? "concealed" : "open"}-${meld.tiles
    .map(tileKey)
    .join(",")}`;
}

function playerSnapshotOf(
  player: Extract<
    GameViewState["slots"][SeatPosition],
    { kind: "seated" }
  >["player"],
): PlayerEffectSnapshot {
  return {
    playerId: player.playerId,
    name: player.name,
    hasDeclaredRiichi: player.status?.hasDeclaredRiichi === true,
    melds: (player.melds ?? []).map(meldKey),
  };
}

function summaryKey(summary: RoundSummary | null): string {
  if (summary === null) return "";
  const win = summary.winDetails;
  const deltaKey = Object.entries(summary.deltas)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([playerId, delta]) => `${playerId}:${delta}`)
    .join(",");
  return [
    summary.kind,
    summary.label,
    summary.winnerId ?? "",
    win?.winType ?? "",
    win?.winnerName ?? "",
    win ? tileKey(win.winningTile) : "",
    deltaKey,
  ].join("|");
}

/** Build only the public values needed to recognize a visual transition. */
export function createGameEffectSnapshot(
  view: GameViewState,
  phase: GamePhase,
  roundSummary: RoundSummary | null,
): GameEffectSnapshot {
  return {
    phase,
    roundKey: `${view.tableInfo.roundWind}-${view.tableInfo.handNumber}-${view.tableInfo.honba}`,
    players: SNAPSHOT_POSITIONS.flatMap((position) => {
      const content = view.slots[position];
      return content.kind === "seated"
        ? [playerSnapshotOf(content.player)]
        : [];
    }),
    summaryKey: summaryKey(roundSummary),
  };
}

function playerById(
  snapshot: GameEffectSnapshot,
  playerId: PlayerId,
): PlayerEffectSnapshot | undefined {
  return snapshot.players.find((player) => player.playerId === playerId);
}

function effectForCall(
  current: PlayerEffectSnapshot,
  previous: PlayerEffectSnapshot | undefined,
  index: number,
): GameEffect | null {
  const previousMelds = previous?.melds ?? [];
  const currentMeld = current.melds[index];
  const previousMeld = previousMelds[index];

  // A pon becoming a kan keeps the same meld index, while a new call appends one.
  const changedMeld = currentMeld !== undefined && currentMeld !== previousMeld;
  const addedMeld = current.melds.length > previousMelds.length;
  if (!changedMeld || (!addedMeld && !previousMeld?.startsWith("pon-"))) {
    return null;
  }

  const kind = currentMeld?.startsWith("kan-") ? "kan" : "pon";
  const label = kind === "kan" ? "カン" : "ポン";
  return {
    kind,
    icon: kind === "kan" ? "槓" : "碰",
    title: label,
    detail: `${current.name}が${label}しました。`,
    announcement: `${current.name}が${label}しました。`,
    assertive: false,
    playerId: current.playerId,
  };
}

function effectForRiichi(
  current: PlayerEffectSnapshot,
  previous: PlayerEffectSnapshot | undefined,
): GameEffect | null {
  if (!current.hasDeclaredRiichi || previous?.hasDeclaredRiichi === true) {
    return null;
  }
  return {
    kind: "riichi",
    icon: "宣",
    title: "リーチ",
    detail: `${current.name}がリーチを宣言しました。`,
    announcement: `${current.name}がリーチを宣言しました。`,
    assertive: false,
    playerId: current.playerId,
  };
}

function resolutionEffect(
  phase: GamePhase,
  summary: RoundSummary | null,
  current: GameEffectSnapshot,
): GameEffect {
  if (summary?.kind === "win") {
    const winType = summary.winDetails?.winType;
    const kind = winType === "ron" ? "ron" : "tsumo";
    const label = kind === "ron" ? "ロン" : "ツモ";
    const winnerName =
      summary.winDetails?.winnerName ??
      (summary.winnerId
        ? playerById(current, summary.winnerId)?.name
        : undefined) ??
      "和了者";
    return {
      kind,
      icon: kind === "ron" ? "栄" : "自",
      title: label,
      detail: `${winnerName}の${label}和了。`,
      announcement: `${winnerName}の${label}和了。`,
      assertive: true,
      playerId: summary.winnerId,
    };
  }

  if (summary?.kind === "draw") {
    return {
      kind: "draw",
      icon: "流",
      title: "流局",
      detail: summary.label,
      announcement: `流局。${summary.label}。`,
      assertive: true,
    };
  }

  const gameEnd = phase === "gameEnd";
  return {
    kind: "roundEnd",
    icon: gameEnd ? "終" : "局",
    title: gameEnd ? "半荘終了" : "局終了",
    detail: summary?.label ?? "",
    announcement: gameEnd ? "半荘終了。" : "局が終了しました。",
    assertive: true,
  };
}

/**
 * Recognize one forward UI transition. A null result is intentional for initial
 * hydration, reloads, and transitions that do not need a visual effect.
 */
export function gameEffectForTransition(
  previous: GameEffectSnapshot | null,
  current: GameEffectSnapshot,
  summary: RoundSummary | null,
): GameEffect | null {
  if (previous === null) return null;

  const enteredResolution =
    current.phase !== previous.phase &&
    (current.phase === "roundEnd" || current.phase === "gameEnd");
  const summaryChangedAtResolution =
    current.phase !== "playing" &&
    current.summaryKey !== previous.summaryKey &&
    current.summaryKey !== "";
  if (enteredResolution || summaryChangedAtResolution) {
    return resolutionEffect(current.phase, summary, current);
  }

  // A new round resets every player's meld/riichi state. Do not compare the
  // first snapshot of the new round with the previous round's flags, or a
  // player who declared riichi in both rounds would lose the second cue.
  const sameRound = current.roundKey === previous.roundKey;

  // Scan structural changes before riichi so a call remains visible if a single
  // engine step also advances another player's state.
  for (const player of current.players) {
    const previousPlayer = sameRound
      ? playerById(previous, player.playerId)
      : undefined;
    const maxMeldCount = Math.max(
      player.melds.length,
      previousPlayer?.melds.length ?? 0,
    );
    for (let index = 0; index < maxMeldCount; index += 1) {
      const call = effectForCall(player, previousPlayer, index);
      if (call !== null) return call;
    }
  }

  for (const player of current.players) {
    const riichi = effectForRiichi(
      player,
      sameRound ? playerById(previous, player.playerId) : undefined,
    );
    if (riichi !== null) return riichi;
  }

  return null;
}
