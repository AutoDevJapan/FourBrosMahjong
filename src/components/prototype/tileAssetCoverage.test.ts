import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTile, HONOR, type Tile } from "@/domain/tiles/tile";
import { buildTileSet, TOTAL_TILE_COUNT } from "@/domain/tiles/tileSet";
import { resolveTileFace, TILE_ASSET_URLS } from "../common/tileImage";
import {
  buildTileAssetCoverage,
  type TileAssetCoverageEntry,
  validateTileAssetCoverage,
} from "./tileAssetCoverage";

function changed(id: string, patch: Partial<TileAssetCoverageEntry>) {
  return buildTileAssetCoverage().map((entry) =>
    entry.id === id ? { ...entry, ...patch } : entry,
  );
}

describe("#1180 canonical tile asset coverage", () => {
  it("27 正規面＋Back の28行は108枚の山と別の台帳で、北を二重計上しない", () => {
    const entries = buildTileAssetCoverage();
    const faces = entries.filter((entry) => entry.tile !== null);
    expect(buildTileSet()).toHaveLength(108);
    expect(TOTAL_TILE_COUNT).toBe(108);
    expect(faces).toHaveLength(27);
    expect(entries).toHaveLength(28);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(28);
    expect(faces.filter((entry) => entry.tile?.suit === "honor")).toHaveLength(
      7,
    );
    expect(
      faces.filter(
        (entry) =>
          entry.tile?.suit === "honor" && entry.tile.rank === HONOR.NORTH,
      ),
    ).toEqual([expect.objectContaining({ id: "Pei" })]);
    expect(entries.find((entry) => entry.id === "Back")).toEqual({
      id: "Back",
      tile: null,
      svg: "/tiles/Back.svg",
      native: "not-supplied",
    });
    for (const tile of buildTileSet()) {
      expect(
        faces.filter(
          (entry) => JSON.stringify(entry.tile) === JSON.stringify(tile),
        ),
      ).toHaveLength(1);
    }
    expect(validateTileAssetCoverage(entries)).toEqual([]);
  });

  it("全行の2D SVG が既存写像・配信カタログ・実ファイルに一致する", () => {
    for (const entry of buildTileAssetCoverage()) {
      expect(TILE_ASSET_URLS).toContain(entry.svg);
      if (entry.tile) {
        expect(resolveTileFace(entry.tile)).toEqual({
          kind: "image",
          name: entry.id,
          src: entry.svg,
        });
      }
      const asset = fileURLToPath(
        new URL(`../../../public${entry.svg}`, import.meta.url),
      );
      const svg = readFileSync(asset, "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toMatch(/viewBox="0 0 300 400"/);
    }
  });

  it("黒5の防御的2Dカタログを正規集合に昇格せず、赤5を各1面に写像する", () => {
    const entries = buildTileAssetCoverage();
    for (const [suit, id] of [
      ["pin", "Pin5"],
      ["sou", "Sou5"],
    ] as const) {
      expect(TILE_ASSET_URLS).toContain(`/tiles/${id}.svg`);
      expect(entries.some((entry) => entry.id === id)).toBe(false);
      expect(entries.find((entry) => entry.id === `${id}-Dora`)).toMatchObject({
        tile: createTile(suit, 5),
        svg: `/tiles/${id}-Dora.svg`,
      });
    }
  });

  it("台帳整合と本番native供給を混同せず、全28 binding を未供給と明示する", () => {
    const entries = buildTileAssetCoverage();
    expect(validateTileAssetCoverage(entries)).toEqual([]);
    expect(
      entries.filter((entry) => entry.native === "not-supplied"),
    ).toHaveLength(28);
  });

  it("決定的に生成し、呼出し順や利用側変更に依存しない", () => {
    const first = buildTileAssetCoverage();
    expect(buildTileAssetCoverage()).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    for (const entry of first) {
      expect(Object.isFrozen(entry)).toBe(true);
      if (entry.tile) expect(Object.isFrozen(entry.tile)).toBe(true);
    }
    expect(validateTileAssetCoverage([...first].reverse())).toEqual([]);
    expect(
      validateTileAssetCoverage(
        changed("Pin5-Dora", {
          tile: { isRed: true, rank: 5, suit: "pin" },
        }),
      ),
    ).toEqual([]);
  });

  it.each(["Man1", "Pin5-Dora", "Pei", "Back"])("欠損 %s を拒否する", (id) => {
    const entries = buildTileAssetCoverage().filter((entry) => entry.id !== id);
    expect(validateTileAssetCoverage(entries)).toContainEqual({
      id,
      reason: "missing",
    });
  });

  it("空台帳では27面と裏面すべての欠損を報告する", () => {
    const issues = validateTileAssetCoverage([]);
    expect(issues).toHaveLength(28);
    expect(issues.every((issue) => issue.reason === "missing")).toBe(true);
  });

  it.each(["Pei", "Back"])("同じ内容でも二重ID %s を拒否する", (id) => {
    const entries = buildTileAssetCoverage();
    const duplicate = entries.find((entry) => entry.id === id);
    if (!duplicate) throw new Error(id);
    expect(validateTileAssetCoverage([...entries, duplicate])).toContainEqual({
      id,
      reason: "duplicate",
    });
  });

  it.each<[string, Tile]>([
    ["Pin5", { suit: "pin", rank: 5, isRed: false }],
    ["Sou5", { suit: "sou", rank: 5, isRed: false }],
    ...[2, 3, 4, 5, 6, 7, 8].map((rank): [string, Tile] => [
      `Man${rank}`,
      createTile("man", rank),
    ]),
  ])("正規外の %s を追加できない", (id, tile) => {
    expect(
      validateTileAssetCoverage([
        ...buildTileAssetCoverage(),
        { id, tile, svg: `/tiles/${id}.svg`, native: "not-supplied" },
      ]),
    ).toContainEqual({ id, reason: "unexpected" });
  });

  it.each<[string, Tile]>([
    ["Pin5-Dora", { suit: "pin", rank: 5, isRed: false }],
    ["Sou5-Dora", { suit: "sou", rank: 5, isRed: false }],
    ["Man1", { suit: "man", rank: 1, isRed: true }],
    ["Man9", createTile("man", 8)],
    ["Pei", createTile("honor", HONOR.EAST)],
  ])("IDを残したままの非正規/別牌種差し替え %s を拒否する", (id, tile) => {
    expect(validateTileAssetCoverage(changed(id, { tile }))).toContainEqual({
      id,
      reason: "tile-mismatch",
    });
  });

  it.each([
    ["Pin5-Dora", "/tiles/Pin5.svg"],
    ["Sou5-Dora", "/tiles/Sou5.svg"],
    ["Pin5-Dora", "/tiles/Sou5-Dora.svg"],
    ["Man1", "/tiles/Back.svg"],
    ["Back", "/tiles/Pin1.svg"],
    ["Pei", "/tiles/missing.svg"],
  ])("誤った赤写像/裏表/不存在SVG %s→%s を拒否する", (id, svg) => {
    expect(validateTileAssetCoverage(changed(id, { svg }))).toContainEqual({
      id,
      reason: "svg-mismatch",
    });
  });

  it("Back に顔付き牌を割り当てられない", () => {
    expect(
      validateTileAssetCoverage(
        changed("Back", { tile: createTile("pin", 1) }),
      ),
    ).toContainEqual({ id: "Back", reason: "tile-mismatch" });
  });

  it("表向きの牌を顔なしにできない", () => {
    expect(
      validateTileAssetCoverage(changed("Man1", { tile: null })),
    ).toContainEqual({ id: "Man1", reason: "tile-mismatch" });
  });

  it("既存studyを本番bindingに昇格する供給状態はこの契約で受け入れない", () => {
    const entries = changed("Pin5-Dora", {
      native: "study-supplied" as "not-supplied",
    });
    expect(validateTileAssetCoverage(entries)).toContainEqual({
      id: "Pin5-Dora",
      reason: "unsupported-native-supply",
    });
  });
});
