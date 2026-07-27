import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

/** `mkdtemp` は macOS で `/var/…`(`/private/var/…` へのシンボリックリンク)を返す。 */
/* dependency-cruiser は依存の解決に realpath を使うため、`baseDir` 側も realpath に揃えないと */
/* 依存の相対パスが `../../…` になり `to.path` が当たらない。 */
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
];

/** ドメイン → プレゼンテーションの逆流を禁止するルール名。 */
const DOMAIN_RULE = "no-domain-to-presentation";
/** 共有コンポーネント → App Router の逆流を禁止するルール名。 */
const COMPONENTS_RULE = "no-components-to-app";
const LAYER_RULES: readonly string[] = [DOMAIN_RULE, COMPONENTS_RULE];

const require_ = createRequire(import.meta.url);
const depcruiseConfig = require_(
  resolve(process.cwd(), ".dependency-cruiser.cjs"),
) as IConfiguration;

let violations: IViolation[] = [];

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
      // リポジトリの `tsconfig.json` は一時ディレクトリに存在しないため外す
      // (フィクスチャは相対 import のみで、パスエイリアス解決を必要としない)。
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
        existsSync(resolve(process.cwd(), layer)),
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
});
