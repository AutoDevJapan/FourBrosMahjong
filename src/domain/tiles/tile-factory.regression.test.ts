import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 牌ファクトリの単一起点を守る回帰テスト(issue #375)。
 *
 * 背景: 「オール赤5(5筒・5索は常に赤)」はルール SSOT
 * (`docs/四兄弟麻雀ルール.md` / スペック1 1.2・スペック4 4.4)由来の**牌の不変条件**だが、
 * `suit`/`rank` から `Tile` を組み立てる処理が独立に 6 か所へ実装されていた。
 * どれか1か所だけを直すと静かに不整合が生まれるため、`createTile`(`tiles/tile.ts`)へ集約した。
 *
 * 本テストは「また別の場所で組み立て直す」退行を検出する。共通の除外方針:
 * - テストファイルは不変条件を**独立に検証する**側なので対象外
 *   (`createTile` を使って期待値を作ると検証が恒真になる)。
 * - `__oracle__/` は「本番へ依存しない独立オラクル」が検証価値の源泉のため対象外
 *   (意図的重複の理由は `__oracle__/generator.ts` の JSDoc に明記)。
 */

// `new URL(...).pathname` はパーセントエンコーディングを解かないため、リポジトリパスに
// 空白や非 ASCII を含むと壊れる。`vitest.config.ts` と同じく fileURLToPath を使う。
const SRC = fileURLToPath(new URL("../..", import.meta.url));

/** 不変条件を持ってよい唯一の本番ファイル(`SRC` からの相対パス)。 */
const FACTORY = "domain/tiles/tile.ts";

/**
 * `Tile` 組み立ての走査対象。ドメイン本番コードのみ(issue #375 の完了条件と一致)。
 *
 * 表示層を含めないのは、ビューモデル `TileData` が `isRed` 任意の**投影**であって
 * `Tile` そのものではないため。例えば `components/game/gameView.ts` の
 * `{ suit, rank, isRed: tile.isRed }` は `Tile` → `TileData` の正当な写像で、
 * 表示層まで走査すると確実に偽陽性になる。ドメインへ戻す唯一の境界
 * (同ファイルの `toTile()`)は `createTile` を使っており、穴は空いていない。
 */
const TILE_LITERAL_ROOTS = ["domain"] as const;

/**
 * 赤5判定の走査対象。**表示層まで含める**(issue #485)。
 *
 * `components/common/tileImage.ts` が独自の赤5判定(`rank === 5 && (pin|sou)`)を
 * 持っていたため、同じ入力が「画面では非赤・得点では赤1翻」に割れていた。
 * ドメイン限定の走査ではこの重複を検出できなかったので、判定の再実装は
 * 表示層(`components` / `app`)でも退行として扱う。
 *
 * {@link TILE_LITERAL_ROOTS} の**上位集合**であること(= ドメインを必ず含むこと)は
 * 下のガードで固定する。表示層を足したつもりでドメインを落とすと、issue #375 が
 * 直した元の退行がまるごと素通りするため。
 */
const RED_FIVE_ROOTS = ["domain", "components", "app"] as const;

/**
 * `Tile` のオブジェクトリテラル生成を検出する。`Tile` は `isRed` が必須なので、
 * `isRed` を書いている箇所は牌そのものを組み立てている(牌種 `{ suit, rank }` は該当しない)。
 *
 * 後続文字を `[:,}]` にしているのは、`{ suit, rank, isRed }` という shorthand を
 * 取りこぼさないため(`isRed:` だけを見ていると、判定を別の変数に切り出してから
 * shorthand で詰める書き方ですり抜けられる)。
 *
 * `g` フラグ付き正規表現を定数で共有すると、`matchAll` は `lastIndex` を書き換えない
 * ものの**読み取りはする**ため、将来誰かが同じ定数へ `.test()` / `.exec()` を使うと
 * 以降の検出が静かに取りこぼす。毎回新しいインスタンスを返す関数にして事故を排除する。
 */
const tileLiteral = () => /\bisRed\s*[:,}]/g;

/**
 * 赤5判定そのものの再実装を検出する。
 * `RED_FIVE_SUITS` のような命名済みの集合と、`rank === 5` のインライン展開の両方を拾う
 * (旧 `engine.riichi-ankan.test.ts` は後者の形で重複していた)。
 *
 * ドメインで rank 5 に特別な意味があるのは赤5だけなので、`rank === 5` は赤5判定の
 * シグナルとして扱ってよい。字牌の白も rank 5 だが、`HONOR.WHITE` という記号で書く規約
 * (`tiles/tile.ts` / `hand/tile-identity.ts`)のためリテラル 5 とは衝突しない。
 * 表示層でも白は `HONOR_NAME` / `HONOR_FILE` の索引で扱う(`components/common/tileLabel.ts` /
 * `tileImage.ts`)。仮に白の判定をリテラルで書きたくなったら、この検出器を緩めるのではなく
 * `HONOR.WHITE` を import して書くこと。
 *
 * ⚠️ 走査対象に表示層({@link RED_FIVE_ROOTS})を含めたことで、`rank` は牌の位だけでなく
 * **順位**の意味でも現れる(`components/result/RankingTable.tsx` 等の `player.rank === 1`)。
 * 四人回しの順位は 1〜4 で 5 を取り得ないため今は衝突しないが、順位の値域が変わったら
 * この検出器の前提も見直すこと。
 *
 * ⚠️ この検出器は識別子名 `rank` に依存するため、`r === 5` のように別名へ束ねられると
 * すり抜ける。上の {@link tileLiteral}(`Tile` の組み立てそのものを見る)と合わせた
 * **多層防御の1枚**であり、単体で完全性を主張するものではない。
 */
const redFiveRule = () => /RED_FIVE_SUITS|\brank\s*===\s*5\b/g;

/**
 * 行コメント / ブロックコメントを落とす。
 *
 * JSDoc で `{ suit, rank, isRed: … }` のように**書き方を説明する**のは自然な行為で、
 * それを違反として報告すると誰も直せない偽陽性になる。逆に文字列リテラル中の `//`
 * (URL など)を巻き込んで削りすぎる可能性はあるが、その場合に起きるのは検出漏れだけで、
 * 正しいコードを不当に落とすことはない。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
}

/**
 * 指定ルート配下の本番 .ts / .tsx を再帰列挙(テスト・独立オラクルは除く)。
 * 返すパスは {@link SRC} からの相対パスで、走査ルートをまたいでも一意になる。
 */
function productionFiles(roots: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string, base: string) => {
    // withFileTypes はシンボリックリンクを追わないため、リンクループで無限再帰しない。
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${base}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "__oracle__") continue;
        walk(join(dir, entry.name), rel);
      } else if (
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !/\.(test|spec)\.tsx?$/.test(entry.name)
      ) {
        out.push(rel);
      }
    }
  };
  for (const root of roots) walk(join(SRC, root), root);
  return out;
}

/** 走査対象から `re` にマッチする箇所を `path: matched` 形式で集める。 */
function offenders(re: () => RegExp, roots: readonly string[]): string[] {
  const found: string[] = [];
  for (const rel of productionFiles(roots)) {
    if (rel === FACTORY) continue;
    const text = stripComments(readFileSync(join(SRC, rel), "utf8"));
    for (const m of text.matchAll(re())) found.push(`${rel}: ${m[0]}`);
  }
  return found;
}

describe("牌ファクトリの単一起点(issue #375)", () => {
  it("列挙対象に本番ファイルが実在する(走査が空振りしていない)", () => {
    // 相対パスの起点や除外条件を壊すと offenders が常に空になり、
    // 以降の検査が「常に成功する無意味なテスト」へ静かに退化するため先に固定する。
    const files = productionFiles(TILE_LITERAL_ROOTS);
    expect(files).toContain(FACTORY);
    expect(files).toContain("domain/hand/tenpai.ts");
    expect(files).toContain("domain/game/ai.ts");
    expect(files).toContain("domain/dora/indicator.ts");
    expect(files.some((f) => f.includes("__oracle__"))).toBe(false);
    expect(files.some((f) => /\.(test|spec)\.tsx?$/.test(f))).toBe(false);
  });

  it("赤5判定の走査はドメインと表示層(.tsx を含む)の両方に届く(issue #485)", () => {
    // 表示層を足したつもりでドメインを落とすと、issue #375 が直した元の退行
    // (ドメイン内での赤5判定の再実装)が丸ごと素通りする。offenders は FACTORY を
    // 無条件に skip するため、この取りこぼしはどのテストにも現れない。
    // 「ドメイン ⊆ 赤5走査」を直接固定して、片側だけ縮める変更を失敗させる。
    expect(TILE_LITERAL_ROOTS.every((r) => RED_FIVE_ROOTS.includes(r))).toBe(
      true,
    );

    const files = productionFiles(RED_FIVE_ROOTS);
    expect(files).toContain(FACTORY); // ドメインルートの生存
    expect(files).toContain("domain/game/ai.ts");
    expect(files).toContain("components/common/tileImage.ts"); // 表示層(.ts)
    expect(files).toContain("components/common/Tile.tsx"); // 表示層(.tsx)
    expect(files).toContain("app/game/page.tsx"); // App Router
    expect(files.some((f) => /\.(test|spec)\.tsx?$/.test(f))).toBe(false);
  });

  it("検出器そのものが違反例を捕まえる(正例)", () => {
    // 走査対象が正しくても正規表現が壊れれば検査は静かに恒真化する。
    // 「捕まえたい書き方」を直接当てて、検出器の生存を独立に固定する。
    expect("return { suit, rank, isRed: false };").toMatch(tileLiteral());
    expect("return { suit, rank, isRed };").toMatch(tileLiteral()); // shorthand
    expect("const t = { suit, isRed, rank };").toMatch(tileLiteral()); // 末尾以外
    expect("RED_FIVE_SUITS.has(suit)").toMatch(redFiveRule());
    expect("rank === 5 && isRedSuit(suit)").toMatch(redFiveRule());

    // 牌種(suit+rank)だけの射影は牌の組み立てではないので拾わない。
    expect("tileKey({ suit: tile.suit, rank: tile.rank })").not.toMatch(
      tileLiteral(),
    );
  });

  it("コメント内の説明は違反として報告しない(偽陽性の抑制)", () => {
    const jsdoc = "/** `{ suit, rank, isRed: … }` を直に書かないこと。 */";
    expect(jsdoc).toMatch(tileLiteral()); // 素のままだと拾ってしまう
    expect(stripComments(jsdoc)).not.toMatch(tileLiteral());
    expect(stripComments("// rank === 5 は書かない")).not.toMatch(
      redFiveRule(),
    );
  });

  it("ドメイン本番コードは tiles/tile.ts 以外で Tile を組み立てない", () => {
    const found = offenders(tileLiteral, TILE_LITERAL_ROOTS);
    expect(
      found,
      `Tile の組み立ては createTile(${FACTORY})に集約してください。\n` +
        found.join("\n"),
    ).toEqual([]);
  });

  it("ドメイン・表示層とも tiles/tile.ts 以外で赤5判定を再実装しない", () => {
    const found = offenders(redFiveRule, RED_FIVE_ROOTS);
    expect(
      found,
      `オール赤5の不変条件は ${FACTORY}(createTile / isRedDora)が唯一の定義元です。\n` +
        `表示層も判定を再実装せず isRedDora を import してください(issue #485)。\n` +
        found.join("\n"),
    ).toEqual([]);
  });
});
