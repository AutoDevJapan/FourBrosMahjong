import { randomBytes } from "node:crypto";
import {
  createGame,
  DEFAULT_NAMES,
  type EngineState,
  type Pending,
  type PlayerId,
  type PlayerNames,
  removeHumanPlayerIds,
  setExplicitKitaPlayerIds,
  setHumanPlayerIds,
} from "../src/domain/game/engine";
import {
  applyGameAction,
  type GameAction,
} from "../src/domain/game/gamePersistence";
import { selectView } from "../src/domain/game/gameView";
import type { GameViewState } from "../src/domain/game/viewTypes";
import { isValidTileKind } from "../src/domain/hand/tile-identity";
import {
  ONLINE_RESUME_TOKEN_MAX_LENGTH,
  ONLINE_RESUME_TOKEN_MIN_LENGTH,
  type OnlineDepartureNotice,
  type OnlineHostNotice,
  type OnlineHostTransitionReason,
} from "../src/domain/online/types";
import { createTile, type Suit } from "../src/domain/tiles/tile";
import { isValidPlayerName, sanitizePlayerName } from "../src/lib/playerName";
import {
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "../src/lib/roomCode";
import { ONLINE_DRAIN_RECONNECT_GRACE_MS } from "./maintenanceLimits";

export { normalizeRoomCode } from "../src/lib/roomCode";

const ROOM_TTL_MS = 60 * 60 * 1000;
const MAX_ROOMS = 1_000;

export { ONLINE_DRAIN_RECONNECT_GRACE_MS } from "./maintenanceLimits";

const PLAYER_IDS: readonly PlayerId[] = ["p0", "p1", "p2", "p3"];

interface RoomPlayerSnapshot {
  readonly id: PlayerId;
  readonly name: string;
  readonly connected: boolean;
  readonly isHost: boolean;
}

export interface RoomSnapshot {
  readonly code: string;
  readonly version: number;
  readonly you: PlayerId;
  readonly explicitKita: boolean;
  readonly hostId: PlayerId | null;
  readonly phase: EngineState["phase"];
  readonly view: GameViewState;
  /** 相手の手牌を含む非公開入力は担当者にだけ返す。 */
  readonly pending: Pending;
  readonly roundSummary: EngineState["lastRound"];
  readonly players: readonly RoomPlayerSnapshot[];
  readonly currentTurn: PlayerId | null;
  readonly hostNotice: OnlineHostNotice | null;
  readonly departureNotice: OnlineDepartureNotice | null;
}

interface RoomPlayer {
  readonly id: PlayerId;
  readonly token: string;
  name: string;
  connected: boolean;
  resumable: boolean;
  explicitKita: boolean;
  lastSeenAt: number;
}

interface HostTransition {
  readonly reason: OnlineHostTransitionReason;
  readonly message: string;
}

interface Room {
  readonly code: string;
  state: EngineState;
  version: number;
  readonly players: Map<PlayerId, RoomPlayer>;
  /** 明示退出したseat。次のjoinで同じIDを安全に置換する。 */
  readonly reusableSeatIds: Set<PlayerId>;
  /** 現在のhost席。host切断後は接続中のguestへ即時に移る。 */
  hostId: PlayerId | null;
  /** 現局で人間席だったか。切断時にAIへ解放してもresumeで復元する。 */
  readonly humanPlayerIds: Set<PlayerId>;
  /** Drain中に最後の接続として入力を凍結したseat。外部snapshotには出さない。 */
  readonly drainFrozenPlayerIds: Set<PlayerId>;
  hostTransition: HostTransition | null;
  departureNotice: OnlineDepartureNotice | null;
  lastActivityAt: number;
}

export type RoomMutation =
  | { readonly ok: true; readonly stateChanged: true; readonly room: Room }
  | { readonly ok: false; readonly error: string; readonly room: Room };

export interface RoomSession {
  readonly room: Room;
  readonly player: RoomPlayer;
}

export type MonotonicClock = () => number;

export interface RoomManagerOptions {
  /** Durations only; callers must not use this value as a wall-clock timestamp. */
  readonly monotonicNow?: MonotonicClock;
}

export interface ConnectionAggregateCounts {
  /** Established WebSockets, including sockets without an attached session. */
  readonly webSocketConnections: number;
  /** Attached sockets; replacement races may count the same seat twice. */
  readonly attachedSessionConnections: number;
  /** HTTP upgrades reserved before they become established WebSockets. */
  readonly pendingUpgrades: number;
}

/**
 * Privacy-safe process aggregate. It deliberately contains no room identity,
 * player name, resume token, network address, tile, or action data.
 */
export interface RoomManagerAggregateSnapshot
  extends ConnectionAggregateCounts {
  readonly retainedRooms: number;
  readonly connectedRooms: number;
  readonly blockingDrainRooms: number;
  readonly reconnectGraceRooms: number;
  readonly completedConnectedRooms: number;
  readonly abandonedDuringDrainRooms: number;
  readonly uniqueConnectedSeats: number;
}

export interface DrainAggregateObserver {
  snapshot(
    connections?: ConnectionAggregateCounts,
  ): RoomManagerAggregateSnapshot;
}

interface DrainAggregateTracker {
  readonly graceCandidates: Set<Room>;
  readonly alreadyAbandoned: WeakSet<Room>;
  abandonedDuringDrainRooms: number;
}

const EMPTY_CONNECTION_COUNTS: ConnectionAggregateCounts = Object.freeze({
  webSocketConnections: 0,
  attachedSessionConnections: 0,
  pendingUpgrades: 0,
});

function isCurrentPlayer(room: Room, player: RoomPlayer): boolean {
  return room.players.get(player.id) === player && player.connected;
}

function validateReconnectGraceMs(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < ONLINE_DRAIN_RECONNECT_GRACE_MS.min ||
    value > ONLINE_DRAIN_RECONNECT_GRACE_MS.max
  ) {
    throw new RangeError(
      `reconnect grace must be an integer from ${ONLINE_DRAIN_RECONNECT_GRACE_MS.min} to ${ONLINE_DRAIN_RECONNECT_GRACE_MS.max} milliseconds`,
    );
  }
}

function validatedConnectionCounts(
  value: ConnectionAggregateCounts,
): ConnectionAggregateCounts {
  for (const count of [
    value.webSocketConnections,
    value.attachedSessionConnections,
    value.pendingUpgrades,
  ]) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError(
        "connection aggregate counts must be non-negative integers",
      );
    }
  }
  return value;
}

function isDrainBlockingPhase(phase: EngineState["phase"]): boolean {
  return phase === "playing" || phase === "roundEnd";
}

function reconnectGraceExpiresAt(room: Room, graceMs: number): number | null {
  let latestSeenAt = Number.NEGATIVE_INFINITY;
  let hasResumableSeat = false;
  for (const player of room.players.values()) {
    if (!player.resumable) continue;
    hasResumableSeat = true;
    latestSeenAt = Math.max(latestSeenAt, player.lastSeenAt);
  }
  return hasResumableSeat ? latestSeenAt + graceMs : null;
}

function randomToken(): string {
  return randomBytes(24).toString("base64url");
}

function randomRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  return Array.from(
    bytes,
    (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length],
  ).join("");
}

function randomSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}

export function normalizePlayerName(
  value: unknown,
  fallback = "ゲスト",
): string {
  if (typeof value !== "string") return fallback;
  const sanitized = sanitizePlayerName(value);
  // `sanitizePlayerName` can return an empty string when a visible character
  // appears just beyond its bounded code-unit prefix. Never let that malformed
  // result cross the online snapshot boundary: clients correctly reject an
  // empty player name and would then lose room synchronization.
  return sanitized === null || !isValidPlayerName(sanitized)
    ? fallback
    : sanitized;
}

function namesOf(room: Room): PlayerNames {
  const names = [...DEFAULT_NAMES] as [string, string, string, string];
  for (const player of room.players.values())
    names[Number(player.id.slice(1))] = player.name;
  return names;
}

function playerIdForPending(state: EngineState): PlayerId | null {
  if (state.pending === null) return null;
  return state.pending.playerId ?? "p0";
}

function playerNameChanged(
  state: EngineState,
  playerId: PlayerId,
  name: string,
): EngineState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId ? { ...player, name } : player,
    ),
  };
}

/** 現半荘の人間入力 roster に新規 seat だけを追加する。 */
function addHumanPlayer(room: Room, player: RoomPlayer): void {
  const playerId = player.id;
  room.humanPlayerIds.add(playerId);
  // A reused seat may still be present in the engine capability roster from
  // its previous occupant. Assign the replacement's capability explicitly so
  // a non-capable player cannot inherit the old occupant's North controls.
  const currentExplicitKitaPlayerIds =
    room.state.explicitKitaPlayerIds ??
    room.state.humanPlayerIds ??
    (["p0"] as const);
  room.state = setExplicitKitaPlayerIds(room.state, [
    ...currentExplicitKitaPlayerIds.filter((id) => id !== playerId),
    ...(player.explicitKita ? [playerId] : []),
  ]);
  room.state = setHumanPlayerIds(room.state, [
    ...(room.state.humanPlayerIds ?? ["p0"]),
    playerId,
  ]);
}

function nextHostAction(phase: EngineState["phase"]): string {
  switch (phase) {
    case "playing":
      return "現在の手番に従って操作してください。";
    case "roundEnd":
      return "「次の局へ」を押して対局を続けてください。";
    case "gameEnd":
      return "「新しい半荘を開始」を押して次の半荘へ進めてください。";
  }
}

function hostNoticeFor(room: Room): OnlineHostNotice | null {
  const transition = room.hostTransition;
  if (transition === null) return null;
  return {
    reason: transition.reason,
    message: transition.message,
    nextAction:
      room.hostId === null
        ? "ホストが再接続するか、参加者が接続すると次のホストが決まります。"
        : nextHostAction(room.state.phase),
  };
}

function departureNextAction(room: Room): string {
  switch (room.state.phase) {
    case "playing":
      return "表示された現在の手番に従って操作してください。";
    case "roundEnd":
      return "ホストは「次の局へ」を押して対局を続けてください。";
    case "gameEnd":
      return "ホストは「新しい半荘を開始」を押して次の半荘へ進めてください。";
  }
}

function rememberDeparture(room: Room, player: RoomPlayer): void {
  room.departureNotice = {
    playerId: player.id,
    playerName: player.name,
    message: `「${player.name}」さんが退出したため、その席をAIに戻しました。`,
    nextAction: departureNextAction(room),
  };
}

function firstConnectedPlayer(
  room: Room,
  excluding: PlayerId | null = null,
): RoomPlayer | null {
  for (const id of PLAYER_IDS) {
    if (id === excluding) continue;
    const player = room.players.get(id);
    if (player?.connected) return player;
  }
  return null;
}

function rememberHostTransition(
  room: Room,
  reason: OnlineHostTransitionReason,
  departing: RoomPlayer,
  replacement: RoomPlayer | null,
): void {
  const verb = reason === "left" ? "退出" : "切断";
  room.hostTransition = {
    reason,
    message: replacement
      ? `「${departing.name}」さん（ホスト）が${verb}したため、${replacement.name}さんへホスト権限を引き継ぎました。`
      : `「${departing.name}」さん（ホスト）が${verb}しました。接続中の参加者がいないため、再接続または参加者の接続を待っています。`,
  };
}

function transferHost(
  room: Room,
  departing: RoomPlayer,
  reason: OnlineHostTransitionReason,
): RoomPlayer | null {
  const replacement = firstConnectedPlayer(room, departing.id);
  room.hostId = replacement?.id ?? null;
  rememberHostTransition(room, reason, departing, replacement);
  return replacement;
}

function isValidTile(value: unknown): value is {
  readonly suit: "man" | "pin" | "sou" | "honor";
  readonly rank: number;
  readonly isRed: boolean;
} {
  if (value === null || typeof value !== "object") return false;
  const tile = value as Record<string, unknown>;
  if (!(["man", "pin", "sou", "honor"] as const).includes(tile.suit as never)) {
    return false;
  }
  const suit = tile.suit as Suit;
  const rank = tile.rank;
  if (!Number.isInteger(rank)) return false;
  const numericRank = rank as number;
  if (!isValidTileKind({ suit, rank: numericRank })) return false;
  return (
    typeof tile.isRed === "boolean" &&
    tile.isRed === createTile(suit, numericRank).isRed
  );
}

function canonicalTile(value: unknown) {
  const tile = value as {
    readonly suit: "man" | "pin" | "sou" | "honor";
    readonly rank: number;
    readonly isRed: boolean;
  };
  return { ...tile };
}

export function parseGameAction(value: unknown): GameAction | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const type = raw.type;
  const noTileTypes = new Set([
    "tsumogiri",
    "tsumo",
    "ron",
    "pon",
    "kan",
    "kita",
    "passRon",
    "nextRound",
  ]);
  if (typeof type !== "string") return null;
  if (noTileTypes.has(type)) return { type } as GameAction;
  if (!["discard", "riichi", "ankan", "kakan"].includes(type)) return null;
  if (!isValidTile(raw.tile)) return null;
  return { type, tile: canonicalTile(raw.tile) } as GameAction;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly monotonicNow: MonotonicClock;
  private lastMonotonicNow = Number.NEGATIVE_INFINITY;

  constructor(options: RoomManagerOptions = {}) {
    this.monotonicNow = options.monotonicNow ?? Date.now;
  }

  private now(): number {
    const sampled = this.monotonicNow();
    if (!Number.isFinite(sampled) || sampled < 0) {
      throw new RangeError(
        "monotonic clock must return a finite non-negative value",
      );
    }
    this.lastMonotonicNow = Math.max(this.lastMonotonicNow, sampled);
    return this.lastMonotonicNow;
  }

  create(nameValue: unknown, explicitKita = false): RoomSession {
    if (this.rooms.size >= MAX_ROOMS) {
      throw new Error(
        "現在ルームが混み合っています。少し待ってから再試行してください。",
      );
    }
    let code = randomRoomCode();
    while (this.rooms.has(code)) code = randomRoomCode();
    const name = normalizePlayerName(nameValue, "ホスト");
    const observedAt = this.now();
    const player: RoomPlayer = {
      id: "p0",
      token: randomToken(),
      name,
      connected: true,
      resumable: true,
      explicitKita,
      lastSeenAt: observedAt,
    };
    const room: Room = {
      code,
      state: createGame({
        seed: randomSeed(),
        names: [name, "ゲスト2", "ゲスト3", "ゲスト4"],
        humanPlayerIds: ["p0"],
        explicitKitaPlayerIds: explicitKita ? ["p0"] : [],
      }),
      version: 0,
      players: new Map([[player.id, player]]),
      reusableSeatIds: new Set(),
      hostId: "p0",
      humanPlayerIds: new Set(["p0"]),
      drainFrozenPlayerIds: new Set(),
      hostTransition: null,
      departureNotice: null,
      lastActivityAt: observedAt,
    };
    this.rooms.set(code, room);
    return { room, player };
  }

  join(
    codeValue: unknown,
    nameValue: unknown,
    explicitKita = false,
  ): RoomSession | null {
    const code = normalizeRoomCode(codeValue);
    if (code === null) return null;
    const room = this.rooms.get(code);
    if (!room) return null;
    const id =
      PLAYER_IDS.find((candidate) => room.reusableSeatIds.has(candidate)) ??
      PLAYER_IDS.find((candidate) => !room.players.has(candidate));
    if (!id) return null;
    const observedAt = this.now();
    if (room.reusableSeatIds.delete(id)) room.players.delete(id);
    const player: RoomPlayer = {
      id,
      token: randomToken(),
      name: normalizePlayerName(nameValue),
      connected: true,
      resumable: true,
      explicitKita,
      lastSeenAt: observedAt,
    };
    room.players.set(id, player);
    room.state = playerNameChanged(room.state, id, player.name);
    room.departureNotice = null;
    // `room.players` also retains disconnected seats for resume. Only the
    // newly assigned seat joins this half-game's human-input roster.
    addHumanPlayer(room, player);
    const frozenPlayerIds = [...room.drainFrozenPlayerIds].filter(
      (playerId) => room.players.get(playerId)?.connected !== true,
    );
    if (frozenPlayerIds.length > 0) {
      // `join` is accepted only outside maintenance. If this room was frozen
      // after its last connection dropped, hand those stale inputs back to AI
      // after adding the new guest, so play advances to a connected human
      // instead of deadlocking on the disconnected seat.
      const before = room.state;
      room.state = removeHumanPlayerIds(room.state, frozenPlayerIds);
      if (room.state !== before) room.version += 1;
      for (const playerId of frozenPlayerIds) {
        room.drainFrozenPlayerIds.delete(playerId);
      }
    }
    if (
      room.hostId === null ||
      room.players.get(room.hostId)?.connected !== true
    ) {
      room.hostId = id;
      room.hostTransition = {
        reason: room.hostTransition?.reason ?? "disconnected",
        message: `ホストが不在のため、${player.name}さんへホスト権限を引き継ぎました。`,
      };
    }
    room.lastActivityAt = observedAt;
    return { room, player };
  }

  resume(
    codeValue: unknown,
    token: unknown,
    explicitKita = false,
  ): RoomSession | null {
    const session = this.findResumeSession(codeValue, token);
    return session === null
      ? null
      : this.restoreResumeSession(session, explicitKita);
  }

  /**
   * Resume path for an unsealed drain. A fully disconnected playing/roundEnd
   * room may resume only inside its remaining grace; normal `resume` keeps its
   * pre-drain behavior for callers in the accepting state.
   */
  resumeDuringDrain(
    codeValue: unknown,
    token: unknown,
    reconnectGraceMs: number = ONLINE_DRAIN_RECONNECT_GRACE_MS.default,
    explicitKita = false,
  ): RoomSession | null {
    validateReconnectGraceMs(reconnectGraceMs);
    const session = this.findResumeSession(codeValue, token);
    if (session === null) return null;
    const { room } = session;
    if (
      isDrainBlockingPhase(room.state.phase) &&
      ![...room.players.values()].some((player) => player.connected)
    ) {
      const expiresAt = reconnectGraceExpiresAt(room, reconnectGraceMs);
      const observedAt = this.now();
      if (expiresAt === null || observedAt >= expiresAt) return null;
      return this.restoreResumeSession(session, explicitKita, observedAt);
    }
    return this.restoreResumeSession(session, explicitKita);
  }

  private findResumeSession(
    codeValue: unknown,
    token: unknown,
  ): RoomSession | null {
    const code = normalizeRoomCode(codeValue);
    if (
      code === null ||
      typeof token !== "string" ||
      token.length < ONLINE_RESUME_TOKEN_MIN_LENGTH ||
      token.length > ONLINE_RESUME_TOKEN_MAX_LENGTH
    ) {
      return null;
    }
    const room = this.rooms.get(code);
    if (!room) return null;
    const player = [...room.players.values()].find(
      (candidate) => candidate.resumable && candidate.token === token,
    );
    if (!player) return null;
    return { room, player };
  }

  private restoreResumeSession(
    session: RoomSession,
    explicitKita: boolean,
    observedAt: number = this.now(),
  ): RoomSession {
    const { room, player } = session;
    room.drainFrozenPlayerIds.delete(player.id);
    player.connected = true;
    player.explicitKita ||= explicitKita;
    player.lastSeenAt = observedAt;
    // `newGame` snapshots connected seats into the current half-game roster.
    // Do not promote a seat that was omitted from that roster on resume: doing
    // so would turn a disconnected seat back into a blocking human pending
    // during the same half-game. A seat that was already human remains so.
    const before = room.state;
    if (room.humanPlayerIds.has(player.id)) {
      if (player.explicitKita) {
        room.state = setExplicitKitaPlayerIds(room.state, [
          ...(room.state.explicitKitaPlayerIds ?? []),
          player.id,
        ]);
      }
      room.state = setHumanPlayerIds(room.state, [
        ...(room.state.humanPlayerIds ?? ["p0"]),
        player.id,
      ]);
    }
    if (room.state !== before) room.version += 1;
    if (
      room.hostId === null ||
      room.players.get(room.hostId)?.connected !== true
    ) {
      room.hostId = player.id;
      room.hostTransition = null;
    }
    room.lastActivityAt = observedAt;
    return session;
  }

  touch(room: Room, player: RoomPlayer): void {
    if (!isCurrentPlayer(room, player)) return;
    const observedAt = this.now();
    player.connected = true;
    player.lastSeenAt = observedAt;
    room.lastActivityAt = observedAt;
  }

  disconnect(room: Room, player: RoomPlayer): void {
    this.disconnectPlayer(room, player, false);
  }

  /** Drain-only disconnect path: freeze the last active hand for bounded resume. */
  disconnectDuringDrain(room: Room, player: RoomPlayer): void {
    this.disconnectPlayer(room, player, true);
  }

  private disconnectPlayer(
    room: Room,
    player: RoomPlayer,
    freezeLastPlayingSeat: boolean,
  ): void {
    if (!isCurrentPlayer(room, player)) return;
    const observedAt = this.now();
    player.connected = false;
    player.lastSeenAt = observedAt;
    const shouldFreeze =
      freezeLastPlayingSeat &&
      isDrainBlockingPhase(room.state.phase) &&
      firstConnectedPlayer(room, player.id) === null;
    if (shouldFreeze) {
      room.drainFrozenPlayerIds.add(player.id);
    } else {
      room.drainFrozenPlayerIds.delete(player.id);
      const before = room.state;
      room.state = removeHumanPlayerIds(room.state, [player.id]);
      if (room.state !== before) room.version += 1;
    }
    if (room.hostId === player.id) {
      transferHost(room, player, "disconnected");
    }
    room.lastActivityAt = observedAt;
  }

  /** 明示退出。旧tokenを失効させ、退出席を現局のhuman rosterから解放する。 */
  leave(room: Room, player: RoomPlayer): void {
    if (!isCurrentPlayer(room, player)) return;
    const observedAt = this.now();
    player.connected = false;
    player.resumable = false;
    room.drainFrozenPlayerIds.delete(player.id);
    player.lastSeenAt = observedAt;
    room.humanPlayerIds.delete(player.id);
    const before = room.state;
    room.state = removeHumanPlayerIds(room.state, [player.id]);
    if (room.state !== before) room.version += 1;
    if (room.hostId !== player.id) rememberDeparture(room, player);
    if (room.hostId === player.id) {
      transferHost(room, player, "left");
    }
    // An explicit leave invalidates the session and releases the departed
    // seat for reuse regardless of whether the player was host. This is
    // important when a guest inherited host authority after a handoff.
    room.reusableSeatIds.add(player.id);
    room.lastActivityAt = observedAt;
  }

  apply(
    room: Room,
    player: RoomPlayer,
    action: GameAction,
    expectedVersion: number,
  ): RoomMutation {
    if (!isCurrentPlayer(room, player)) {
      return { ok: false, error: "ルーム接続が無効です。", room };
    }
    room.lastActivityAt = this.now();
    if (expectedVersion !== room.version) {
      return {
        ok: false,
        error: "対局状態が更新されています。最新状態を受信しました。",
        room,
      };
    }
    if (action.type === "nextRound" && player.id !== room.hostId) {
      return {
        ok: false,
        error: "次の局へ進められるのはホストだけです。",
        room,
      };
    }
    if (action.type === "kita" && !player.explicitKita) {
      return {
        ok: false,
        error: "この接続では北抜きは自動処理されます。",
        room,
      };
    }
    const pendingPlayer = playerIdForPending(room.state);
    if (action.type !== "nextRound" && pendingPlayer !== player.id) {
      return { ok: false, error: "現在はあなたの操作順ではありません。", room };
    }
    try {
      const next = applyGameAction(room.state, action, player.id);
      if (next === room.state) {
        return {
          ok: false,
          error: "その操作は現在の局面では実行できません。",
          room,
        };
      }
      room.state = next;
      room.version += 1;
      return { ok: true, stateChanged: true, room };
    } catch {
      return { ok: false, error: "対局操作を検証できませんでした。", room };
    }
  }

  newGame(room: Room, player: RoomPlayer): RoomMutation {
    if (!isCurrentPlayer(room, player)) {
      return { ok: false, error: "ルーム接続が無効です。", room };
    }
    if (player.id !== room.hostId)
      return {
        ok: false,
        error: "新しい半荘を始められるのはホストだけです。",
        room,
      };
    if (room.state.phase !== "gameEnd")
      return {
        ok: false,
        error: "新しい半荘を始められるのは対局終了後です。",
        room,
      };
    const observedAt = this.now();
    const connectedPlayerIds = [...room.players.values()]
      .filter((roomPlayer) => roomPlayer.connected)
      .map((roomPlayer) => roomPlayer.id);
    const explicitKitaPlayerIds = [...room.players.values()]
      .filter((roomPlayer) => roomPlayer.connected && roomPlayer.explicitKita)
      .map((roomPlayer) => roomPlayer.id);
    room.humanPlayerIds.clear();
    for (const playerId of connectedPlayerIds) {
      room.humanPlayerIds.add(playerId);
    }
    room.state = createGame({
      seed: randomSeed(),
      names: namesOf(room),
      // Preserve the current-hand reconnect guard, but do not carry a seat
      // that is still disconnected into a fresh half-game. Otherwise the new
      // game stops at that seat's pending input with no connected actor.
      humanPlayerIds: connectedPlayerIds,
      explicitKitaPlayerIds,
    });
    room.departureNotice = null;
    room.version += 1;
    room.lastActivityAt = observedAt;
    return { ok: true, stateChanged: true, room };
  }

  snapshot(room: Room, player: RoomPlayer): RoomSnapshot {
    return {
      code: room.code,
      version: room.version,
      you: player.id,
      explicitKita: player.explicitKita,
      hostId: room.hostId,
      phase: room.state.phase,
      view: selectView(room.state, player.id),
      pending:
        playerIdForPending(room.state) === player.id
          ? room.state.pending
          : null,
      roundSummary: room.state.lastRound,
      players: PLAYER_IDS.flatMap((id) => {
        const roomPlayer = room.players.get(id);
        if (!roomPlayer) return [];
        return [
          {
            id,
            name: roomPlayer.name,
            connected: roomPlayer.connected,
            isHost: id === room.hostId,
          },
        ];
      }),
      currentTurn: room.state.hand
        ? room.state.hand.seating[room.state.hand.turn]
        : null,
      hostNotice: hostNoticeFor(room),
      departureNotice: room.departureNotice,
    };
  }

  /** Current aggregate without a drain epoch; abandoned count is always zero. */
  aggregateSnapshot(
    reconnectGraceMs: number = ONLINE_DRAIN_RECONNECT_GRACE_MS.default,
    connections: ConnectionAggregateCounts = EMPTY_CONNECTION_COUNTS,
  ): RoomManagerAggregateSnapshot {
    validateReconnectGraceMs(reconnectGraceMs);
    return this.buildAggregateSnapshot(
      reconnectGraceMs,
      validatedConnectionCounts(connections),
      null,
    );
  }

  /**
   * Starts one drain epoch. The returned closure privately remembers which
   * rooms entered grace and therefore can report a cumulative abandonment
   * count without exposing room identifiers or mutable room objects.
   */
  createDrainAggregateObserver(
    reconnectGraceMs: number = ONLINE_DRAIN_RECONNECT_GRACE_MS.default,
  ): DrainAggregateObserver {
    validateReconnectGraceMs(reconnectGraceMs);
    const tracker: DrainAggregateTracker = {
      graceCandidates: new Set(),
      alreadyAbandoned: new WeakSet(),
      abandonedDuringDrainRooms: 0,
    };
    const observedAt = this.now();
    for (const room of this.rooms.values()) {
      if (!isDrainBlockingPhase(room.state.phase)) continue;
      if ([...room.players.values()].some((player) => player.connected)) {
        continue;
      }
      const expiresAt = reconnectGraceExpiresAt(room, reconnectGraceMs);
      if (expiresAt === null) continue;
      if (observedAt < expiresAt) tracker.graceCandidates.add(room);
      else tracker.alreadyAbandoned.add(room);
    }
    return Object.freeze({
      snapshot: (
        connections: ConnectionAggregateCounts = EMPTY_CONNECTION_COUNTS,
      ) =>
        this.buildAggregateSnapshot(
          reconnectGraceMs,
          validatedConnectionCounts(connections),
          tracker,
        ),
    });
  }

  private buildAggregateSnapshot(
    reconnectGraceMs: number,
    connections: ConnectionAggregateCounts,
    tracker: DrainAggregateTracker | null,
  ): RoomManagerAggregateSnapshot {
    const observedAt = this.now();
    const retainedRoomSet = new Set(this.rooms.values());
    let connectedRooms = 0;
    let blockingDrainRooms = 0;
    let reconnectGraceRooms = 0;
    let completedConnectedRooms = 0;
    let uniqueConnectedSeats = 0;

    if (tracker !== null) {
      // A sweep can remove a grace candidate before the next timer/status
      // tick. Reconcile the privately retained object first so expiry is still
      // counted exactly once, then release the strong Set reference.
      for (const room of tracker.graceCandidates) {
        if (retainedRoomSet.has(room)) continue;
        tracker.graceCandidates.delete(room);
        const expiresAt = reconnectGraceExpiresAt(room, reconnectGraceMs);
        if (
          isDrainBlockingPhase(room.state.phase) &&
          ![...room.players.values()].some((player) => player.connected) &&
          expiresAt !== null &&
          observedAt >= expiresAt &&
          !tracker.alreadyAbandoned.has(room)
        ) {
          tracker.alreadyAbandoned.add(room);
          tracker.abandonedDuringDrainRooms += 1;
        }
      }
    }

    for (const room of retainedRoomSet) {
      const connectedSeats = [...room.players.values()].filter(
        (player) => player.connected,
      ).length;
      const hasConnectedSeat = connectedSeats > 0;
      uniqueConnectedSeats += connectedSeats;
      if (hasConnectedSeat) connectedRooms += 1;
      if (hasConnectedSeat && room.state.phase === "gameEnd") {
        completedConnectedRooms += 1;
      }

      if (!isDrainBlockingPhase(room.state.phase)) {
        tracker?.graceCandidates.delete(room);
        continue;
      }
      if (hasConnectedSeat) {
        blockingDrainRooms += 1;
        tracker?.graceCandidates.delete(room);
        continue;
      }

      const expiresAt = reconnectGraceExpiresAt(room, reconnectGraceMs);
      if (expiresAt === null) {
        tracker?.graceCandidates.delete(room);
        continue;
      }
      if (observedAt < expiresAt) {
        blockingDrainRooms += 1;
        reconnectGraceRooms += 1;
        tracker?.graceCandidates.add(room);
        continue;
      }
      if (
        tracker?.graceCandidates.delete(room) &&
        !tracker.alreadyAbandoned.has(room)
      ) {
        tracker.alreadyAbandoned.add(room);
        tracker.abandonedDuringDrainRooms += 1;
      }
    }

    return Object.freeze({
      retainedRooms: this.rooms.size,
      connectedRooms,
      blockingDrainRooms,
      reconnectGraceRooms,
      completedConnectedRooms,
      abandonedDuringDrainRooms: tracker?.abandonedDuringDrainRooms ?? 0,
      webSocketConnections: connections.webSocketConnections,
      attachedSessionConnections: connections.attachedSessionConnections,
      uniqueConnectedSeats,
      pendingUpgrades: connections.pendingUpgrades,
    });
  }

  sweep(): void {
    const cutoff = this.now() - ROOM_TTL_MS;
    for (const [code, room] of this.rooms) {
      // A connected seat is an active-room signal even when the game is
      // temporarily quiet. Do not let the retention TTL erase a live game
      // before its socket close path can update the drain aggregate.
      if ([...room.players.values()].some((player) => player.connected)) {
        continue;
      }
      if (room.lastActivityAt < cutoff) this.rooms.delete(code);
    }
  }
}

export type { Room, RoomPlayer };
