import { MAX_OMOTE_DORA_COUNT } from "@/domain/dora/dice";
import { CHARACTER_PLAYER_IDS } from "@/domain/game/characters";
import type { TileData } from "@/domain/game/viewTypes";
import { ROUNDS_PER_WIND } from "@/domain/round/round";
import { TOTAL_POINTS } from "@/domain/scoring/settlement";
import { COPIES_PER_TILE, TOTAL_TILE_COUNT } from "@/domain/tiles/tileSet";
import {
  hasDisallowedPlayerNameControls,
  isValidPlayerName,
  isWellFormedPlayerName,
} from "@/lib/playerName";
import type {
  OnlineErrorCode,
  OnlineMaintenanceAcceptingNotice,
  OnlineMaintenanceNotice,
  OnlineMaintenancePhase,
  OnlineRateLimitScope,
  OnlineServerMessage,
  OnlineSnapshot,
} from "./types";

export const MAX_MAINTENANCE_RETRY_AFTER_MS = 10 * 60 * 1_000;

const SLOT_POSITIONS = ["self", "right", "across", "left"] as const;
/** 表示コンポーネントが配列を展開する値のゲーム上の上限。 */
export const MAX_VISIBLE_HAND_TILES = 14;
const MAX_MELD_TILES = 4;
const MAX_MELD_COUNT = 4;
const MAX_KITA_COUNT = COPIES_PER_TILE;
const MAX_DORA_INDICATOR_COUNT = MAX_OMOTE_DORA_COUNT;
/** 和了内訳で展開する役の最大数。現行役カタログに将来追加分の余裕を持たせる。 */
export const MAX_WIN_YAKU_ENTRIES = 32;
/** 和了者以外の4兄弟全員が支払者になり得る場合の最大支払い件数。 */
export const MAX_WIN_PAYMENT_ENTRIES = CHARACTER_PLAYER_IDS.length - 1;
/** 現行engineの安全な局数上限(連荘を含む)。 */
const MAX_SNAPSHOT_ROUNDS = 32;
/** 現行engineの着席人数。 */
const SEATED_PLAYER_COUNT = CHARACTER_PLAYER_IDS.length - 1;
/** 対局中に表示できる1人分の持ち点の絶対上限。 */
export const MAX_SNAPSHOT_POINTS = TOTAL_POINTS;
/** 局の点差・支払額・残余供託を含む表示点数の絶対上限。 */
export const MAX_SNAPSHOT_POINT_DELTA = TOTAL_POINTS * 2;
/** 精算表示の各数値に役満祝儀・ウマを含めるための絶対上限。 */
export const MAX_SNAPSHOT_RESULT_VALUE = TOTAL_POINTS * 2;
/** 1つの役/ドラ内訳が取り得る、物理牌数を基準にした翻数上限。 */
export const MAX_SNAPSHOT_HAN = TOTAL_TILE_COUNT;
/** 現行役カタログで同時に成立し得る役満倍数の上限。 */
export const MAX_SNAPSHOT_YAKUMAN = 4;
/** 東南戦の局番号上限。 */
export const MAX_SNAPSHOT_HAND_NUMBER = ROUNDS_PER_WIND;
/** 現行engineの局数安全上限から導出した本場上限。 */
export const MAX_SNAPSHOT_HONBA = MAX_SNAPSHOT_ROUNDS;
/** 1局3人までのリーチ宣言を局数安全上限まで積み上げた供託本数上限。 */
export const MAX_SNAPSHOT_RIICHI_STICKS =
  MAX_SNAPSHOT_ROUNDS * SEATED_PLAYER_COUNT;
const RESULT_RANKS = [1, 2, 3, 4] as const;
const SCORE_CATEGORIES = [
  "normal",
  "mangan",
  "haneman",
  "baiman",
  "sanbaiman",
  "yakuman",
] as const;
type ScoreCategory = (typeof SCORE_CATEGORIES)[number];
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlayerId(
  value: unknown,
): value is (typeof CHARACTER_PLAYER_IDS)[number] {
  return CHARACTER_PLAYER_IDS.includes(
    value as (typeof CHARACTER_PLAYER_IDS)[number],
  );
}

function resultIdentityMode(
  view: Record<string, unknown>,
): "none" | "legacy" | "current" | "invalid" {
  if (view.result === null) return "none";
  if (
    !isRecord(view.result) ||
    !Array.isArray(view.result.players) ||
    view.result.players.length !== 4 ||
    !view.result.players.every(isRecord)
  ) {
    return "invalid";
  }
  const ownsPlayerIds = view.result.players.map((player) =>
    Object.hasOwn(player, "playerId"),
  );
  if (ownsPlayerIds.every((owns) => !owns)) return "legacy";
  return ownsPlayerIds.every(Boolean) &&
    view.result.players.every((player) => isPlayerId(player.playerId))
    ? "current"
    : "invalid";
}

function normalizeSnapshot(value: unknown): OnlineSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    typeof value.version !== "number" ||
    !isPlayerId(value.you) ||
    typeof value.phase !== "string" ||
    !isRecord(value.view) ||
    !isRecord(value.view.slots) ||
    !Array.isArray(value.players) ||
    !value.players.every(
      (player) =>
        isRecord(player) &&
        isPlayerId(player.id) &&
        typeof player.isHost === "boolean",
    )
  ) {
    return null;
  }

  const slots = value.view.slots;
  const slotPlayers = SLOT_POSITIONS.map((position) => {
    const slot = slots[position];
    return isRecord(slot) && isRecord(slot.player) ? slot.player : null;
  });
  if (slotPlayers.some((player) => player === null)) return null;
  const ownsPlayerIds = slotPlayers.map(
    (player) => player !== null && Object.hasOwn(player, "playerId"),
  );
  const hasValidPlayerIds = slotPlayers.map((player) =>
    isPlayerId(player?.playerId),
  );
  const selfIndex = CHARACTER_PLAYER_IDS.indexOf(value.you);
  const expectedPlayerIds = SLOT_POSITIONS.map(
    (_, offset) =>
      CHARACTER_PLAYER_IDS[(selfIndex + offset) % CHARACTER_PLAYER_IDS.length],
  );
  const currentHostFields =
    Object.hasOwn(value, "hostId") && Object.hasOwn(value, "hostNotice");
  const resultMode = resultIdentityMode(value.view);
  if (
    ownsPlayerIds.every(Boolean) &&
    hasValidPlayerIds.every(Boolean) &&
    currentHostFields &&
    (resultMode === "none" || resultMode === "current")
  ) {
    const candidate = value as unknown as OnlineSnapshot;
    return slotPlayers.every(
      (player, index) => player?.playerId === expectedPlayerIds[index],
    ) && isOnlineSnapshot(candidate)
      ? candidate
      : null;
  }

  // The deployed 1c8cc9 schema predates host-handoff and character-ID fields.
  // Normalize that exact legacy shape using the engine's stable p0→p1→p2→p3
  // ring; never infer identity from editable names.
  if (
    ownsPlayerIds.some(Boolean) ||
    Object.hasOwn(value, "hostId") ||
    Object.hasOwn(value, "hostNotice") ||
    Object.hasOwn(value, "explicitKita") ||
    Object.hasOwn(value, "departureNotice") ||
    (resultMode !== "none" && resultMode !== "legacy")
  ) {
    return null;
  }
  const normalizedSlots = Object.fromEntries(
    SLOT_POSITIONS.map((position, offset) => {
      const slot = slots[position] as Record<string, unknown>;
      const player = slotPlayers[offset] as Record<string, unknown>;
      return [
        position,
        {
          ...slot,
          player: {
            ...player,
            playerId:
              CHARACTER_PLAYER_IDS[
                (selfIndex + offset) % CHARACTER_PLAYER_IDS.length
              ],
          },
        },
      ];
    }),
  );
  const hosts = value.players.filter(
    (player) => isRecord(player) && player.isHost === true,
  );
  if (hosts.length !== 1) return null;
  const host = hosts[0];
  const candidate = {
    ...value,
    hostId: isRecord(host) && isPlayerId(host.id) ? host.id : null,
    hostNotice: null,
    view: { ...value.view, slots: normalizedSlots },
  } as unknown as OnlineSnapshot;
  return isOnlineSnapshot(candidate) ? candidate : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isBoundedNonNegativeInteger(
  value: unknown,
  maximum: number,
): value is number {
  return isBoundedInteger(value, 0, maximum);
}

function isBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isOptionalBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return value === undefined || isBoundedInteger(value, minimum, maximum);
}

function isBoundedString(value: unknown, maximum = 2_048): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    isWellFormedPlayerName(value) &&
    !hasDisallowedPlayerNameControls(value)
  );
}

function isScoreCategory(value: unknown): value is ScoreCategory {
  return (
    typeof value === "string" &&
    SCORE_CATEGORIES.includes(value as ScoreCategory)
  );
}

/** サーバーから届く対局者名は共有ポリシーの正規形だけを表示境界へ通す。 */
function isPlayerName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    isValidPlayerName(value) &&
    isWellFormedPlayerName(value)
  );
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isOptionalPointDelta(value: unknown): boolean {
  return isOptionalBoundedInteger(
    value,
    -MAX_SNAPSHOT_POINT_DELTA,
    MAX_SNAPSHOT_POINT_DELTA,
  );
}

function isTile(value: unknown): value is TileData {
  if (!isRecord(value)) return false;
  const validSuit =
    value.suit === "man" ||
    value.suit === "pin" ||
    value.suit === "sou" ||
    value.suit === "honor";
  return (
    validSuit &&
    isInteger(value.rank) &&
    ((value.suit === "honor" && value.rank >= 1 && value.rank <= 7) ||
      (value.suit !== "honor" && value.rank >= 1 && value.rank <= 9)) &&
    isOptionalBoolean(value.isRed)
  );
}

function isTileArray(
  value: unknown,
  maximum = TOTAL_TILE_COUNT,
): value is readonly TileData[] {
  return Array.isArray(value) && value.length <= maximum && value.every(isTile);
}

function isPlayerStatus(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOptionalBoolean(value.isDealer) &&
    isOptionalBoolean(value.isCurrentTurn) &&
    isOptionalBoolean(value.hasDeclaredRiichi) &&
    (value.furitenReason === undefined ||
      value.furitenReason === "discard" ||
      value.furitenReason === "temporary" ||
      value.furitenReason === "riichi")
  );
}

function isMeld(value: unknown): boolean {
  if (
    !isRecord(value) ||
    (value.type !== "pon" && value.type !== "kan") ||
    !isTileArray(value.tiles, MAX_MELD_TILES) ||
    typeof value.concealed !== "boolean"
  ) {
    return false;
  }

  const tiles = value.tiles;
  const expectedTileCount = value.type === "pon" ? 3 : 4;
  if (tiles.length !== expectedTileCount) return false;

  const firstTile = tiles[0];
  if (!firstTile) return false;
  return (
    (value.type === "kan" || value.concealed === false) &&
    tiles.every(
      (tile) => tile.suit === firstTile.suit && tile.rank === firstTile.rank,
    )
  );
}

function isBenchPlayer(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPlayerId(value.playerId) &&
    isPlayerName(value.name) &&
    isBoundedInteger(value.points, -MAX_SNAPSHOT_POINTS, MAX_SNAPSHOT_POINTS) &&
    isOptionalPointDelta(value.pointsDelta) &&
    !Object.hasOwn(value, "hand") &&
    !Object.hasOwn(value, "handCount")
  );
}

function isSeatedPlayer(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPlayerId(value.playerId) &&
    isPlayerName(value.name) &&
    isBoundedInteger(value.points, -MAX_SNAPSHOT_POINTS, MAX_SNAPSHOT_POINTS) &&
    isOptionalPointDelta(value.pointsDelta) &&
    (value.seatWind === "east" ||
      value.seatWind === "south" ||
      value.seatWind === "west") &&
    (value.status === undefined || isPlayerStatus(value.status)) &&
    (value.hand === undefined ||
      isTileArray(value.hand, MAX_VISIBLE_HAND_TILES)) &&
    (value.handCount === undefined ||
      isBoundedNonNegativeInteger(value.handCount, MAX_VISIBLE_HAND_TILES)) &&
    (value.melds === undefined ||
      (Array.isArray(value.melds) &&
        value.melds.length <= MAX_MELD_COUNT &&
        value.melds.every(isMeld))) &&
    isBoundedNonNegativeInteger(value.kitaCount, MAX_KITA_COUNT) &&
    isTileArray(value.discards)
  );
}

function isSlot(value: unknown): boolean {
  return (
    isRecord(value) &&
    ((value.kind === "bench" && isBenchPlayer(value.player)) ||
      (value.kind === "seated" && isSeatedPlayer(value.player)))
  );
}

function isResultPlayer(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPlayerName(value.name) &&
    isBoundedInteger(value.rank, 1, 4) &&
    isBoundedInteger(
      value.rawScore,
      -MAX_SNAPSHOT_RESULT_VALUE,
      MAX_SNAPSHOT_RESULT_VALUE,
    ) &&
    isBoundedInteger(
      value.uma,
      -MAX_SNAPSHOT_RESULT_VALUE,
      MAX_SNAPSHOT_RESULT_VALUE,
    ) &&
    isBoundedInteger(
      value.bonus,
      -MAX_SNAPSHOT_RESULT_VALUE,
      MAX_SNAPSHOT_RESULT_VALUE,
    ) &&
    isBoundedInteger(
      value.soshiiTotal,
      -MAX_SNAPSHOT_RESULT_VALUE,
      MAX_SNAPSHOT_RESULT_VALUE,
    )
  );
}

function isGameResult(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !Array.isArray(value.players) ||
    value.players.length !== 4 ||
    !value.players.every(isResultPlayer)
  ) {
    return false;
  }
  const ranks = new Set(
    value.players.map((player) => (isRecord(player) ? player.rank : undefined)),
  );
  if (
    ranks.size !== RESULT_RANKS.length ||
    !RESULT_RANKS.every((rank) => ranks.has(rank))
  ) {
    return false;
  }
  const ownsPlayerIds = value.players.map(
    (player) => isRecord(player) && Object.hasOwn(player, "playerId"),
  );
  if (ownsPlayerIds.every((owns) => !owns)) return true;
  if (!ownsPlayerIds.every(Boolean)) return false;
  const playerIds = value.players.map((player) =>
    isRecord(player) && isPlayerId(player.playerId) ? player.playerId : null,
  );
  return (
    playerIds.every((playerId) => playerId !== null) &&
    new Set(playerIds).size === CHARACTER_PLAYER_IDS.length &&
    CHARACTER_PLAYER_IDS.every((playerId) => playerIds.includes(playerId))
  );
}

function isGameView(value: unknown, you: OnlineSnapshot["you"]): boolean {
  if (!isRecord(value) || !isRecord(value.slots)) return false;
  const slots = value.slots;
  if (!SLOT_POSITIONS.every((position) => isSlot(slots[position]))) {
    return false;
  }
  const slotValues = SLOT_POSITIONS.map(
    (position) => slots[position] as Record<string, unknown>,
  );
  const playerIds = slotValues.map(
    (slot) => (slot.player as Record<string, unknown>).playerId,
  );
  if (
    slotValues.filter((slot) => slot.kind === "seated").length !== 3 ||
    new Set(playerIds).size !== playerIds.length ||
    !CHARACTER_PLAYER_IDS.every((playerId) => playerIds.includes(playerId))
  ) {
    return false;
  }
  const selfSlot = slots.self as Record<string, unknown>;
  const selfPlayer = selfSlot.player as Record<string, unknown>;
  if (selfPlayer.playerId !== you) return false;
  for (const position of SLOT_POSITIONS) {
    const slot = slots[position] as Record<string, unknown>;
    const player = slot.player as Record<string, unknown>;
    if (slot.kind !== "seated") continue;
    if (position === "self") {
      if (
        !isTileArray(player.hand, MAX_VISIBLE_HAND_TILES) ||
        Object.hasOwn(player, "handCount")
      ) {
        return false;
      }
    } else if (
      Object.hasOwn(player, "hand") ||
      !isBoundedNonNegativeInteger(player.handCount, MAX_VISIBLE_HAND_TILES)
    ) {
      return false;
    }
  }
  if (!isRecord(value.tableInfo) || !isRecord(value.dora)) return false;
  const table = value.tableInfo;
  const dora = value.dora;
  return (
    (table.roundWind === "east" || table.roundWind === "south") &&
    isBoundedInteger(table.handNumber, 1, MAX_SNAPSHOT_HAND_NUMBER) &&
    isBoundedNonNegativeInteger(table.honba, MAX_SNAPSHOT_HONBA) &&
    isBoundedNonNegativeInteger(
      table.riichiSticks,
      MAX_SNAPSHOT_RIICHI_STICKS,
    ) &&
    isBoundedNonNegativeInteger(table.remainingLiveTiles, TOTAL_TILE_COUNT) &&
    Array.isArray(table.dice) &&
    table.dice.length === 2 &&
    table.dice.every((die) => isBoundedInteger(die, 1, 6)) &&
    isBoundedNonNegativeInteger(table.doraCount, MAX_DORA_INDICATOR_COUNT) &&
    isTileArray(dora.indicators, MAX_DORA_INDICATOR_COUNT) &&
    (dora.uraIndicatorCount === undefined ||
      isBoundedNonNegativeInteger(
        dora.uraIndicatorCount,
        MAX_DORA_INDICATOR_COUNT,
      )) &&
    (dora.uraIndicators === undefined ||
      isTileArray(dora.uraIndicators, MAX_DORA_INDICATOR_COUNT)) &&
    (value.result === null || isGameResult(value.result))
  );
}

/**
 * The roster and the view are two projections of the same current seat. Keep
 * their names aligned so an untrusted snapshot cannot make one player appear
 * under two identities in the lobby header and the table.
 *
 * Result names are intentionally excluded: they describe the historical
 * result and may legitimately differ after a seat is explicitly reused.
 */
function hasConsistentRosterNames(
  view: OnlineSnapshot["view"],
  players: readonly Pick<OnlineSnapshot["players"][number], "id" | "name">[],
): boolean {
  const slotNames = new Map<string, string>();
  for (const position of SLOT_POSITIONS) {
    const player = view.slots[position].player;
    slotNames.set(player.playerId, player.name);
  }
  return players.every((player) => slotNames.get(player.id) === player.name);
}

function isSeatedPlayerId(
  view: OnlineSnapshot["view"],
  playerId: unknown,
): boolean {
  return (
    isPlayerId(playerId) &&
    SLOT_POSITIONS.some((position) => {
      const slot = view.slots[position];
      return slot.kind === "seated" && slot.player.playerId === playerId;
    })
  );
}

function isPending(value: unknown, you: OnlineSnapshot["you"]): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if ((value.playerId ?? "p0") !== you) return false;
  if (value.kind === "humanDiscard") {
    return (
      (value.playerId === undefined || isPlayerId(value.playerId)) &&
      typeof value.canTsumo === "boolean" &&
      typeof value.canRiichi === "boolean" &&
      isTileArray(value.riichiTiles, MAX_VISIBLE_HAND_TILES) &&
      isTileArray(value.ankanTiles, MAX_VISIBLE_HAND_TILES) &&
      isTileArray(value.kakanTiles, MAX_VISIBLE_HAND_TILES) &&
      isOptionalBoolean(value.canKita) &&
      isTileArray(value.forbiddenDiscards, MAX_VISIBLE_HAND_TILES) &&
      typeof value.locked === "boolean"
    );
  }
  if (value.kind === "humanReact") {
    return (
      (value.playerId === undefined || isPlayerId(value.playerId)) &&
      isTile(value.tile) &&
      (value.from === "east" ||
        value.from === "south" ||
        value.from === "west") &&
      typeof value.canRon === "boolean" &&
      typeof value.canPon === "boolean" &&
      typeof value.canKan === "boolean" &&
      (value.chankan === undefined ||
        value.chankan === "kakan" ||
        value.chankan === "ankan")
    );
  }
  return false;
}

function isDeltas(value: unknown): boolean {
  return (
    isRecord(value) &&
    CHARACTER_PLAYER_IDS.every((playerId) =>
      isBoundedInteger(
        value[playerId],
        -MAX_SNAPSHOT_POINT_DELTA,
        MAX_SNAPSHOT_POINT_DELTA,
      ),
    )
  );
}

function isWinDetails(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.dora)) return false;
  const dora = value.dora;
  return (
    (value.winType === "tsumo" || value.winType === "ron") &&
    typeof value.dealer === "boolean" &&
    isPlayerName(value.winnerName) &&
    (value.winnerSeat === "east" ||
      value.winnerSeat === "south" ||
      value.winnerSeat === "west") &&
    isTileArray(value.hand, MAX_VISIBLE_HAND_TILES) &&
    isTile(value.winningTile) &&
    Array.isArray(value.yaku) &&
    value.yaku.length <= MAX_WIN_YAKU_ENTRIES &&
    value.yaku.every(
      (yaku) =>
        isRecord(yaku) &&
        isBoundedString(yaku.name, 128) &&
        isBoundedNonNegativeInteger(yaku.han, MAX_SNAPSHOT_HAN) &&
        isBoundedNonNegativeInteger(yaku.yakuman, MAX_SNAPSHOT_YAKUMAN),
    ) &&
    isBoundedNonNegativeInteger(value.yakuHan, MAX_SNAPSHOT_HAN) &&
    ["omote", "ura", "aka", "gari", "total"].every((key) =>
      isBoundedNonNegativeInteger(dora[key], MAX_SNAPSHOT_HAN),
    ) &&
    isBoundedNonNegativeInteger(value.totalHan, MAX_SNAPSHOT_HAN) &&
    isBoundedNonNegativeInteger(value.yakuman, MAX_SNAPSHOT_YAKUMAN) &&
    isScoreCategory(value.category) &&
    isBoundedNonNegativeInteger(value.honba, MAX_SNAPSHOT_HONBA) &&
    isBoundedNonNegativeInteger(
      value.riichiSticks,
      MAX_SNAPSHOT_RIICHI_STICKS,
    ) &&
    Array.isArray(value.payments) &&
    value.payments.length <= MAX_WIN_PAYMENT_ENTRIES &&
    value.payments.every(
      (payment) =>
        isRecord(payment) &&
        isBoundedString(payment.name, 384) &&
        isBoundedNonNegativeInteger(payment.amount, MAX_SNAPSHOT_POINT_DELTA),
    ) &&
    isBoundedNonNegativeInteger(value.stickPayout, MAX_SNAPSHOT_POINT_DELTA)
  );
}

function isRoundSummary(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    (value.kind === "win" || value.kind === "draw") &&
    isBoundedString(value.label) &&
    isDeltas(value.deltas) &&
    (value.winnerId === undefined || isPlayerId(value.winnerId)) &&
    isOptionalBoolean(value.riichiWin) &&
    (value.residualSticks === undefined ||
      (isRecord(value.residualSticks) &&
        isPlayerId(value.residualSticks.recipientId) &&
        isPlayerName(value.residualSticks.recipientName) &&
        isBoundedNonNegativeInteger(
          value.residualSticks.sticks,
          MAX_SNAPSHOT_RIICHI_STICKS,
        ) &&
        isBoundedNonNegativeInteger(
          value.residualSticks.points,
          MAX_SNAPSHOT_POINT_DELTA,
        ))) &&
    (value.winDetails === undefined || isWinDetails(value.winDetails))
  );
}

function isOnlinePlayer(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPlayerId(value.id) &&
    isPlayerName(value.name) &&
    typeof value.connected === "boolean" &&
    typeof value.isHost === "boolean"
  );
}

function isHostNotice(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      (value.reason === "disconnected" || value.reason === "left") &&
      isBoundedString(value.message) &&
      isBoundedString(value.nextAction))
  );
}

function isDepartureNotice(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isRecord(value) &&
      isPlayerId(value.playerId) &&
      isPlayerName(value.playerName) &&
      isBoundedString(value.message) &&
      isBoundedString(value.nextAction))
  );
}

function isOnlineSnapshot(value: OnlineSnapshot): boolean {
  const players = value.players;
  if (
    !Array.isArray(players) ||
    players.length < 1 ||
    players.length > 4 ||
    !players.every(isOnlinePlayer)
  ) {
    return false;
  }
  const playerIds = players.map((player) => player.id);
  if (
    new Set(playerIds).size !== playerIds.length ||
    !playerIds.includes(value.you)
  ) {
    return false;
  }
  const hosts = players.filter((player) => player.isHost);
  const hostMatches =
    value.hostId === null
      ? hosts.length === 0
      : isPlayerId(value.hostId) &&
        hosts.length === 1 &&
        hosts[0]?.id === value.hostId;
  return (
    /^[A-HJ-NP-Z2-9]{6}$/u.test(value.code) &&
    isSafeInteger(value.version) &&
    value.version >= 0 &&
    isPlayerId(value.you) &&
    isOptionalBoolean(value.explicitKita) &&
    hostMatches &&
    (value.phase === "playing" ||
      value.phase === "roundEnd" ||
      value.phase === "gameEnd") &&
    isGameView(value.view, value.you) &&
    hasConsistentRosterNames(value.view, players) &&
    isPending(value.pending, value.you) &&
    isRoundSummary(value.roundSummary) &&
    (value.currentTurn === null ||
      isSeatedPlayerId(value.view, value.currentTurn)) &&
    isHostNotice(value.hostNotice) &&
    isDepartureNotice(value.departureNotice)
  );
}

function isOnlineErrorCode(value: unknown): value is OnlineErrorCode {
  return (
    value === "connection_limit" ||
    value === "maintenance" ||
    value === "message_too_large" ||
    value === "rate_limited"
  );
}

function isOnlineRateLimitScope(value: unknown): value is OnlineRateLimitScope {
  return (
    value === "connection" ||
    value === "create" ||
    value === "join" ||
    value === "resume" ||
    value === "action" ||
    value === "message"
  );
}

function legacyRetryAfterMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.min(MAX_MAINTENANCE_RETRY_AFTER_MS, Math.ceil(value));
}

function maintenanceRetryAfterMs(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_MAINTENANCE_RETRY_AFTER_MS
    ? value
    : null;
}

function isMaintenancePhase(value: unknown): value is OnlineMaintenancePhase {
  return value === "draining" || value === "drained" || value === "terminating";
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 35) return false;
  const match = ISO_TIMESTAMP.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth =
    month === 2
      ? leapYear
        ? 29
        : 28
      : [4, 6, 9, 11].includes(month)
        ? 30
        : 31;
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function parseMaintenance(
  message: Record<string, unknown>,
): OnlineMaintenanceNotice | OnlineMaintenanceAcceptingNotice | null {
  if (message.phase === "accepting") {
    return message.retryAfterMs === undefined && message.deadline === undefined
      ? { type: "maintenance", phase: "accepting" }
      : null;
  }
  if (!isMaintenancePhase(message.phase)) return null;
  const retryAfterMs = maintenanceRetryAfterMs(message.retryAfterMs);
  if (retryAfterMs === null) return null;
  if (message.deadline !== undefined && !isIsoTimestamp(message.deadline)) {
    return null;
  }
  return {
    type: "maintenance",
    phase: message.phase,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(message.deadline === undefined
      ? {}
      : { deadline: message.deadline as string }),
  };
}

/** Parse an untrusted WebSocket payload while ignoring unknown additive types. */
export function parseOnlineServerMessage(
  value: unknown,
): OnlineServerMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "maintenance") return parseMaintenance(value);
  if (value.type === "pong") return { type: "pong" };
  if (value.type === "session") {
    const snapshot = normalizeSnapshot(value.snapshot);
    return typeof value.token === "string" &&
      value.token.length >= 16 &&
      value.token.length <= 512 &&
      snapshot
      ? { type: "session", token: value.token, snapshot }
      : null;
  }
  if (value.type === "snapshot") {
    const snapshot = normalizeSnapshot(value.snapshot);
    return snapshot ? { type: "snapshot", snapshot } : null;
  }
  if (value.type !== "error" || !isBoundedString(value.message)) {
    return null;
  }

  const code = isOnlineErrorCode(value.code) ? value.code : undefined;
  const scope = isOnlineRateLimitScope(value.scope) ? value.scope : undefined;
  const retryAfterMs =
    code === "maintenance"
      ? maintenanceRetryAfterMs(value.retryAfterMs)
      : legacyRetryAfterMs(value.retryAfterMs);
  if (retryAfterMs === null) return null;
  return {
    type: "error",
    message: value.message,
    ...(code === undefined ? {} : { code }),
    ...(scope === undefined ? {} : { scope }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}
