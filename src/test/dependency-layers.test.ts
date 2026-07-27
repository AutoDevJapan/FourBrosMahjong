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
import { dirname, join } from "node:path";
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

/**
 * 合成フィクスチャ。`[パス, 中身]` の形で、レイヤー境界の各ケースを 1 つずつ含む。
 * 依存は相対パスで書く(`@/` エイリアスは `tsConfig` に依存するが、一時ディレクトリには
 * リポジトリの `tsconfig.json` が無いため `cruise()` 呼び出しで `tsConfig` を外している)。
 */
const FIXTURE: readonly [path: string, source: string][] = [
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
];

/** 解決できない import の specifier(上記フィクスチャと対応)。 */
const UNRESOLVABLE_SPECIFIER = "@/components/common/Modal";

/** ドメイン → プレゼンテーションの逆流を禁止するルール名。 */
const DOMAIN_RULE = "no-domain-to-presentation";
/** 共有コンポーネント → App Router の逆流を禁止するルール名。 */
const COMPONENTS_RULE = "no-components-to-app";
const LAYER_RULES: readonly string[] = [DOMAIN_RULE, COMPONENTS_RULE];

/** 設定・レイヤーの実在確認は cwd ではなくこのテストファイルからの相対で解決する。 */
const require_ = createRequire(import.meta.url);
const repoPath = (relative: string) =>
  fileURLToPath(new URL(`../../${relative}`, import.meta.url));
const depcruiseConfig = require_(
  repoPath(".dependency-cruiser.cjs"),
) as IConfiguration;

let violations: IViolation[] = [];

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
    const result = await cruise(["src"], {
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

/**
 * 上の 2 つは合成パスを使うため、ルールの正規表現が**実在しない**フォルダを指すように
 * 書き換えられても(例: `^src/core/`)、フィクスチャ側を同じ名前にすれば緑のままになる。
 * 実レイアウトとの対応はここで別途固定する(#382 の見送り理由だった
 * 「存在しないフォルダへの path ルール = 検証不能な死んだ設定」への回帰防止)。
 */
describe("ルールが指すレイヤーが実リポジトリに存在する (#382)", () => {
  it.each(["src/domain", "src/components", "src/app"])(
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
    for (const layer of ["src/domain/", "src/app/", "src/components/"]) {
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
 * (`depcruise src/app` に縮めても、CI からステップを消しても、上のテストは全て緑のまま)。
 * 適用スコープもここで固定する。
 */
describe("レイヤールールの適用スコープ (#382)", () => {
  it("pnpm depcruise が src 全体を対象にしている", () => {
    const packageJson = JSON.parse(
      readFileSync(repoPath("package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.depcruise).toBe("depcruise src");
  });

  it("CI が pnpm depcruise を実行している", () => {
    const workflow = readFileSync(repoPath(".github/workflows/ci.yml"), "utf8");
    expect(
      workflow,
      "CI から depcruise ステップが消えるとレイヤー境界は強制されない",
    ).toContain("pnpm depcruise");
  });
});
