/**
 * #818: Unity表示プロトタイプのC#表示コアと、Web側の実装・表示契約fixtureの整合を固定する。
 *
 * `prototypes/unity-display/Tests/DisplayContractChecks.csproj` の2000件超のassertionは
 * .NET SDKがある環境でしか実行できず、CI(`.github/workflows/ci.yml`)にも`dotnet`は無い。
 * つまりC#側の`EffectKinds`/`TransitionKinds`とfixture・Web実装は**無検査で乖離しうる**。
 *
 * ここではC#を実行せずに、C#ソースが宣言している集合そのものをテキストとして読み取り、
 * 表示契約fixtureおよびWeb側の実装(`gameEffect.ts` / `HandTileAnimation.tsx`)と突き合わせる。
 * Unity Editorも.NET SDKも不要で、`pnpm test`(=CIのqualityゲート)に載る唯一の整合検査である。
 *
 * このテストはC#のコンパイル・実行・Unity API・描画を検証するものではない。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import contract from "../../documents/fixtures/unity-display-contract.json";

const ROOT = process.cwd();

const CSHARP_DISPLAY_CONTRACT = join(
  ROOT,
  "prototypes/unity-display/Assets/Scripts/DisplayContract.cs",
);
const WEB_GAME_EFFECT = join(ROOT, "src/components/game/effects/gameEffect.ts");
const WEB_HAND_ANIMATION = join(
  ROOT,
  "src/components/game/hand-animation/HandTileAnimation.tsx",
);

function readRepositoryFile(absolutePath: string): string {
  return readFileSync(absolutePath, "utf8");
}

/** `public static readonly string[] Name = { "a", "b" };` の要素を読み取る。 */
function csharpStringArray(source: string, name: string): string[] {
  const declaration = new RegExp(
    `readonly string\\[\\]\\s+${name}\\s*=\\s*\\{([^}]*)\\}`,
  ).exec(source);
  if (declaration === null || declaration[1] === undefined) {
    throw new Error(`C#の ${name} 宣言が見つからない`);
  }
  return [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => {
    const value = match[1];
    if (value === undefined) throw new Error(`${name} の要素を読めない`);
    return value;
  });
}

/** `type GameEffectKind = | "a" | "b";` のユニオン要素を読み取る。 */
function typeScriptUnionMembers(source: string, name: string): string[] {
  const declaration = new RegExp(`type\\s+${name}\\s*=([^;]*);`).exec(source);
  if (declaration === null || declaration[1] === undefined) {
    throw new Error(`TypeScriptの ${name} 宣言が見つからない`);
  }
  return [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => {
    const value = match[1];
    if (value === undefined) throw new Error(`${name} の要素を読めない`);
    return value;
  });
}

function numericConstant(source: string, name: string): number {
  const declaration = new RegExp(`${name}\\s*=\\s*([\\d_]+)`).exec(source);
  if (declaration === null || declaration[1] === undefined) {
    throw new Error(`定数 ${name} が見つからない`);
  }
  return Number(declaration[1].replaceAll("_", ""));
}

interface MajorEffectAssertions {
  readonly kinds: readonly string[];
  readonly unityOnlyKinds: readonly string[];
}

function majorEffectAssertions(): MajorEffectAssertions {
  const visualCase = contract.visualCases.find(
    (item) => item.id === "major-effects",
  );
  if (visualCase === undefined) throw new Error("major-effects fixtureが無い");
  const assertions = visualCase.assertions as {
    kinds?: readonly string[];
    unityOnlyKinds?: readonly string[];
  };
  if (assertions.kinds === undefined) throw new Error("kindsが無い");
  if (assertions.unityOnlyKinds === undefined) {
    throw new Error(
      "unityOnlyKindsが無い: Web側に対応演出が無い演出(北抜き等)を契約が明示していない",
    );
  }
  return { kinds: assertions.kinds, unityOnlyKinds: assertions.unityOnlyKinds };
}

function handTransitionKinds(): readonly string[] {
  const visualCase = contract.visualCases.find(
    (item) => item.id === "hand-deal-draw-replacement-meld",
  );
  if (visualCase === undefined) throw new Error("hand fixtureが無い");
  const kinds = (visualCase.assertions as { transitionKinds?: string[] })
    .transitionKinds;
  if (kinds === undefined) throw new Error("transitionKindsが無い");
  return kinds;
}

describe("Unity表示コア(C#)と表示契約・Web実装の整合", () => {
  it("C#のEffectKindsは、契約のWeb演出とUnity専用演出の和集合と一致する", () => {
    const csharp = csharpStringArray(
      readRepositoryFile(CSHARP_DISPLAY_CONTRACT),
      "EffectKinds",
    );
    const { kinds, unityOnlyKinds } = majorEffectAssertions();

    // 契約に無い演出をC#が勝手に持つ／契約が要求する演出をC#が落とす、の双方を検出する。
    expect([...csharp].sort()).toEqual(
      [...kinds, ...unityOnlyKinds].sort((a, b) => a.localeCompare(b)),
    );
    expect(new Set(csharp).size).toBe(csharp.length);
  });

  it("C#のTransitionKindsは契約の手牌遷移と一致する", () => {
    const csharp = csharpStringArray(
      readRepositoryFile(CSHARP_DISPLAY_CONTRACT),
      "TransitionKinds",
    );
    expect(csharp).toEqual([...handTransitionKinds()]);
  });

  it("契約のWeb演出はWeb実装のGameEffectKindと完全に一致する", () => {
    const web = typeScriptUnionMembers(
      readRepositoryFile(WEB_GAME_EFFECT),
      "GameEffectKind",
    );
    const { kinds } = majorEffectAssertions();
    expect([...kinds]).toEqual(web);
  });

  it("Unity専用演出はWeb実装に対応が無い(=Unity側で新規実装が要る)ことを固定する", () => {
    const web = new Set(
      typeScriptUnionMembers(
        readRepositoryFile(WEB_GAME_EFFECT),
        "GameEffectKind",
      ),
    );
    const { unityOnlyKinds } = majorEffectAssertions();

    // 北抜き(ガリ)は#818の受け入れ条件が挙げる演出だが、Web側には演出実装が無い。
    // Webへ実装された時点でこのテストが落ち、契約側の分類更新を強制する。
    expect([...unityOnlyKinds]).toContain("kita");
    for (const kind of unityOnlyKinds) {
      expect(web.has(kind)).toBe(false);
    }
  });

  it("契約のツモ入場時間はWebの手牌アニメーション定数と一致する", () => {
    const durationMs = numericConstant(
      readRepositoryFile(WEB_HAND_ANIMATION),
      "HAND_ANIMATION_DURATION_MS",
    );
    const visualCase = contract.visualCases.find(
      (item) => item.id === "hand-deal-draw-replacement-meld",
    );
    if (visualCase === undefined) throw new Error("hand fixtureが無い");
    expect(
      (visualCase.assertions as { drawEntranceDurationMs?: number })
        .drawEntranceDurationMs,
    ).toBe(durationMs);
  });
});
