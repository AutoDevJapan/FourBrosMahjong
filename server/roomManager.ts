import { randomBytes } from "node:crypto";
import {
  applyGameAction,
  type GameAction,
} from "../src/components/game/gamePersistence";
import { selectView } from "../src/components/game/gameView";
import type { GameViewState } from "../src/components/game/types";
import {
  createGame,
  DEFAULT_NAMES,
  type EngineState,
  type Pending,
  type PlayerId,
  type PlayerNames,
  setHumanPlayerIds,
} from "../src/domain/game/engine";
import { sanitizePlayerName } from "../src/lib/playerName";

const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
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
  readonly phase: EngineState["phase"];
  readonly view: GameViewState;
  /** 相手の手牌を含む非公開入力は担当者にだけ返す。 */
  readonly pending: Pending;
  readonly roundSummary: EngineState["lastRound"];
  readonly players: readonly RoomPlayerSnapshot[];
  readonly currentTurn: PlayerId | null;
}

interface RoomPlayer {
  readonly id: PlayerId;
  readonly token: string;
  name: string;
  connected: boolean;
  lastSeenAt: number;
}

interface Room {
  readonly code: string;
  state: EngineState;
  version: number;
  readonly players: Map<PlayerId, RoomPlayer>;
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

export function normalizeRoomCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z2-9]{6}$/.test(code) ? code : null;
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
  room.state = setHumanPlayerIds(room.state, [
    ...(room.state.humanPlayerIds ?? ["p0"]),
    playerId,
  ]);
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
    const id = PLAYER_IDS.find((candidate) => !room.players.has(candidate));
    if (!id) return null;
    const player: RoomPlayer = {
      id,
      token: randomToken(),
      name: normalizePlayerName(nameValue),
      connected: true,
      lastSeenAt: now(),
    };
    room.players.set(id, player);
    room.state = playerNameChanged(room.state, id, player.name);
    // `room.players` also retains disconnected seats for resume. Only the
    // newly assigned seat joins this half-game's human-input roster.
    addHumanPlayer(room, id);
    room.lastActivityAt = now();
    return { room, player };
  }

  resume(codeValue: unknown, token: unknown): RoomSession | null {
    const code = normalizeRoomCode(codeValue);
    if (code === null || typeof token !== "string") return null;
    const room = this.rooms.get(code);
    if (!room) return null;
    const player = [...room.players.values()].find(
      (candidate) => candidate.token === token,
    );
    if (!player) return null;
    player.connected = true;
    player.lastSeenAt = now();
    // `newGame` snapshots connected seats into the current half-game roster.
    // Do not promote a seat that was omitted from that roster on resume: doing
    // so would turn a disconnected seat back into a blocking human pending
    // during the same half-game. A seat that was already human remains so.
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
    if (action.type === "nextRound" && player.id !== "p0") {
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
    if (player.id !== "p0")
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
    room.state = createGame({
      seed: randomSeed(),
      names: namesOf(room),
      // Preserve the current-hand reconnect guard, but do not carry a seat
      // that is still disconnected into a fresh half-game. Otherwise the new
      // game stops at that seat's pending input with no connected actor.
      humanPlayerIds: [...room.players.values()]
        .filter((roomPlayer) => roomPlayer.connected)
        .map((roomPlayer) => roomPlayer.id),
    });
    room.version += 1;
    room.lastActivityAt = now();
    return { ok: true, stateChanged: true, room };
  }

  snapshot(room: Room, player: RoomPlayer): RoomSnapshot {
    return {
      code: room.code,
      version: room.version,
      you: player.id,
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
            isHost: id === "p0",
          },
        ];
      }),
      currentTurn: room.state.hand
        ? room.state.hand.seating[room.state.hand.turn]
        : null,
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
