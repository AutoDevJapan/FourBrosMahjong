import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../documents/assets/ui-refresh/manifest.json";
import { verifyUiRefreshAssets } from "../../scripts/verify-ui-refresh-assets.mjs";

const ASSET_DIRECTORY = new URL(
  "../../documents/assets/ui-refresh/",
  import.meta.url,
);

function createFixture({
  symlinkManifest = false,
  symlinkOriginals = false,
} = {}) {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "ui-refresh-assets-"));
  const manifestPath = join(fixtureDirectory, "manifest.json");
  if (symlinkManifest) {
    symlinkSync(new URL("manifest.json", ASSET_DIRECTORY), manifestPath);
  } else {
    copyFileSync(new URL("manifest.json", ASSET_DIRECTORY), manifestPath);
  }

  const originalsPath = join(fixtureDirectory, "originals");
  if (symlinkOriginals) {
    symlinkSync(new URL("originals/", ASSET_DIRECTORY), originalsPath, "dir");
  } else {
    cpSync(new URL("originals/", ASSET_DIRECTORY), originalsPath, {
      recursive: true,
    });
  }

  return { fixtureDirectory, manifestPath, originalsPath };
}

function withFixture(
  callback: (fixture: ReturnType<typeof createFixture>) => void,
  options?: Parameters<typeof createFixture>[0],
) {
  const fixture = createFixture(options);
  try {
    callback(fixture);
  } finally {
    rmSync(fixture.fixtureDirectory, { force: true, recursive: true });
  }
}

const EXPECTED_ASSETS = [
  {
    id: "lobby",
    file: "originals/lobby.png",
    originalFilename: "四兄弟麻雀 ①ロビー（トップページ）.png",
    route: "/",
    width: 1200,
    height: 890,
    bytes: 1_082_111,
    sha256: "c269e446bdcd891b000268dd0b1f4527e01926a4e32b65afaa490efaa78e3410",
  },
  {
    id: "rules",
    file: "originals/rules.png",
    originalFilename: "四兄弟麻雀 ②ルール説明画面.png",
    route: "/rules",
    width: 924,
    height: 890,
    bytes: 496_238,
    sha256: "e92f8d69408948d307e4f55db688d8fdc0fed4ad264cb363036e3080da73d5c0",
  },
  {
    id: "settings",
    file: "originals/settings.png",
    originalFilename: "四兄弟麻雀 ③設定画面.png",
    route: "/settings",
    width: 920,
    height: 890,
    bytes: 392_235,
    sha256: "0ac5dfb6ba5e6fca5422b3a66e12649dea96335059ba2c60cdc3873e8d9b066b",
  },
  {
    id: "game",
    file: "originals/game.png",
    originalFilename: "四兄弟麻雀 ④対局画面（対局中）.png",
    route: "/game",
    width: 1384,
    height: 1110,
    bytes: 1_284_760,
    sha256: "2ad46fb73a2311fbb15e4cc44126be071c0830768da2691e5d307f8a702a489d",
  },
  {
    id: "result",
    file: "originals/result.png",
    originalFilename: "四兄弟麻雀 ⑤結果画面（半荘終了）.png",
    route: "/game/result",
    width: 740,
    height: 1110,
    bytes: 615_256,
    sha256: "c2189583de709ea7ee65fed3721ff09c25a108ebb563bb2e235a128d1165beba",
  },
  {
    id: "history",
    file: "originals/history.png",
    originalFilename: "四兄弟麻雀 ⑥戦績画面.png",
    route: "/history",
    width: 920,
    height: 1110,
    bytes: 551_176,
    sha256: "22c7708f9c4dfc218ef95e0c52a92ecf5abccba56dd0ab94247b89ae82d75f3d",
  },
] as const;

describe("Issue #712 design-reference originals", () => {
  it("keeps all six PNG files byte-identical to the manifest", () => {
    expect(verifyUiRefreshAssets()).toEqual({
      assetCount: 6,
      totalBytes: 4_421_776,
    });
  });

  it("pins the Issue #712 paths, dimensions, byte counts, and SHA-256 values", () => {
    expect(manifest.assets).toEqual(EXPECTED_ASSETS);
  });

  it("records the rights state without treating the request or hashes as permission", () => {
    expect(manifest.provenance).toMatchObject({
      inclusionRequestRecord: expect.any(String),
      legalRightsHolderVerified: false,
      providerAuthorityToLicenseVerified: false,
      redistributionPermissionVerifiedIndependently: false,
      requestIsRightsOrLicenseEvidence: false,
      sha256IsPermissionEvidence: false,
      publicDistributionRequiresWrittenRightsConfirmation: true,
      commercialUseRequiresWrittenRightsConfirmation: true,
      removeOriginalsAndDerivativesIfRightsRemainUnverified: true,
      rightsNotice: expect.any(String),
    });
    expect(manifest.provenance).not.toHaveProperty("useAndRedistributionBasis");
  });

  it("rejects a manifest symlink", () => {
    withFixture(
      ({ manifestPath }) => {
        expect(() => verifyUiRefreshAssets(manifestPath)).toThrow(
          "manifest must be a non-symlink regular file",
        );
      },
      { symlinkManifest: true },
    );
  });

  it("rejects an originals directory symlink", () => {
    withFixture(
      ({ manifestPath }) => {
        expect(() => verifyUiRefreshAssets(manifestPath)).toThrow(
          "originals/ must be a non-symlink directory",
        );
      },
      { symlinkOriginals: true },
    );
  });

  it("rejects files that are not registered in the manifest", () => {
    withFixture(({ manifestPath, originalsPath }) => {
      writeFileSync(join(originalsPath, "unregistered.png"), "not registered");
      expect(() => verifyUiRefreshAssets(manifestPath)).toThrow(
        "originals/ inventory must exactly match the regular files in the manifest",
      );
    });
  });

  it("rejects unregistered directories in originals", () => {
    withFixture(({ manifestPath, originalsPath }) => {
      mkdirSync(join(originalsPath, "unregistered"));
      expect(() => verifyUiRefreshAssets(manifestPath)).toThrow(
        "originals/ inventory must exactly match the regular files in the manifest",
      );
    });
  });

  it("rejects a missing registered asset", () => {
    withFixture(({ manifestPath, originalsPath }) => {
      unlinkSync(join(originalsPath, "lobby.png"));
      expect(() => verifyUiRefreshAssets(manifestPath)).toThrow(
        "originals/ inventory must exactly match the regular files in the manifest",
      );
    });
  });

  it("rejects an individual asset symlink", () => {
    withFixture(({ manifestPath, originalsPath }) => {
      const lobbyPath = join(originalsPath, "lobby.png");
      unlinkSync(lobbyPath);
      symlinkSync(new URL("originals/lobby.png", ASSET_DIRECTORY), lobbyPath);
      expect(() => verifyUiRefreshAssets(manifestPath)).toThrow(
        "originals/ inventory must exactly match the regular files in the manifest",
      );
    });
  });

  it("rejects a dangling asset symlink", () => {
    withFixture(({ manifestPath, originalsPath }) => {
      const lobbyPath = join(originalsPath, "lobby.png");
      unlinkSync(lobbyPath);
      symlinkSync(join(originalsPath, "missing.png"), lobbyPath);
      expect(() => verifyUiRefreshAssets(manifestPath)).toThrow(
        "originals/ inventory must exactly match the regular files in the manifest",
      );
    });
  });

  it.each([
    ["traversal", "originals/../manifest.json"],
    ["absolute", "/tmp/lobby.png"],
  ])("rejects an %s asset path", (_label, invalidPath) => {
    withFixture(({ manifestPath }) => {
      const tamperedManifest = structuredClone(manifest);
      tamperedManifest.assets[0].file = invalidPath;
      writeFileSync(manifestPath, JSON.stringify(tamperedManifest));
      expect(() => verifyUiRefreshAssets(manifestPath)).toThrow(
        "asset file is invalid or duplicated",
      );
    });
  });

  it("fails closed when the manifest parent path cannot be read", () => {
    withFixture(({ fixtureDirectory }) => {
      expect(() =>
        verifyUiRefreshAssets(
          join(fixtureDirectory, "missing", "manifest.json"),
        ),
      ).toThrow();
    });
  });

  it("fails closed when originals cannot be read", () => {
    withFixture(({ manifestPath, originalsPath }) => {
      rmSync(originalsPath, { recursive: true });
      expect(() => verifyUiRefreshAssets(manifestPath)).toThrow();
    });
  });
});
