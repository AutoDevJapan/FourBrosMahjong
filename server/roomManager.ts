import { randomBytes } from "node:crypto";
import {
  applyGameAction,
  type GameAction,
} from "../src/components/game/gamePersistence";
import { selectView } from "../src/components/game/gameView";
import type { GameViewState } from "../src/components/game/types";
import type {
  OnlineDepartureNotice,
  OnlineHostNotice,
  OnlineHostTransitionReason,
} from "../src/components/online/types";
import {
  createGame,
  DEFAULT_NAMES,
  type EngineState,
  type Pending,
  type PlayerId,
  type PlayerNames,
  removeHumanPlayerIds,
  setHumanPlayerIds,
} from "../src/domain/game/engine";
import { sanitizePlayerName } from "../src/lib/playerName";
import {
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "../src/lib/roomCode";

export { normalizeRoomCode } from "../src/lib/roomCode";

const ROOM_TTL_MS = 60 * 60 * 1000;
const MAX_ROOMS = 1_000;

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
  /** 明示退出したguestのseat。次のjoinで同じIDを安全に置換する。 */
  readonly reusableSeatIds: Set<PlayerId>;
  /** 現在のhost席。host切断後は接続中のguestへ即時に移る。 */
  hostId: PlayerId | null;
  /** 現局で人間席だったか。切断時にAIへ解放してもresumeで復元する。 */
  readonly humanPlayerIds: Set<PlayerId>;
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

function now(): number {
  return Date.now();
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
  return sanitizePlayerName(value) ?? fallback;
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
function addHumanPlayer(room: Room, playerId: PlayerId): void {
  room.humanPlayerIds.add(playerId);
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
  const suit = tile.suit as string;
  const rank = tile.rank;
  if (!Number.isInteger(rank)) return false;
  if ((rank as number) < 1) return false;
  if (suit === "honor" && (rank as number) > 7) return false;
  if (suit !== "honor" && (rank as number) > 9) return false;
  return (
    typeof tile.isRed === "boolean" &&
    (!tile.isRed || (suit !== "honor" && rank === 5))
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

  create(nameValue: unknown): RoomSession {
    if (this.rooms.size >= MAX_ROOMS) {
      throw new Error(
        "現在ルームが混み合っています。少し待ってから再試行してください。",
      );
    }
    let code = randomRoomCode();
    while (this.rooms.has(code)) code = randomRoomCode();
    const name = normalizePlayerName(nameValue, "ホスト");
    const player: RoomPlayer = {
      id: "p0",
      token: randomToken(),
      name,
      connected: true,
      resumable: true,
      lastSeenAt: now(),
    };
    const room: Room = {
      code,
      state: createGame({
        seed: randomSeed(),
        names: [name, "ゲスト2", "ゲスト3", "ゲスト4"],
        humanPlayerIds: ["p0"],
      }),
      version: 0,
      players: new Map([[player.id, player]]),
      reusableSeatIds: new Set(),
      hostId: "p0",
      humanPlayerIds: new Set(["p0"]),
      hostTransition: null,
      departureNotice: null,
      lastActivityAt: now(),
    };
    this.rooms.set(code, room);
    return { room, player };
  }

  join(codeValue: unknown, nameValue: unknown): RoomSession | null {
    const code = normalizeRoomCode(codeValue);
    if (code === null) return null;
    const room = this.rooms.get(code);
    if (!room) return null;
    const id =
      PLAYER_IDS.find((candidate) => room.reusableSeatIds.has(candidate)) ??
      PLAYER_IDS.find((candidate) => !room.players.has(candidate));
    if (!id) return null;
    if (room.reusableSeatIds.delete(id)) room.players.delete(id);
    const player: RoomPlayer = {
      id,
      token: randomToken(),
      name: normalizePlayerName(nameValue),
      connected: true,
      resumable: true,
      lastSeenAt: now(),
    };
    room.players.set(id, player);
    room.state = playerNameChanged(room.state, id, player.name);
    room.departureNotice = null;
    // `room.players` also retains disconnected seats for resume. Only the
    // newly assigned seat joins this half-game's human-input roster.
    addHumanPlayer(room, id);
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
    room.lastActivityAt = now();
    return { room, player };
  }

  resume(codeValue: unknown, token: unknown): RoomSession | null {
    const code = normalizeRoomCode(codeValue);
    if (code === null || typeof token !== "string") return null;
    const room = this.rooms.get(code);
    if (!room) return null;
    const player = [...room.players.values()].find(
      (candidate) => candidate.resumable && candidate.token === token,
    );
    if (!player) return null;
    player.connected = true;
    player.lastSeenAt = now();
    // `newGame` snapshots connected seats into the current half-game roster.
    // Do not promote a seat that was omitted from that roster on resume: doing
    // so would turn a disconnected seat back into a blocking human pending
    // during the same half-game. A seat that was already human remains so.
    const before = room.state;
    if (room.humanPlayerIds.has(player.id)) {
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
    room.lastActivityAt = now();
    return { room, player };
  }

  touch(room: Room, player: RoomPlayer): void {
    player.connected = true;
    player.lastSeenAt = now();
    room.lastActivityAt = now();
  }

  disconnect(room: Room, player: RoomPlayer): void {
    player.connected = false;
    player.lastSeenAt = now();
    if (room.hostId === player.id) {
      transferHost(room, player, "disconnected");
      const before = room.state;
      room.state = removeHumanPlayerIds(room.state, [player.id]);
      if (room.state !== before) room.version += 1;
    }
    room.lastActivityAt = now();
  }

  /** 明示退出。旧tokenを失効させ、退出席を現局のhuman rosterから解放する。 */
  leave(room: Room, player: RoomPlayer): void {
    player.connected = false;
    player.resumable = false;
    player.lastSeenAt = now();
    room.humanPlayerIds.delete(player.id);
    const before = room.state;
    room.state = removeHumanPlayerIds(room.state, [player.id]);
    if (room.state !== before) room.version += 1;
    if (room.hostId !== player.id) rememberDeparture(room, player);
    if (room.hostId === player.id) {
      transferHost(room, player, "left");
    } else {
      room.reusableSeatIds.add(player.id);
    }
    room.lastActivityAt = now();
  }

  apply(
    room: Room,
    player: RoomPlayer,
    action: GameAction,
    expectedVersion: number,
  ): RoomMutation {
    room.lastActivityAt = now();
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
    const connectedPlayerIds = [...room.players.values()]
      .filter((roomPlayer) => roomPlayer.connected)
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
    });
    room.departureNotice = null;
    room.version += 1;
    room.lastActivityAt = now();
    return { ok: true, stateChanged: true, room };
  }

  snapshot(room: Room, player: RoomPlayer): RoomSnapshot {
    return {
      code: room.code,
      version: room.version,
      you: player.id,
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

  sweep(): void {
    const cutoff = now() - ROOM_TTL_MS;
    for (const [code, room] of this.rooms) {
      if (room.lastActivityAt < cutoff) this.rooms.delete(code);
    }
  }
}

export type { Room, RoomPlayer };
