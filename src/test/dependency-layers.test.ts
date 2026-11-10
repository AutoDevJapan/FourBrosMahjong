import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cruise,
  type IConfiguration,
  type ICruiseResult,
  type IViolation,
} from "dependency-cruiser";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * `.dependency-cruiser.cjs` のレイヤー依存方向ルール(#382)を固定するメタテスト。
 *
 * `pnpm depcruise` 自体は「**今の** `src/` に違反が無いこと」しか主張しない。ルールを消しても、
 * `severity` を `warn` へ落としても、`path` 正規表現を実在しないフォルダ名へ書き換えても、
 * 違反ゼロのまま exit 0 で通ってしまう(#382 の実測: ルール追加前は逆流カナリアでも exit 0)。
 * ここではルール**そのもの**を対象にする。
 *
 * 判定は dependency-cruiser の `cruise()` を実際に呼んで行う(マッチャを自前で再実装すると
 * 「自分の再実装」を検査するだけになり、本物の挙動から乖離しても気づけない)。合成した
 * レイヤー構造を一時ディレクトリに書き出し、`baseDir` をそこへ向けることでモジュールパスを
 * `src/domain/...` 等に揃え、リポジトリの `forbidden` ルールをそのまま適用する。
 */

/**
 * `mkdtemp` は macOS で `/var/…`(`/private/var/…` へのシンボリックリンク)を返す。
 * dependency-cruiser は依存の解決に realpath を使うため、`baseDir` 側も realpath へ
 * 揃えないと依存の相対パスが `../../…` になり `to.path` が当たらない
 * (Linux CI では `/tmp` が実パスなので no-op)。
 */
function makeFixtureDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "depcruise-layers-")));
}

// 一時 fixture にのみ生成する資産。実 repo 入力の literal ではないため、
// #745 の入力 inventory に架空の evidence を登録しないよう部品から組み立てる。
const syntheticEvidence = posix.join("documents", "evidence", "runtime.json");

/**
 * 合成フィクスチャ。`[パス, 中身]` の形で、レイヤー境界の各ケースを 1 つずつ含む。
 * 依存は相対パスで書く(`@/` エイリアスは `tsConfig` に依存するが、一時ディレクトリには
 * リポジトリの `tsconfig.json` が無いため `cruise()` 呼び出しで `tsConfig` を外している)。
 */
const FIXTURE: readonly [path: string, source: string][] = [
  // exports-only packages have no legacy main/index.js fallback.
  [
    "node_modules/css-compiler/package.json",
    '{"name":"css-compiler","exports":{".":{"import":"./compiler.mjs","require":"./compiler.cjs"}}}\n',
  ],
  ["node_modules/css-compiler/compiler.mjs", "export const compile = 1;\n"],
  ["node_modules/css-compiler/compiler.cjs", "exports.compile = 1;\n"],
  [
    "src/app/exportsConsumer.ts",
    'import { compile } from "css-compiler";\nexport const value = compile;\n',
  ],
  // An exports-only SDK has no main/index.js fallback.
  [
    "node_modules/exported-sdk/package.json",
    '{"name":"exported-sdk","exports":{".":{"import":"./sdk.mjs","require":"./sdk.cjs"}}}\n',
  ],
  ["node_modules/exported-sdk/sdk.mjs", "export const value = 1;\n"],
  ["node_modules/exported-sdk/sdk.cjs", "exports.value = 1;\n"],
  [
    "src/app/sdkConsumer.ts",
    'import { value } from "exported-sdk";\nexport const current = value;\n',
  ],
  ["src/app/_lib/securityHeaders.ts", "export const csp = 1;\n"],
  ["src/components/common/Modal.ts", "export const Modal = 1;\n"],
  ["src/domain/tiles/tile.ts", "export const tile = 1;\n"],
  ["src/components/game/types.ts", "export type TileData = { id: number };\n"],
  // 逆流(すべて違反であるべき)
  [
    "src/domain/scoring/pao.ts",
    'import { Modal } from "../../components/common/Modal";\nexport const a = Modal;\n',
  ],
  [
    "src/domain/scoring/win-payment.ts",
    'import { csp } from "../../app/_lib/securityHeaders";\nexport const b = csp;\n',
  ],
  [
    "src/components/game/GameBoard.ts",
    'import { csp } from "../../app/_lib/securityHeaders";\nexport const c = csp;\n',
  ],
  // 型のみの import も逆流。`options.tsPreCompilationDeps` が false へ倒れると
  // トランスパイル後に消える型 import が依存グラフから外れ、この抜け道が開く。
  [
    "src/domain/round/seat.ts",
    'import type { TileData } from "../../components/game/types";\nexport type Seat = TileData;\n',
  ],
  // 正方向(違反であってはならない)
  [
    "src/app/game/page.ts",
    'import { tile } from "../../domain/tiles/tile";\nexport const d = tile;\n',
  ],
  [
    "src/components/game/gameView.ts",
    'import { tile } from "../../domain/tiles/tile";\nexport const e = tile;\n',
  ],
  [
    "src/domain/hand/win.ts",
    'import { tile } from "../tiles/tile";\nexport const f = tile;\n',
  ],
  // テストファイルの適用除外(違反であってはならない)
  [
    "src/domain/game/engine.ai-actions.test.ts",
    'import { Modal } from "../../components/common/Modal";\nexport const g = Modal;\n',
  ],
  [
    "src/domain/scoring/pao.spec.ts",
    'import { Modal } from "../../components/common/Modal";\nexport const h = Modal;\n',
  ],
  [
    "src/components/common/Modal.test.tsx",
    'import { csp } from "../../app/_lib/securityHeaders";\nexport const i = csp;\n',
  ],
  // `src/` 直下(proxy)は本ルールの対象外
  [
    "src/proxy.ts",
    'import { csp } from "./app/_lib/securityHeaders";\nexport const j = csp;\n',
  ],
  // 解決できない import。一時ディレクトリにはリポジトリの `tsconfig.json` が無いため
  // `@/` エイリアスは解決されず、`no-unresolvable-in-src` に当たるべき。
  [
    "src/domain/dora/dora.ts",
    'import { Modal } from "@/components/common/Modal";\nexport const k = Modal;\n',
  ],
  // 本番サーバーの依存グラフも同じ canary で固定する(#750)。
  [
    "server/onlineBridge.ts",
    'import { tile } from "../src/domain/tiles/tile";\nexport const onlineTile = tile;\n',
  ],
  [
    "server/presentationLeak.ts",
    'import { Modal } from "../src/components/common/Modal";\nexport const leakedModal = Modal;\n',
  ],
  [
    "server/appLeak.ts",
    'import { csp } from "../src/app/_lib/securityHeaders";\nexport const leakedCsp = csp;\n',
  ],
  [
    "server/unresolvable.ts",
    'import { missing } from "./missing";\nexport const missingValue = missing;\n',
  ],
  ["server/cycle-a.ts", 'import "./cycle-b";\nexport const cycleA = 1;\n'],
  ["server/cycle-b.ts", 'import "./cycle-a";\nexport const cycleB = 1;\n'],
  // CSS の明示除外先をクラス供給源に変える import は、除外の再検討なしに入れない。
  ["prototypes/runtime.ts", "export const value = 1;\n"],
  [syntheticEvidence, '{"value":1}\n'],
  ["documents/assets/ui-refresh/manifest.json", '{"value":1}\n'],
  ["documents/fixtures/railway-pre-cutover.json", '{"value":1}\n'],
  ["documents/fixtures/unity-display-contract.json", '{"value":1}\n'],
  [
    "src/app/nativeLeak.ts",
    'export { value } from "../../prototypes/runtime";\n',
  ],
  [
    "src/app/evidenceLeak.ts",
    // 固定コードだけを使い、値の埋め込みや JSON sanitizer を必要としない。
    // 分割は tmp-only パスを実入力 literal と区別するため。解決先は回帰で照合する。
    'export const load = () => import("../../documents' +
      '/evidence/runtime.json");\n',
  ],
  [
    "src/app/assetLeak.ts",
    'import manifest from "../../documents/assets/ui-refresh/manifest.json";\nexport const value = manifest.value;\n',
  ],
  [
    "src/app/railwayLeak.ts",
    'import fixture from "../../documents/fixtures/railway-pre-cutover.json";\nexport const value = fixture.value;\n',
  ],
  [
    "src/app/indirectLeak.ts",
    'export { value } from "../../scripts/runtimeBridge";\n',
  ],
  [
    "scripts/runtimeBridge.ts",
    'export { value } from "../prototypes/runtime";\n',
  ],
  [
    "src/app/unityConsumer.ts",
    'import fixture from "../../documents/fixtures/unity-display-contract.json";\nexport const value = fixture.value;\n',
  ],
  [
    "src/app/native.test.ts",
    'export { value } from "../../prototypes/runtime";\n',
  ],
  [
    "src/test/nativeConsumer.ts",
    'export { value } from "../../prototypes/runtime";\n',
  ],
];

/** 解決できない import の specifier(上記フィクスチャと対応)。 */
const UNRESOLVABLE_SPECIFIER = "@/components/common/Modal";

/** ドメイン → プレゼンテーションの逆流を禁止するルール名。 */
const DOMAIN_RULE = "no-domain-to-presentation";
/** 共有コンポーネント → App Router の逆流を禁止するルール名。 */
const COMPONENTS_RULE = "no-components-to-app";
/** 本番サーバー → プレゼンテーション層の依存を禁止するルール名。 */
const SERVER_PRESENTATION_RULE = "no-server-to-presentation";
/** 本番サーバーの未解決 import を禁止するルール名。 */
const SERVER_UNRESOLVABLE_RULE = "no-unresolvable-in-server";
/** サーバーを含む全グラフで循環依存を禁止するルール名。 */
const CIRCULAR_RULE = "no-circular";
const LAYER_RULES: readonly string[] = [DOMAIN_RULE, COMPONENTS_RULE];

/** 設定・レイヤーの実在確認は cwd ではなくこのテストファイルからの相対で解決する。 */
const require_ = createRequire(import.meta.url);
const repoPath = (relative: string) =>
  fileURLToPath(new URL(`../../${relative}`, import.meta.url));
const depcruiseConfig = require_(
  repoPath(".dependency-cruiser.cjs"),
) as IConfiguration;

let violations: IViolation[] = [];
let fixtureModules: ICruiseResult["modules"] = [];

// フィクスチャ書き出しと `cruise()` は `beforeAll` にまとめる(全テストで同一の
// 判定結果を共有するため)。`vitest.config.ts` の `testTimeout: 30_000` は hook には
// 効かず、hook は既定の 10,000ms のままだが、実測 100ms 未満なので十分な余裕がある。
beforeAll(async () => {
  const dir = makeFixtureDir();
  try {
    for (const [path, source] of FIXTURE) {
      const absolute = join(dir, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, source, "utf8");
    }
    const result = await cruise(["src", "server"], {
      ...depcruiseConfig.options,
      // リポジトリの `tsconfig.json` は一時ディレクトリに存在しないため外す。
      // レイヤーの各ケースは相対 import で書いてあり解決に影響しない。唯一の
      // `@/` import は「解決できない依存」のケースとして意図的に残している。
      tsConfig: undefined,
      baseDir: dir,
      ruleSet: { forbidden: depcruiseConfig.forbidden },
      validate: true,
    });
    violations = (result.output as ICruiseResult).summary.violations;
    fixtureModules = (result.output as ICruiseResult).modules;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 合成フィクスチャ上で `from → to` に当たったレイヤールールの違反(無ければ `undefined`)。 */
function layerViolation(from: string, to: string): IViolation | undefined {
  return violations.find(
    (violation) =>
      violation.from === from &&
      violation.to === to &&
      LAYER_RULES.includes(violation.rule.name),
  );
}

describe("レイヤー逆流を dependency-cruiser が error として検出する (#382)", () => {
  const FORBIDDEN_EDGES: readonly [
    label: string,
    from: string,
    to: string,
    rule: string,
  ][] = [
    [
      "ドメイン → 共有コンポーネント",
      "src/domain/scoring/pao.ts",
      "src/components/common/Modal.ts",
      DOMAIN_RULE,
    ],
    [
      "ドメイン → App Router",
      "src/domain/scoring/win-payment.ts",
      "src/app/_lib/securityHeaders.ts",
      DOMAIN_RULE,
    ],
    [
      "共有コンポーネント → App Router",
      "src/components/game/GameBoard.ts",
      "src/app/_lib/securityHeaders.ts",
      COMPONENTS_RULE,
    ],
    [
      "ドメイン → 共有コンポーネント(型のみの import)",
      "src/domain/round/seat.ts",
      "src/components/game/types.ts",
      DOMAIN_RULE,
    ],
  ];

  it.each(FORBIDDEN_EDGES)("%s", (_label, from, to, rule) => {
    const violation = layerViolation(from, to);
    expect(violation?.rule.name, `${from} → ${to} が検出されていない`).toBe(
      rule,
    );
    // dependency-cruiser の CLI 終了コードは error severity の違反件数のみを反映するため、
    // error 未満では違反が報告されても CI は落ちない = ルールが無いのと同じ。
    expect(
      violation?.rule.severity,
      `${rule}: severity が error でないと CI の終了コードに反映されない`,
    ).toBe("error");
  });
});

describe("許可された依存はレイヤールールに当たらない (#382)", () => {
  const ALLOWED_EDGES: readonly [label: string, from: string, to: string][] = [
    [
      "App Router → ドメイン",
      "src/app/game/page.ts",
      "src/domain/tiles/tile.ts",
    ],
    [
      "共有コンポーネント → ドメイン",
      "src/components/game/gameView.ts",
      "src/domain/tiles/tile.ts",
    ],
    ["ドメイン内の依存", "src/domain/hand/win.ts", "src/domain/tiles/tile.ts"],
    [
      "ドメインの .test.ts は UI 側フィクスチャを使ってよい",
      "src/domain/game/engine.ai-actions.test.ts",
      "src/components/common/Modal.ts",
    ],
    [
      "適用除外は .spec でも同じ",
      "src/domain/scoring/pao.spec.ts",
      "src/components/common/Modal.ts",
    ],
    [
      "コンポーネントの .test.tsx も適用除外",
      "src/components/common/Modal.test.tsx",
      "src/app/_lib/securityHeaders.ts",
    ],
    [
      "src/ 直下(proxy)は対象外",
      "src/proxy.ts",
      "src/app/_lib/securityHeaders.ts",
    ],
  ];

  it.each(ALLOWED_EDGES)("%s", (_label, from, to) => {
    expect(layerViolation(from, to)?.rule.name).toBeUndefined();
  });
});

describe("本番サーバーの依存境界を dependency-cruiser が検出する (#750)", () => {
  const FORBIDDEN_SERVER_EDGES: readonly [
    label: string,
    from: string,
    to: string,
  ][] = [
    [
      "サーバー → Reactコンポーネント",
      "server/presentationLeak.ts",
      "src/components/common/Modal.ts",
    ],
    [
      "サーバー → App Router",
      "server/appLeak.ts",
      "src/app/_lib/securityHeaders.ts",
    ],
  ];

  it.each(FORBIDDEN_SERVER_EDGES)("%s", (_label, from, to) => {
    const violation = violations.find(
      (candidate) =>
        candidate.from === from &&
        candidate.to === to &&
        candidate.rule.name === SERVER_PRESENTATION_RULE,
    );
    expect(violation, `${from} → ${to} が検出されていない`).toBeDefined();
    expect(violation?.rule.severity).toBe("error");
  });

  it("サーバー → domain は許可される", () => {
    expect(
      violations.find(
        (candidate) =>
          candidate.from === "server/onlineBridge.ts" &&
          candidate.to === "src/domain/tiles/tile.ts" &&
          candidate.rule.name === SERVER_PRESENTATION_RULE,
      ),
    ).toBeUndefined();
  });

  it("サーバーの未解決 import は error として報告される", () => {
    const violation = violations.find(
      (candidate) =>
        candidate.from === "server/unresolvable.ts" &&
        candidate.rule.name === SERVER_UNRESOLVABLE_RULE,
    );
    expect(violation, "サーバーの未解決 import が素通りしている").toBeDefined();
    expect(violation?.rule.severity).toBe("error");
  });

  it("サーバー内の循環依存は error として報告される", () => {
    const cycleFiles = new Set(["server/cycle-a.ts", "server/cycle-b.ts"]);
    const violation = violations.find(
      (candidate) =>
        candidate.rule.name === CIRCULAR_RULE &&
        cycleFiles.has(candidate.from) &&
        cycleFiles.has(candidate.to),
    );
    expect(violation, "server/ の循環依存が検出されていない").toBeDefined();
    expect(violation?.rule.severity).toBe("error");
  });
});

describe("CSS 除外先を runtime へ import する前に境界の再検討を求める (#1191)", () => {
  const rule = "no-runtime-to-css-excluded-inputs";
  it("生成した evidence import は一時 repo 内の資産へ動的 literal として解決される", () => {
    const dependency = fixtureModules
      .find((module) => module.source === "src/app/evidenceLeak.ts")
      ?.dependencies.find((entry) => entry.resolved === syntheticEvidence);
    expect(dependency).toMatchObject({
      couldNotResolve: false,
      dynamic: true,
      module: `../../${syntheticEvidence}`,
    });
  });
  it.each([
    ["src/app/nativeLeak.ts", "prototypes/runtime.ts"],
    ["src/app/evidenceLeak.ts", syntheticEvidence],
    ["src/app/assetLeak.ts", "documents/assets/ui-refresh/manifest.json"],
    ["src/app/railwayLeak.ts", "documents/fixtures/railway-pre-cutover.json"],
    ["scripts/runtimeBridge.ts", "prototypes/runtime.ts"],
  ])(
    "%s → %s は error（静的 import・re-export・動的 literal import・中継）",
    (from, to) => {
      expect(
        violations.find(
          (entry) =>
            entry.from === from && entry.to === to && entry.rule.name === rule,
        )?.rule.severity,
      ).toBe("error");
    },
  );
  it.each([
    "src/app/unityConsumer.ts",
    "src/app/native.test.ts",
    "src/test/nativeConsumer.ts",
  ])("%s の正当な runtime fixture / test consumer は許可", (from) => {
    expect(
      violations.filter(
        (entry) => entry.from === from && entry.rule.name === rule,
      ),
    ).toEqual([]);
  });
});

/**
 * 上の 2 つは合成パスを使うため、ルールの正規表現が**実在しない**フォルダを指すように
 * 書き換えられても(例: `^src/core/`)、フィクスチャ側を同じ名前にすれば緑のままになる。
 * 実レイアウトとの対応はここで別途固定する(#382 の見送り理由だった
 * 「存在しないフォルダへの path ルール = 検証不能な死んだ設定」への回帰防止)。
 */
describe("ルールが指すレイヤーが実リポジトリに存在する (#382/#750)", () => {
  it.each(["src/domain", "src/components", "src/app", "server"])(
    "%s が実在する",
    (layer) => {
      expect(
        existsSync(repoPath(layer)),
        `${layer} が無い: 実在しないフォルダへの path ルールは検証不能な死んだ設定になる`,
      ).toBe(true);
    },
  );

  it("レイヤールールの from/to が実レイアウトのパスを指している", () => {
    const source = JSON.stringify(depcruiseConfig.forbidden);
    for (const layer of [
      "src/domain/",
      "src/app/",
      "src/components/",
      "server/",
    ]) {
      expect(source, `レイヤールールが ${layer} に言及していない`).toContain(
        layer,
      );
    }
  });

  /**
   * レイヤールールは `src/` 直下のモジュールを対象にしていない(`src/proxy.ts` は
   * Next.js の middleware エントリで、`src/app/_lib` の CSP ヘルパを使うのが正当なため)。
   * ここに共有モジュールが増えると、`src/domain` → `src/shared` → `src/app` のような
   * 迂回路でレイヤールールを回避できてしまう。実測でこの経路が違反にならないことは
   * 確認済みなので、「`src/` 直下は middleware と型宣言のみ」を不変条件として固定する。
   */
  it("src/ 直下は middleware エントリと型宣言のみ(層ルールの迂回路を作らない)", () => {
    const topLevel = readdirSync(repoPath("src"), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    expect(
      topLevel,
      "src/ 直下に共有モジュールを置くとレイヤールールの迂回路になる。src/domain・src/components・src/app のいずれかへ配置すること",
    ).toEqual(["global.d.ts", "proxy.ts"]);
  });
});

/**
 * レイヤールールは「解決できた依存」にしか当たらない。`src/` は `@/*` エイリアスを
 * 多用しており、その解決は `options.tsConfig` に依存する。この設定が外れると `src/` の
 * import が大量に unresolvable になり、**レイヤールールは何にも当たらないまま exit 0** に
 * なる(実測: ドメイン→UI のカナリアを置いても `tsConfig` 無しでは exit 0)。
 * `no-unresolvable-in-src` がその失敗モードを error として顕在化させる。
 */
describe("レイヤールールが機能する前提条件 (#382)", () => {
  it("exports-only パッケージを実際に解決し、未解決 import の例外を作らない (#1191)", () => {
    const dependency = fixtureModules
      .find((module) => module.source === "src/app/exportsConsumer.ts")
      ?.dependencies.find((entry) => entry.module === "css-compiler");
    expect(dependency?.couldNotResolve).toBe(false);
    expect(dependency?.resolved).toBe("node_modules/css-compiler/compiler.mjs");
  });
  it("解決できない import が error として報告される", () => {
    const violation = violations.find(
      (candidate) =>
        candidate.from === "src/domain/dora/dora.ts" &&
        candidate.to === UNRESOLVABLE_SPECIFIER,
    );
    expect(
      violation?.rule.name,
      "解決できない import が素通りすると、パスベースのルールが全て無効化されても気づけない",
    ).toBe("no-unresolvable-in-src");
    expect(violation?.rule.severity).toBe("error");
  });

  it("@/ エイリアスを解決するための tsConfig が設定されている", () => {
    expect(
      depcruiseConfig.options?.tsConfig?.fileName,
      "options.tsConfig が無いと src/ の @/ import が全て unresolvable になる",
    ).toBe("tsconfig.json");
    expect(existsSync(repoPath("tsconfig.json"))).toBe(true);
  });

  it("型のみの import を依存として数える tsPreCompilationDeps が有効", () => {
    expect(
      depcruiseConfig.options?.tsPreCompilationDeps,
      "false にすると型のみの逆流 import が依存グラフから消え、抜け道になる",
    ).toBe(true);
  });
});

/**
 * ルールが正しくても、CI がそれを走らせる範囲が狭ければ意味がない
 * (`depcruise src/app` に縮めても、server/ を外しても、CI からステップを消しても、上のテストは全て緑のまま)。
 * 適用スコープもここで固定する。
 */
describe("レイヤールールの適用スコープ (#382)", () => {
  it("pnpm depcruise が src と server 全体を対象にしている", () => {
    const packageJson = JSON.parse(
      readFileSync(repoPath("package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.depcruise).toBe("depcruise src server");
  });

  it("CI が pnpm depcruise を実行している", () => {
    const workflow = readFileSync(repoPath(".github/workflows/ci.yml"), "utf8");
    expect(
      workflow,
      "CI から depcruise ステップが消えるとレイヤー境界は強制されない",
    ).toContain("pnpm depcruise");
  });
});

describe("exports-only SDK module resolution", () => {
  it("resolves a real package export while preserving unresolved-import errors", () => {
    const dependency = fixtureModules
      .find((module) => module.source === "src/app/sdkConsumer.ts")
      ?.dependencies.find((entry) => entry.module === "exported-sdk");
    expect(dependency?.couldNotResolve).toBe(false);
    expect(dependency?.resolved).toBe("node_modules/exported-sdk/sdk.mjs");
  });
});
