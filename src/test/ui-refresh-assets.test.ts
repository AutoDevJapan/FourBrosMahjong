import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../documents/assets/ui-refresh/manifest.json";
import {
  verifyUiRefreshAssets,
  verifyUiRefreshProvenance,
} from "../../scripts/verify-ui-refresh-assets.mjs";

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

function rewriteManifestAsset(
  manifestPath: string,
  id: string,
  contents: Buffer,
  dimensions?: { width: number; height: number },
) {
  const tamperedManifest = structuredClone(manifest);
  const asset = tamperedManifest.assets.find((entry) => entry.id === id);
  if (asset === undefined) throw new Error(`missing fixture asset: ${id}`);
  asset.bytes = contents.length;
  asset.sha256 = createHash("sha256").update(contents).digest("hex");
  if (dimensions !== undefined) {
    asset.width = dimensions.width;
    asset.height = dimensions.height;
  }
  writeFileSync(manifestPath, JSON.stringify(tamperedManifest));
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

  it("records the provider's public redistribution permission without claiming independently verified rights", () => {
    expect(manifest.provenance).toMatchObject({
      inclusionRequestRecord: expect.any(String),
      legalRightsHolderVerified: false,
      providerAuthorityToLicenseVerified: false,
      redistributionPermissionVerifiedIndependently: false,
      requestIsRightsOrLicenseEvidence: false,
      sha256IsPermissionEvidence: false,
      providerPermission: {
        grantedBy: "Project provider",
        grantedOn: "2026-11-07",
        scope: "six UI design-reference images and their derived images",
        publicDistribution: true,
        redistribution: true,
        commercialUse: "not-recorded",
        evidence:
          "https://github.com/AutoDevJapan/FourBrosMahjong/issues/1175#issuecomment-6701099933",
        terms: "CREDITS.md#提供元・公開条件",
        coversCodeMitLicense: false,
        transfersRights: false,
        impliesOfficialEndorsement: false,
      },
      rightsNotice: expect.any(String),
      license: "Provider permission for public distribution and redistribution",
    });
    for (const superseded of [
      "publicDistributionRequiresWrittenRightsConfirmation",
      "commercialUseRequiresWrittenRightsConfirmation",
      "removeOriginalsAndDerivativesIfRightsRemainUnverified",
    ]) {
      expect(manifest.provenance).not.toHaveProperty(superseded);
    }
  });

  it("accepts the documented provider permission and keeps the public terms aligned", () => {
    expect(() => verifyUiRefreshProvenance(manifest.provenance)).not.toThrow();
    const credits = readFileSync(
      new URL("CREDITS.md", ASSET_DIRECTORY),
      "utf8",
    );
    expect(credits).toContain("2026-11-07");
    expect(credits).toContain("この6点と派生画像の一般公開・再配布を許可");
    expect(credits).toContain("自作コードのMIT Licenseとは別");
    expect(credits).toContain("公認や権利の譲渡を意味しません");
  });

  it("rejects the old unconfirmed record when the provider permission is absent", () => {
    const provenance: Record<string, unknown> = structuredClone(
      manifest.provenance,
    );
    delete provenance.providerPermission;
    expect(() => verifyUiRefreshProvenance(provenance)).toThrow(
      "provenance.providerPermission is missing",
    );
  });

  it.each([
    "legalRightsHolderVerified",
    "providerAuthorityToLicenseVerified",
    "redistributionPermissionVerifiedIndependently",
    "requestIsRightsOrLicenseEvidence",
    "sha256IsPermissionEvidence",
  ])("does not upgrade %s into independent rights verification", (field) => {
    const provenance = { ...manifest.provenance, [field]: true };
    expect(() => verifyUiRefreshProvenance(provenance)).toThrow(
      `provenance.${field} must explicitly be false`,
    );
  });

  it.each([
    ["grantedBy", "Unknown"],
    ["grantedOn", "2026-11-08"],
    ["scope", "all future assets"],
    ["publicDistribution", false],
    ["redistribution", false],
    ["commercialUse", true],
    ["evidence", ""],
    ["terms", ""],
    ["coversCodeMitLicense", true],
    ["transfersRights", true],
    ["impliesOfficialEndorsement", true],
  ])("rejects an inconsistent provider permission %s", (field, value) => {
    const provenance = {
      ...manifest.provenance,
      providerPermission: {
        ...manifest.provenance.providerPermission,
        [field]: value,
      },
    };
    expect(() => verifyUiRefreshProvenance(provenance)).toThrow(
      `provenance.providerPermission.${field} is inconsistent`,
    );
  });

  it.each([
    "publicDistributionRequiresWrittenRightsConfirmation",
    "commercialUseRequiresWrittenRightsConfirmation",
    "removeOriginalsAndDerivativesIfRightsRemainUnverified",
  ])("rejects the superseded release condition %s", (field) => {
    expect(() =>
      verifyUiRefreshProvenance({ ...manifest.provenance, [field]: true }),
    ).toThrow(`provenance.${field} is superseded by provider permission`);
  });

  it("rejects a prose notice that expands the recorded permission", () => {
    expect(() =>
      verifyUiRefreshProvenance({
        ...manifest.provenance,
        rightsNotice:
          "Commercial use, rights transfer and endorsement are confirmed.",
      }),
    ).toThrow(
      "provenance.rightsNotice must match the recorded permission scope",
    );
  });

  it("rejects unknown permission fields without inferring additional grants", () => {
    expect(() =>
      verifyUiRefreshProvenance({
        ...manifest.provenance,
        providerPermission: {
          ...manifest.provenance.providerPermission,
          allFutureAssets: true,
        },
      }),
    ).toThrow("provenance.providerPermission contains unknown fields");
  });

  it("rejects an unknown top-level provenance grant", () => {
    expect(() =>
      verifyUiRefreshProvenance({
        ...manifest.provenance,
        commercialUse: "permitted",
      }),
    ).toThrow("provenance contains unknown fields");
  });

  it.each(["providedBy", "sourceAtIngest", "inclusionRequestRecord"])(
    "rejects rewritten provenance evidence in %s",
    (field) => {
      expect(() =>
        verifyUiRefreshProvenance({
          ...manifest.provenance,
          [field]:
            "The provider confirmed commercial rights for all future assets.",
        }),
      ).toThrow(`provenance.${field} must match the recorded evidence`);
    },
  );

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

  it("rejects a truncated PNG even when its manifest metadata is updated", () => {
    withFixture(({ manifestPath, originalsPath }) => {
      const truncated = Buffer.alloc(24);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(truncated);
      truncated.writeUInt32BE(13, 8);
      truncated.write("IHDR", 12, "ascii");
      truncated.writeUInt32BE(1, 16);
      truncated.writeUInt32BE(1, 20);
      writeFileSync(join(originalsPath, "lobby.png"), truncated);
      rewriteManifestAsset(manifestPath, "lobby", truncated, {
        width: 1,
        height: 1,
      });

      expect(() => verifyUiRefreshAssets(manifestPath)).toThrow(
        "asset is not a structurally valid PNG",
      );
    });
  });

  it("rejects a manifest-matched asset without a terminal IEND chunk", () => {
    withFixture(({ manifestPath, originalsPath }) => {
      const original = readFileSync(join(originalsPath, "lobby.png"));
      const truncated = original.subarray(0, original.length - 12);
      writeFileSync(join(originalsPath, "lobby.png"), truncated);
      rewriteManifestAsset(manifestPath, "lobby", truncated);

      expect(() => verifyUiRefreshAssets(manifestPath)).toThrow(
        "asset is not a structurally valid PNG",
      );
    });
  });

  it("rejects a manifest-matched asset with a corrupt PNG chunk CRC", () => {
    withFixture(({ manifestPath, originalsPath }) => {
      const corrupted = readFileSync(join(originalsPath, "lobby.png"));
      corrupted[corrupted.length - 1] ^= 0xff;
      writeFileSync(join(originalsPath, "lobby.png"), corrupted);
      rewriteManifestAsset(manifestPath, "lobby", corrupted);

      expect(() => verifyUiRefreshAssets(manifestPath)).toThrow(
        "asset is not a structurally valid PNG",
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
