import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `.dependency-cruiser.cjs` のレイヤー依存方向ルール(#382)を固定するメタテスト。
 *
 * `pnpm depcruise` 自体は「**今の** src に違反が無いこと」しか主張しない。ルールを消しても、
 * `severity` を `warn` へ落としても、`path` 正規表現を実在しないフォルダ名へ書き換えても、
 * 違反ゼロのまま exit 0 で通ってしまう(#382 の実測: ルール追加前は逆流カナリアでも exit 0)。
 * ここではルール**そのもの**を対象に、以下を固定する:
 *
 * 1. レイヤールールが `forbidden` に存在し、`severity` が `error` であること
 *    (dependency-cruiser の CLI 終了コードは error 件数のみを反映するため、
 *    `warn` は CI を落とさない = ルールが無いのと同じ)。
 * 2. `from`/`to` の正規表現が、実際のモジュールパスに対して意図どおりに当たること
 *    (逆流は違反、正方向とテストファイルの適用除外は非違反)。
 * 3. ルールが指すレイヤーのディレクトリが実在すること(#382 の見送り理由だった
 *    「存在しないフォルダへの path ルール = テスト不能な死んだ設定」への回帰防止)。
 */

type ForbiddenRule = {
  name: string;
  severity: string;
  from: { path?: string; pathNot?: string; orphan?: boolean };
  to: { path?: string; circular?: boolean };
};

const require_ = createRequire(import.meta.url);
const CONFIG_PATH = resolve(process.cwd(), ".dependency-cruiser.cjs");
const config = require_(CONFIG_PATH) as { forbidden: ForbiddenRule[] };

/** ドメイン → プレゼンテーションの逆流を禁止するルール名。 */
const DOMAIN_RULE = "no-domain-to-presentation";
/** 共有コンポーネント → App Router の逆流を禁止するルール名。 */
const COMPONENTS_RULE = "no-components-to-app";
const LAYER_RULES = [DOMAIN_RULE, COMPONENTS_RULE] as const;

function ruleNamed(name: string): ForbiddenRule {
  const rule = config.forbidden.find((candidate) => candidate.name === name);
  if (rule === undefined)
    throw new Error(
      `.dependency-cruiser.cjs に forbidden ルール "${name}" が無い(レイヤー境界が未強制)`,
    );
  return rule;
}

/**
 * dependency-cruiser が `from`/`to` の `path` / `pathNot` に対して行う判定
 * (正規表現をモジュールパスへ部分一致)を、本テストで使う属性についてだけ再現する。
 */
function matchesPathSpec(
  spec: { path?: string; pathNot?: string },
  modulePath: string,
): boolean {
  if (spec.path !== undefined && !new RegExp(spec.path).test(modulePath))
    return false;
  if (spec.pathNot !== undefined && new RegExp(spec.pathNot).test(modulePath))
    return false;
  return true;
}

/** 依存辺 `from → to` に違反するレイヤールール名(無ければ `undefined`)。 */
function violatedRule(from: string, to: string): string | undefined {
  return LAYER_RULES.find((name) => {
    const rule = ruleNamed(name);
    return matchesPathSpec(rule.from, from) && matchesPathSpec(rule.to, to);
  });
}

describe("dependency-cruiser のレイヤールール定義 (#382)", () => {
  it.each(LAYER_RULES)("%s が error severity で定義されている", (name) => {
    expect(
      ruleNamed(name).severity,
      `${name}: dependency-cruiser の exit code は error 件数のみを反映するため、error 未満では CI が落ちない`,
    ).toBe("error");
  });

  it.each(["src/domain", "src/components", "src/app"])(
    "ルールが指すレイヤー %s が実在する",
    (layer) => {
      expect(
        existsSync(resolve(process.cwd(), layer)),
        `${layer} が無い: 実在しないフォルダへの path ルールは検証不能な死んだ設定になる`,
      ).toBe(true);
    },
  );
});

/**
 * `[説明, from, to, 違反するルール名 or undefined]`。
 * 逆流(禁止)・正方向(許可)・テストファイルの適用除外を 1 表で固定する。
 */
const EDGES: readonly [string, string, string, string | undefined][] = [
  [
    "ドメイン → 共有コンポーネントは逆流",
    "src/domain/scoring/pao.ts",
    "src/components/common/Modal.tsx",
    DOMAIN_RULE,
  ],
  [
    "ドメイン → App Router も逆流",
    "src/domain/scoring/win-payment.ts",
    "src/app/_lib/securityHeaders.ts",
    DOMAIN_RULE,
  ],
  [
    "共有コンポーネント → App Router は逆流",
    "src/components/game/GameBoard.tsx",
    "src/app/_lib/securityHeaders.ts",
    COMPONENTS_RULE,
  ],
  [
    "App Router → ドメインは正方向",
    "src/app/game/page.tsx",
    "src/domain/game/engine.ts",
    undefined,
  ],
  [
    "App Router → 共有コンポーネントは正方向",
    "src/app/game/page.tsx",
    "src/components/game/GameBoard.tsx",
    undefined,
  ],
  [
    "共有コンポーネント → ドメインは正方向",
    "src/components/game/gameView.ts",
    "src/domain/round/round.ts",
    undefined,
  ],
  [
    "ドメイン内の依存は対象外",
    "src/domain/hand/win.ts",
    "src/domain/tiles/tile.ts",
    undefined,
  ],
  // 以下 2 件は実在する辺(テストファイルの適用除外がここに効いている)。
  [
    "ドメインの .test.ts は UI 側フィクスチャを使ってよい",
    "src/domain/game/engine.ai-actions.test.ts",
    "src/components/game/gameView.ts",
    undefined,
  ],
  [
    "ドメインの .test.ts はテスト専用フィクスチャを使ってよい",
    "src/domain/game/ai.memo-stability.test.ts",
    "src/components/game/finishedGameFixture.ts",
    undefined,
  ],
  [
    "コンポーネントの .test.tsx も適用除外",
    "src/components/common/Modal.test.tsx",
    "src/app/_lib/securityHeaders.ts",
    undefined,
  ],
  [
    "適用除外は .spec も同様",
    "src/domain/scoring/pao.spec.ts",
    "src/components/common/Modal.tsx",
    undefined,
  ],
  [
    "src 直下(proxy)は本ルールの対象外",
    "src/proxy.ts",
    "src/app/_lib/securityHeaders.ts",
    undefined,
  ],
];

describe("レイヤールールの from/to 正規表現 (#382)", () => {
  it.each(EDGES)("%s", (_label, from, to, expected) => {
    expect(violatedRule(from, to)).toBe(expected);
  });
});
