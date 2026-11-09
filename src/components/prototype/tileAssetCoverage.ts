/**
 * #1180 の内部素材台帳。対局牌の SSOT と既存 2D 写像を再利用する。
 * renderer の公開 ID / loader / native 素材の利用許可を定義するものではない。
 */
import { tileKey } from "@/domain/hand/tile-identity";
import type { Tile } from "@/domain/tiles/tile";
import { buildTileSet } from "@/domain/tiles/tileSet";
import { resolveTileFace, TILE_ASSET_URLS } from "../common/tileImage";

export interface TileAssetCoverageEntry {
  /** 既存 SVG 名を借りた台帳内キー。外部 wire ID ではない。 */
  readonly id: string;
  /** Back は牌種ではなく、公開できる牌面を一切持たない。 */
  readonly tile: Tile | null;
  readonly svg: string;
  /** 本番用の牌種別 native binding は未供給。代表牌 study の不存在を意味しない。 */
  readonly native: "not-supplied";
}

type CoverageIssue = {
  readonly id: string;
  readonly reason:
    | "missing"
    | "duplicate"
    | "unexpected"
    | "tile-mismatch"
    | "svg-mismatch"
    | "unsupported-native-supply";
};

/** 108 枚の山から重複を除く。北を別途追加せず、Back は山に含めない。 */
export function buildTileAssetCoverage(): readonly TileAssetCoverageEntry[] {
  const kinds = new Map(buildTileSet().map((tile) => [tileKey(tile), tile]));
  const entries: TileAssetCoverageEntry[] = [];
  const ids = new Set<string>();
  for (const tile of kinds.values()) {
    const face = resolveTileFace(tile);
    if (face.kind !== "image" || face.name === "Back" || ids.has(face.name)) {
      throw new Error(`Canonical tile has no unique face: ${tileKey(tile)}`);
    }
    ids.add(face.name);
    entries.push(
      Object.freeze({
        id: face.name,
        tile,
        svg: face.src,
        native: "not-supplied",
      }),
    );
  }
  // 裏面 URL も既存配信カタログから取り、別の素材カタログを作らない。
  const back = TILE_ASSET_URLS.find((src) => src.endsWith("/Back.svg"));
  if (!back) throw new Error("Back asset is missing from the 2D catalog");
  entries.push(
    Object.freeze({
      id: "Back",
      tile: null,
      svg: back,
      native: "not-supplied",
    }),
  );
  return Object.freeze(entries);
}

/**
 * 型付きのローカル台帳を正規集合と照合する純粋な guard（JSON parser ではない）。
 * [] は台帳が整合する意味のみ。全 native binding は依然として未供給。
 */
export function validateTileAssetCoverage(
  entries: readonly TileAssetCoverageEntry[],
): readonly CoverageIssue[] {
  const required = new Map(
    buildTileAssetCoverage().map((entry) => [entry.id, entry]),
  );
  const seen = new Set<string>();
  const issues: CoverageIssue[] = [];
  for (const entry of entries) {
    const id = entry.id;
    if (seen.has(id)) issues.push({ id, reason: "duplicate" });
    seen.add(id);
    const expected = required.get(id);
    if (!expected) {
      issues.push({ id, reason: "unexpected" });
      continue;
    }
    const tile = entry.tile;
    // SSOT が生成した全フィールドとの値比較。赤の規則を再判定せず、
    // 不正な赤フラグも見逃さない（オブジェクトのプロパティ順には依存しない）。
    const tileMatches =
      expected.tile === null
        ? tile === null
        : tile !== null &&
          Object.entries(expected.tile).every(
            ([field, value]) => tile[field as keyof Tile] === value,
          );
    if (!tileMatches) issues.push({ id, reason: "tile-mismatch" });
    if (entry.svg !== expected.svg) issues.push({ id, reason: "svg-mismatch" });
    if (entry.native !== expected.native) {
      issues.push({ id, reason: "unsupported-native-supply" });
    }
  }
  for (const id of required.keys()) {
    if (!seen.has(id)) issues.push({ id, reason: "missing" });
  }
  return issues;
}
