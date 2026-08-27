import { CHARACTER_PLAYER_IDS } from "@/domain/game/characters";
import type {
  OnlineErrorCode,
  OnlineMaintenanceNotice,
  OnlineMaintenancePhase,
  OnlineRateLimitScope,
  OnlineServerMessage,
  OnlineSnapshot,
} from "./types";

export const MAX_MAINTENANCE_RETRY_AFTER_MS = 10 * 60 * 1_000;

const SLOT_POSITIONS = ["self", "right", "across", "left"] as const;
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

function isBoundedString(value: unknown, maximum = 2_048): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function isTile(value: unknown): boolean {
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

function isTileArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isTile);
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
  return (
    isRecord(value) &&
    (value.type === "pon" || value.type === "kan") &&
    isTileArray(value.tiles) &&
    typeof value.concealed === "boolean"
  );
}

function isBenchPlayer(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPlayerId(value.playerId) &&
    isBoundedString(value.name, 384) &&
    isFiniteNumber(value.points) &&
    isOptionalNumber(value.pointsDelta) &&
    !Object.hasOwn(value, "hand") &&
    !Object.hasOwn(value, "handCount")
  );
}

function isSeatedPlayer(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPlayerId(value.playerId) &&
    isBoundedString(value.name, 384) &&
    isFiniteNumber(value.points) &&
    isOptionalNumber(value.pointsDelta) &&
    (value.seatWind === "east" ||
      value.seatWind === "south" ||
      value.seatWind === "west") &&
    (value.status === undefined || isPlayerStatus(value.status)) &&
    (value.hand === undefined || isTileArray(value.hand)) &&
    (value.handCount === undefined ||
      (isInteger(value.handCount) && value.handCount >= 0)) &&
    (value.melds === undefined ||
      (Array.isArray(value.melds) && value.melds.every(isMeld))) &&
    isInteger(value.kitaCount) &&
    value.kitaCount >= 0 &&
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
    isBoundedString(value.name, 384) &&
    isInteger(value.rank) &&
    value.rank >= 1 &&
    value.rank <= 4 &&
    isFiniteNumber(value.rawScore) &&
    isFiniteNumber(value.uma) &&
    isFiniteNumber(value.bonus) &&
    isFiniteNumber(value.soshiiTotal)
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
  const selfSlot = slots.self as Record<string, unknown>;
  const selfPlayer = selfSlot.player as Record<string, unknown>;
  if (selfPlayer.playerId !== you) return false;
  for (const position of SLOT_POSITIONS) {
    const slot = slots[position] as Record<string, unknown>;
    const player = slot.player as Record<string, unknown>;
    if (slot.kind !== "seated") continue;
    if (position === "self") {
      if (!isTileArray(player.hand) || Object.hasOwn(player, "handCount")) {
        return false;
      }
    } else if (
      Object.hasOwn(player, "hand") ||
      !isInteger(player.handCount) ||
      player.handCount < 0
    ) {
      return false;
    }
  }
  if (!isRecord(value.tableInfo) || !isRecord(value.dora)) return false;
  const table = value.tableInfo;
  const dora = value.dora;
  return (
    (table.roundWind === "east" || table.roundWind === "south") &&
    isInteger(table.handNumber) &&
    table.handNumber >= 1 &&
    isInteger(table.honba) &&
    table.honba >= 0 &&
    isInteger(table.riichiSticks) &&
    table.riichiSticks >= 0 &&
    isInteger(table.remainingLiveTiles) &&
    table.remainingLiveTiles >= 0 &&
    Array.isArray(table.dice) &&
    table.dice.length === 2 &&
    table.dice.every((die) => isInteger(die) && die >= 1 && die <= 6) &&
    isInteger(table.doraCount) &&
    table.doraCount >= 0 &&
    isTileArray(dora.indicators) &&
    (dora.uraIndicatorCount === undefined ||
      (isInteger(dora.uraIndicatorCount) && dora.uraIndicatorCount >= 0)) &&
    (dora.uraIndicators === undefined || isTileArray(dora.uraIndicators)) &&
    (value.result === null || isGameResult(value.result))
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
      isTileArray(value.riichiTiles) &&
      isTileArray(value.ankanTiles) &&
      isTileArray(value.kakanTiles) &&
      isOptionalBoolean(value.canKita) &&
      isTileArray(value.forbiddenDiscards) &&
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
    CHARACTER_PLAYER_IDS.every((playerId) => isFiniteNumber(value[playerId]))
  );
}

function isWinDetails(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.dora)) return false;
  const dora = value.dora;
  return (
    (value.winType === "tsumo" || value.winType === "ron") &&
    typeof value.dealer === "boolean" &&
    isBoundedString(value.winnerName, 384) &&
    (value.winnerSeat === "east" ||
      value.winnerSeat === "south" ||
      value.winnerSeat === "west") &&
    isTileArray(value.hand) &&
    isTile(value.winningTile) &&
    Array.isArray(value.yaku) &&
    value.yaku.every(
      (yaku) =>
        isRecord(yaku) &&
        isBoundedString(yaku.name, 128) &&
        isFiniteNumber(yaku.han) &&
        isFiniteNumber(yaku.yakuman),
    ) &&
    isFiniteNumber(value.yakuHan) &&
    ["omote", "ura", "aka", "gari", "total"].every((key) =>
      isFiniteNumber(dora[key]),
    ) &&
    isFiniteNumber(value.totalHan) &&
    isFiniteNumber(value.yakuman) &&
    isBoundedString(value.category, 128) &&
    isFiniteNumber(value.honba) &&
    isFiniteNumber(value.riichiSticks) &&
    Array.isArray(value.payments) &&
    value.payments.every(
      (payment) =>
        isRecord(payment) &&
        isBoundedString(payment.name, 384) &&
        isFiniteNumber(payment.amount),
    ) &&
    isFiniteNumber(value.stickPayout)
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
        isBoundedString(value.residualSticks.recipientName, 384) &&
        isInteger(value.residualSticks.sticks) &&
        value.residualSticks.sticks >= 0 &&
        isFiniteNumber(value.residualSticks.points))) &&
    (value.winDetails === undefined || isWinDetails(value.winDetails))
  );
}

function isOnlinePlayer(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPlayerId(value.id) &&
    isBoundedString(value.name, 384) &&
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
      isBoundedString(value.playerName, 384) &&
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
    isInteger(value.version) &&
    value.version >= 0 &&
    isPlayerId(value.you) &&
    isOptionalBoolean(value.explicitKita) &&
    hostMatches &&
    (value.phase === "playing" ||
      value.phase === "roundEnd" ||
      value.phase === "gameEnd") &&
    isGameView(value.view, value.you) &&
    isPending(value.pending, value.you) &&
    isRoundSummary(value.roundSummary) &&
    (value.currentTurn === null || isPlayerId(value.currentTurn)) &&
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
): OnlineMaintenanceNotice | null {
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
  if (value.type !== "error" || typeof value.message !== "string") {
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
