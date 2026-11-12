import type {
  DisplayEnvelope,
  DisplayOption,
} from "@/domain/display/displaySnapshot";

export type SceneGroup =
  | "table"
  | "hand"
  | "discards"
  | "melds"
  | "kita"
  | "dora";
export type Vec3 = readonly [number, number, number];
type Snapshot = DisplayEnvelope["snapshot"];
type Slot = Snapshot["slots"][number];
type Face = Snapshot["dora"]["indicators"][number];
type ScenePosition = Slot["position"];

export const SCENE_GROUPS: readonly SceneGroup[] = [
  "table",
  "hand",
  "discards",
  "melds",
  "kita",
  "dora",
];
const HONORS = ["", "Ton", "Nan", "Shaa", "Pei", "Haku", "Hatsu", "Chun"];
// This is a texture catalogue, not tile/rule construction. The DTO's red flag
// is already resolved by the adapter. Never call the engine or a tile factory.
export const TILE_TEXTURE_URLS: readonly string[] = [
  "Man1",
  "Man9",
  ...Array.from({ length: 9 }, (_, i) => `Pin${i + 1}`),
  "Pin5-Dora",
  ...Array.from({ length: 9 }, (_, i) => `Sou${i + 1}`),
  "Sou5-Dora",
  ...HONORS.slice(1),
  "Back",
].map((name) => `/tiles/${name}.svg`);
const TEXTURES = new Set(TILE_TEXTURE_URLS);
const ANGLE: Record<ScenePosition, number> = {
  self: 0,
  left: -Math.PI / 2,
  across: Math.PI,
  right: Math.PI / 2,
};

export interface SceneTile {
  readonly id: string;
  readonly group: Exclude<SceneGroup, "table">;
  readonly position: ScenePosition | null;
  readonly center: Vec3;
  /** Euler rotations in radians, applied X then Y. */
  readonly rotation: Vec3;
  readonly size: Vec3;
  /** null always means a back, never an inferred/placeholder face. */
  readonly face: string | null;
  readonly optionId: string | null;
  readonly optionIds: readonly string[];
}

interface SceneSolid {
  readonly center: Vec3;
  readonly size: Vec3;
  readonly color: Vec3;
  readonly material: "felt" | "rim" | "panel";
}

interface SceneSlot {
  readonly position: ScenePosition;
  readonly playerId: Slot["playerId"];
  readonly kind: Slot["kind"];
  /** CSS overlays use renderer.projectPoint(anchor); no names/points copied. */
  readonly anchor: Vec3;
}

export interface MahjongScene {
  readonly tiles: readonly SceneTile[];
  readonly solids: readonly SceneSolid[];
  readonly slots: readonly SceneSlot[];
  readonly centerAnchor: Vec3;
}

function faceUrl(tile: Face): string {
  if (!tile || typeof tile.red !== "boolean" || !Number.isInteger(tile.rank))
    throw new TypeError("Invalid display tile");
  const name =
    tile.suit === "honor"
      ? HONORS[tile.rank]
      : `${{ man: "Man", pin: "Pin", sou: "Sou" }[tile.suit]}${tile.rank}${tile.red ? "-Dora" : ""}`;
  const url = `/tiles/${name}.svg`;
  if (
    !TEXTURES.has(url) ||
    (tile.red && (tile.rank !== 5 || tile.suit === "honor"))
  )
    throw new TypeError("Display tile has no bundled texture");
  return url;
}

function count(value: number | undefined, max: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value === undefined ||
    value < 0 ||
    value > max
  )
    throw new TypeError("Invalid display count");
  return value;
}

function seatPoint(
  position: ScenePosition,
  x: number,
  y: number,
  z: number,
): Vec3 {
  const a = ANGLE[position];
  return [
    Math.cos(a) * x + Math.sin(a) * z,
    y,
    -Math.sin(a) * x + Math.cos(a) * z,
  ];
}

function validate(envelope: DisplayEnvelope) {
  if (
    envelope.protocol !== "four-bros-mahjong/local-display" ||
    envelope.version !== 1 ||
    !envelope.sessionId ||
    !Number.isSafeInteger(envelope.generation) ||
    envelope.generation < 1 ||
    envelope.sessionId.length > 96 ||
    !Number.isSafeInteger(envelope.revision) ||
    envelope.revision < 0 ||
    (envelope.mode !== "restore" && envelope.mode !== "live")
  )
    throw new TypeError("Unsupported display envelope");
  const slots = envelope.snapshot.slots;
  if (
    slots.length !== 4 ||
    new Set(slots.map((s) => s.position)).size !== 4 ||
    slots.some((s) => !Object.hasOwn(ANGLE, s.position)) ||
    new Set(slots.map((s) => s.playerId)).size !== 4 ||
    slots.filter((s) => s.kind === "bench").length !== 1 ||
    slots.filter((s) => s.kind === "seated").length !== 3 ||
    slots.find((s) => s.position === "self")?.playerId !==
      envelope.snapshot.playerId
  )
    throw new TypeError("Invalid display seats");
}

function sameFace(a: Face, b: Face) {
  return a.suit === b.suit && a.rank === b.rank && a.red === b.red;
}

/** A full replacement projection from public DTO fields; no transition/cue state. */
export function projectScene(
  envelope: DisplayEnvelope,
  groups: readonly SceneGroup[] = SCENE_GROUPS,
): MahjongScene {
  validate(envelope);
  const enabled = new Set(groups);
  const tiles: SceneTile[] = [];
  const solids: SceneSolid[] = [];
  const slots: SceneSlot[] = [];
  const tile = (
    id: string,
    group: SceneTile["group"],
    position: ScenePosition | null,
    center: Vec3,
    rotation: Vec3,
    size: Vec3,
    face: string | null,
    optionIds: readonly string[] = [],
  ) => {
    if (enabled.has(group))
      tiles.push({
        id,
        group,
        position,
        center,
        rotation,
        size,
        face,
        optionId: optionIds[0] ?? null,
        optionIds,
      });
  };
  if (enabled.has("table")) {
    solids.push(
      {
        center: [0, -0.7, 0],
        size: [27, 1.1, 27],
        color: [0.025, 0.035, 0.033],
        material: "rim",
      },
      {
        center: [0, -0.12, 0],
        size: [26, 0.24, 26],
        color: [0.018, 0.24, 0.105],
        material: "felt",
      },
      {
        center: [0, 0.09, 0],
        size: [5.7, 0.18, 5.4],
        color: [0.016, 0.026, 0.022],
        material: "panel",
      },
    );
  }
  const data = envelope.snapshot;
  for (const slot of data.slots) {
    const position = slot.position;
    slots.push({
      position,
      playerId: slot.playerId,
      kind: slot.kind,
      anchor: seatPoint(position, 0, 1.6, 13.4),
    });
    if (slot.kind === "bench") continue;
    const yaw = ANGLE[position];
    const own = position === "self";
    // Read actual own faces only. Even a contaminated opponent/bench hand is ignored.
    const hand = own && "hand" in slot ? slot.hand : [];
    const drawnIndex =
      own && "drawnIndex" in slot ? (slot.drawnIndex ?? null) : null;
    const orderedHand = hand
      .map((_, index) => index)
      .filter((index) => index !== drawnIndex);
    if (drawnIndex !== null) orderedHand.push(drawnIndex);
    const length = own
      ? count(hand.length, 14)
      : count("handCount" in slot ? slot.handCount : undefined, 14);
    const usedDiscard = new Set<string>();
    const actionOptions = data.options.filter(
      (option): option is Extract<DisplayOption, { tile: Face }> =>
        "tile" in option,
    );
    for (let i = 0; i < length; i++) {
      const sourceIndex = own ? orderedHand[i] : i;
      const value = hand[sourceIndex];
      const matching = own
        ? actionOptions.filter((option) => sameFace(option.tile, value))
        : [];
      const discard = matching.find(
        (option) => option.action === "discard" && !usedDiscard.has(option.id),
      );
      if (discard) usedDiscard.add(discard.id);
      const ids = [
        ...(discard ? [discard.id] : []),
        ...matching
          .filter((option) => option.action !== "discard")
          .map((option) => option.id),
      ];
      tile(
        `${position}/hand/${sourceIndex}`,
        "hand",
        position,
        seatPoint(
          position,
          (i - (length - 1) / 2) * 1.02 +
            (drawnIndex !== null && i === length - 1 ? 0.45 : 0),
          0.82,
          10.9,
        ),
        [0.82, yaw, 0],
        [0.96, 0.43, 1.4],
        own ? faceUrl(value) : null,
        ids,
      );
    }
    count(slot.discards.length, 40);
    let discardOffset = 0;
    for (let i = 0; i < slot.discards.length; i++) {
      const value = slot.discards[i];
      if (i % 6 === 0) discardOffset = 0;
      const sideways = value.isRiichi === true;
      const footprintWidth = sideways ? 0.97 : 0.71;
      tile(
        `${position}/discard/${i}`,
        "discards",
        position,
        seatPoint(
          position,
          -2.05 + discardOffset + (footprintWidth - 0.71) / 2,
          0.24,
          3.9 + Math.floor(i / 6) * 1.02,
        ),
        [0, yaw + (sideways ? Math.PI / 2 : 0), 0],
        [0.71, 0.42, 0.97],
        faceUrl(value),
      );
      discardOffset += footprintWidth + 0.06;
    }
    count(slot.melds.length, 4);
    // Public meld order is preserved. The DTO has no called-from/added-kan
    // index, so do not invent sideways called tiles or a kakan stack.
    let meldOffset = -7.6;
    for (let m = 0; m < slot.melds.length; m++) {
      const meld = slot.melds[m];
      count(meld.tiles.length, 4);
      for (let j = 0; j < meld.tiles.length; j++) {
        const concealed =
          meld.concealed && (j === 0 || j === meld.tiles.length - 1);
        tile(
          `${position}/meld/${m}/${j}`,
          "melds",
          position,
          seatPoint(position, meldOffset + j * 0.83, 0.25, 8.7),
          [0, yaw, 0],
          [0.78, 0.44, 1.1],
          concealed || meld.tiles[j] === null ? null : faceUrl(meld.tiles[j]!),
        );
      }
      meldOffset += meld.tiles.length * 0.83 + 0.35;
    }
    for (let i = 0; i < count(slot.kitaCount, 4); i++) {
      tile(
        `${position}/kita/${i}`,
        "kita",
        position,
        seatPoint(position, 6.1 + i * 0.83, 0.25, 7.2),
        [0, yaw, 0],
        [0.78, 0.44, 1.1],
        "/tiles/Pei.svg",
      );
    }
  }
  count(data.dora.indicators.length, 5);
  const uraCount = count(data.dora.uraIndicatorCount, 5);
  for (let i = 0; i < data.dora.indicators.length; i++) {
    tile(
      `dora/${i}`,
      "dora",
      null,
      [(i - (data.dora.indicators.length - 1) / 2) * 0.91, 0.46, -0.45],
      [0, 0, 0],
      [0.84, 0.43, 1.18],
      faceUrl(data.dora.indicators[i]),
    );
  }
  for (let i = 0; i < uraCount; i++) {
    const revealed =
      data.phase !== "playing" ? data.dora.uraIndicators[i] : undefined;
    tile(
      `ura/${i}`,
      "dora",
      null,
      [(i - (uraCount - 1) / 2) * 0.91, 0.46, 1.05],
      [0, 0, 0],
      [0.84, 0.43, 1.18],
      revealed ? faceUrl(revealed) : null,
    );
  }
  return { tiles, solids, slots, centerAnchor: [0, 0.3, -1.7] };
}
