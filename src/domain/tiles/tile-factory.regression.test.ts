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
 * `Tile` そのものではないため。例えば `domain/game/gameView.ts` の
 * `{ suit, rank, isRed: tile.isRed }` は `Tile` → `TileData` の正当な写像で、
 * 表示層まで走査すると確実に偽陽性になる。ドメインへ戻す唯一の境界
 * (同ファイルの `toTile()`)は `createTile` を使っており、穴は空いていない。
 */
const TILE_LITERAL_ROOTS = ["domain"] as const;

/**
 * `Tile` ではなく表示用 `TileData` を組み立てる中立投影。サーバーとUIが共有するため
 * `src/domain` に置くが、`isRed` 必須の `Tile` 生成を検査する対象ではない(issue #750)。
 */
const TILE_LITERAL_EXEMPTIONS = new Set(["domain/game/gameView.ts"]);

/**
 * 赤扱いの走査対象。**表示層まで含める**(issue #485)。
 * {@link redFiveRule}(判定の再実装)と {@link rawIsRedRead}(`.isRed` の直読み / issue #490)
 * が共有する。走査範囲を1本にしておくと、`src/` 直下の補集合ガード(下のテスト)が
 * 両方の検出器を同時に守る。
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
 * `.isRed` の**直読み**を検出する(issue #490)。
 *
 * {@link redFiveRule} は「牌種で赤5を判定し直す」形しか見ないため、`if (tile.isRed)` の
 * ように**フラグをそのまま赤ドラの意味で使う**違反(#490 の `ai.ts` の `valueOf`)は
 * 構造上すり抜ける。この検出器はプロパティ読み出しそのものを拾い、正当な用途を
 * {@link ALLOWED_RAW_IS_RED_READS} で個別に許可する。
 *
 * 線引きは `tiles/tile.ts` の JSDoc(issue #485)と同じ:
 * **赤ドラとしての意味づけ**(得点への加算・表示の赤扱い・打点温存)は `isRedDora` に
 * 委ねる = 禁止 / **フラグの値そのもの**を扱う用途(同一性比較・識別キー・整列・
 * 投影・保存値の検証)は許可。
 *
 * ドット記法(`tile.isRed`)と添字記法(`tile["isRed"]`)の両方を見る。`.`(または `[`)を
 * 必須にしているのでオブジェクトリテラルのキー(`isRed:` / shorthand)は拾わない
 * — そちらは {@link tileLiteral} の担当。`\b` があるので `.isRedDora(...)` にも当たらない。
 * 添字側は `["isRed"]` 単独の形だけを見るので、`hasOnlyKeys(tile, ["suit", "rank", "isRed"])`
 * のような**キー名の列挙**(`gamePersistence.ts`)は拾わない。
 *
 * ⚠️ 構文解析ではなく字面の走査なので、`const { isRed } = tile;`(分割代入)や
 * `Object.entries(tile)` 経由の読み出し、別名への束縛はすり抜ける
 * (分割代入はドメインに限り {@link tileLiteral} の `isRed }` が拾う)。
 * 逆に `{ ["isRed"]: true }` のような計算プロパティキーは**組み立て**なのに直読みとして
 * 報告される(現状 `src` に該当は無く、添字記法の分岐は純粋に防御的)。偽陽性が出ても
 * 人間が許可リストで裁定できるので、検出器はここでは緩めない。
 * {@link tileLiteral} / {@link redFiveRule} と同じく**多層防御の1枚**であって、
 * 単体で完全性を主張するものではない。下の許可リストが「完全一致」で固定するのは
 * **この検出器が見える範囲**であり、赤扱いの全経路ではない。
 */
const rawIsRedRead = () => /\.isRed\b|\[\s*["']isRed["']\s*\]/g;

/**
 * `.isRed` を直読みしてよい既知の箇所(`SRC` 相対パス + 該当行)。
 *
 * 下の検査は「検出結果 == この配列」という**完全一致**なので、両方向が固定される:
 * 新しい直読みが増えれば余分な要素として、ここから根拠を消せば不足要素として落ちる。
 * 1行に2回読む箇所は**同じ要素が2回**並ぶ(既存行に読み出しを足しても検出される)。
 *
 * 鍵に**行の字面**(正確には {@link stripComments} 適用後の行)を使っているので、対象行の
 * 折り返し位置が変わる(整形・リネーム)とここも直す必要がある。行内コメントを含む行は
 * その部分が空白へ潰れるため実ソース行と一字一句同じにはならないが、検出結果と許可リストは
 * 同じ変換後テキストを見るので自己整合する。行そのものを鍵にするのは、許可の可否が
 * 「どう使っているか」で決まり、パスやマッチ文字列だけでは判断できないため。失敗時は
 * 対称差(余分 / 不足)をメッセージに出すので、差し替えは目視で完結する。
 */
const ALLOWED_RAW_IS_RED_READS: readonly string[] = [
  // 牌の同一性比較・識別キー。赤フラグの値そのものを見る(赤ドラの意味づけではない)。
  'domain/game/ai.ts: const idKey = `${tile.suit}-${tile.rank}-${tile.isRed ? "r" : ""}`;',
  "domain/game/engine.ts: return a.suit === b.suit && a.rank === b.rank && !!a.isRed === !!b.isRed;",
  "domain/game/engine.ts: return a.suit === b.suit && a.rank === b.rank && !!a.isRed === !!b.isRed;",
  "domain/game/engine.ts: const key = `${t.suit}-${t.rank}-${t.isRed ? 1 : 0}`;",
  // Wallの正準多重集合キー。赤フラグの値を同一性検証に使い、偽赤を受け入れない。
  'domain/wall/wall.ts: return `${tile.suit}-${tile.rank}-${tile.isRed ? "r" : "n"}`;',
  // 打牌候補の同一性一致(赤・非赤を取り違えないための比較)。
  "components/game/GameBoard.tsx: candidate.isRed === !!tile.isRed,",
  "components/game/GameBoard.tsx: candidate.isRed === !!tile.isRed,",
  // 手牌のツモ差分キー。赤・非赤を別牌として扱うための値そのものの識別。
  'components/game/hand-animation/handAnimation.ts: return `${tile.suit}:${tile.rank}:${tile.isRed === true ? "red" : "normal"}`;',
  // 復元ジャーナルの保存値検証(不変条件を破った値を fail-closed で弾く)。
  'domain/game/gamePersistence.ts: typeof tile.isRed === "boolean" &&',
  "domain/game/gamePersistence.ts: tile.isRed === createTile(suit, rank).isRed",
  "domain/game/gamePersistence.ts: tile.isRed === createTile(suit, rank).isRed",
  // Tile → TileData の投影と、表示ソートのタイブレーク。
  "domain/game/gameView.ts: return { suit: tile.suit, rank: tile.rank, isRed: tile.isRed };",
  "domain/game/gameView.ts: Number(a.isRed) - Number(b.isRed),",
  "domain/game/gameView.ts: Number(a.isRed) - Number(b.isRed),",
  // WebSocket由来TileDataの赤フラグ型検証。赤ドラの意味づけには使わない。
  "components/online/onlineServerMessage.ts: isOptionalBoolean(value.isRed)",
];

/**
 * 行コメント / ブロックコメントを落とす。
 *
 * JSDoc で `{ suit, rank, isRed: … }` のように**書き方を説明する**のは自然な行為で、
 * それを違反として報告すると誰も直せない偽陽性になる。逆に文字列リテラル中の `//`
 * (URL など)を巻き込んで削りすぎる可能性はあるが、その場合に起きるのは検出漏れだけで、
 * 正しいコードを不当に落とすことはない。
 *
 * コメントを**空白へ潰す**ため、識別子の途中にブロックコメントを挟んだ書き方
 * (`tile.` と `isRed` の間にコメントを置く等)は連結されず検出漏れになる
 * (丸ごと削る旧実装なら拾えた)。逆に `isRed` の途中にコメントを挟んだ字面を誤って
 * 連結する偽陽性は起きない。どちらも本番コードに該当は無く、下の行対応の保存を優先する。
 *
 * 落とすのは**改行以外**だけで、コメントの改行はそのまま残す。丸ごと削ると複数行に
 * またがるブロックコメントの前後の行が連結され、{@link scan} が組み立てる「該当行」が
 * 実ソースに存在しない行になってしまうため({@link ALLOWED_RAW_IS_RED_READS} の鍵が壊れる)。
 * 行コメント / ブロックコメントの**どちらを先に食うか**は元の1本の交替で決まる順序を保つ
 * (2パスに分けると `// … /* …` のような行で挙動が変わる)。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
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

/**
 * `text` 中の位置 `index` を含む1行(前後を改行で切り出して trim)。
 *
 * `index` が改行直後でも末尾行(終端に改行が無い)でも、その位置を含む行を返す。
 * 許可リストの鍵そのものを作る関数なので、境界のずれは許可リスト全体を壊す。
 */
function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? undefined : end).trim();
}

/**
 * 1ファイル分のテキストから `re` のマッチを集める(走査の中核)。
 *
 * 走査はファイル**全文**に対して行う(行ごとに分けない)。{@link tileLiteral} の `\s*` は
 * 改行にも当たるため、`{ suit, rank, isRed\n}` のように折り返された組み立ては行単位の
 * 走査では取りこぼす。ファイル読み込みから切り離してあるのは、この「全文で見る」性質を
 * テキストを直接与えるテストで固定するため(下の「走査は全文に対して行う」テスト)。
 */
function collectIn(
  text: string,
  re: () => RegExp,
  keyOf: (match: RegExpMatchArray, text: string) => string,
): string[] {
  return [...text.matchAll(re())].map((m) => keyOf(m, text));
}

/**
 * 走査対象の全ファイルへ {@link collectIn} を適用し、`path: <keyOf の結果>` 形式で返す。
 *
 * 鍵の作り方だけが検出器ごとに違うので、`keyOf` にマッチと全文を渡して呼び出し側へ委ねる
 * (行が要らない検査で {@link lineAt} を無駄に走らせない)。
 */
function scan(
  re: () => RegExp,
  roots: readonly string[],
  keyOf: (match: RegExpMatchArray, text: string) => string,
  exemptions: ReadonlySet<string> = new Set(),
): string[] {
  const found: string[] = [];
  for (const rel of productionFiles(roots)) {
    if (rel === FACTORY || exemptions.has(rel)) continue;
    const text = stripComments(readFileSync(join(SRC, rel), "utf8"));
    for (const key of collectIn(text, re, keyOf)) found.push(`${rel}: ${key}`);
  }
  return found;
}

/** 「どこかに違反がある」だけを見る検査用。マッチ文字列を鍵にする。 */
function offenders(
  re: () => RegExp,
  roots: readonly string[],
  exemptions?: ReadonlySet<string>,
): string[] {
  return scan(re, roots, (m) => m[0], exemptions);
}

/**
 * 許可リストと突き合わせる検査用。**該当行**を鍵にする。
 *
 * 許可の可否は「何にマッチしたか」(`.isRed`)ではなく「どう使っているか」で決まるため。
 * 1行に複数マッチがあれば同じ要素が複数回並ぶ(既存行への読み出し追加も差分に出る)。
 */
function offenderLines(re: () => RegExp, roots: readonly string[]): string[] {
  return scan(re, roots, (m, text) => {
    // `matchAll` は必ず index を持つが型上は任意。既定値で埋めると 1 行目を指す鍵が
    // 静かに作られるので、黙って誤魔化さず落とす。
    if (m.index === undefined) {
      throw new Error(
        "matchAll がマッチ位置を返さない(走査の前提が壊れている)",
      );
    }
    return lineAt(text, m.index);
  });
}

/** 多重集合としての対称差を「+ 余分 / − 不足」で並べる(失敗時の直しやすさのため)。 */
function multisetDiff(
  actual: readonly string[],
  allowed: readonly string[],
): string[] {
  const remaining = [...allowed];
  const extra: string[] = [];
  for (const a of actual) {
    const i = remaining.indexOf(a);
    if (i === -1) extra.push(a);
    else remaining.splice(i, 1);
  }
  return [
    ...extra.map((e) => `+ 許可されていない直読み: ${e}`),
    ...remaining.map((m) => `- 許可リストに残っている根拠なし: ${m}`),
  ];
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

  it("赤扱いの走査はドメインと表示層(.tsx を含む)の両方に届く(issue #485 / #490)", () => {
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

  it("`src/` 直下に走査対象外のディレクトリ・ファイルが増えたら気づける", () => {
    // RED_FIVE_ROOTS はハードコードした許可リストなので、「ルートを消す」退行は
    // 上のテストが捕まえるが、「新しいルートが増える」退行は誰も捕まえない。
    // 将来 src/lib のようなディレクトリが足されると、そこだけ赤5判定を再実装しても
    // (あるいは `.isRed` を直読みしても)静かに素通りする。補集合を固定して、
    // 追加時に「走査するか」を意識的に決めさせる。
    //
    // ディレクトリだけでなく `src/` 直下の**ファイル**も固定する。走査ルートは
    // ディレクトリ名の集合なので、`src/foo.ts` に赤5判定を書かれると
    // 走査対象にも補集合にも入らず完全に素通りするため(実測で確認済み)。
    const UNSCANNED_DIRS_BY_DESIGN = [
      "lib", // 共有基盤のみ。牌ロジックを持たない。
      "test", // テスト基盤のみ。牌ロジックを持たない。
    ] as const;
    /** `src/` 直下の非走査ファイル(フレームワーク都合。牌ロジックを持たない)。 */
    const UNSCANNED_FILES_BY_DESIGN = ["global.d.ts", "proxy.ts"] as const;

    const entries = readdirSync(SRC, { withFileTypes: true });
    const scanned: readonly string[] = RED_FIVE_ROOTS;
    const hint =
      "src/ 直下に追加したら、赤扱い(赤5判定・`.isRed` 直読み)を走査するなら " +
      "RED_FIVE_ROOTS へ、走査不要なら理由を添えて UNSCANNED_*_BY_DESIGN へ" +
      "追記してください(issue #485 / #490)。";

    const unscannedDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((d) => !scanned.includes(d))
      .sort();
    expect(unscannedDirs, hint).toEqual([...UNSCANNED_DIRS_BY_DESIGN].sort());

    const srcFiles = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
    expect(srcFiles, hint).toEqual([...UNSCANNED_FILES_BY_DESIGN].sort());
  });

  it("検出器そのものが違反例を捕まえる(正例)", () => {
    // 走査対象が正しくても正規表現が壊れれば検査は静かに恒真化する。
    // 「捕まえたい書き方」を直接当てて、検出器の生存を独立に固定する。
    expect("return { suit, rank, isRed: false };").toMatch(tileLiteral());
    expect("return { suit, rank, isRed };").toMatch(tileLiteral()); // shorthand
    expect("const t = { suit, isRed, rank };").toMatch(tileLiteral()); // 末尾以外
    // `\s*` は改行にも当たる(走査を行単位へ分けたときに取りこぼす形)。
    expect("return { suit, rank, isRed\n};").toMatch(tileLiteral());
    expect("RED_FIVE_SUITS.has(suit)").toMatch(redFiveRule());
    expect("rank === 5 && isRedSuit(suit)").toMatch(redFiveRule());
    expect("if (tile.isRed) v += 2;").toMatch(rawIsRedRead()); // #490 の違反そのもの
    expect("const red = t?.isRed ?? false;").toMatch(rawIsRedRead());
    expect('if (tile["isRed"]) v += 2;').toMatch(rawIsRedRead()); // 添字記法

    // 牌種(suit+rank)だけの射影は牌の組み立てではないので拾わない。
    expect("tileKey({ suit: tile.suit, rank: tile.rank })").not.toMatch(
      tileLiteral(),
    );
    // 直読み検出器は「`.` 付きの読み出し」だけを見る。組み立て側のキーは tileLiteral の担当で、
    // 唯一の述語 `isRedDora` の呼び出しを違反にしてしまうと修正先が無くなる。
    expect("return { suit, rank, isRed: true };").not.toMatch(rawIsRedRead());
    expect("if (isRedDora(tile)) v += 2;").not.toMatch(rawIsRedRead());
    expect("tile.isRedDora").not.toMatch(rawIsRedRead());
    // キー名の列挙(gamePersistence.ts の hasOnlyKeys)は読み出しではない。
    expect('hasOnlyKeys(tile, ["suit", "rank", "isRed"])').not.toMatch(
      rawIsRedRead(),
    );
  });

  it("コメント内の説明は違反として報告しない(偽陽性の抑制)", () => {
    const jsdoc = "/** `{ suit, rank, isRed: … }` を直に書かないこと。 */";
    expect(jsdoc).toMatch(tileLiteral()); // 素のままだと拾ってしまう
    expect(stripComments(jsdoc)).not.toMatch(tileLiteral());
    expect(stripComments("// rank === 5 は書かない")).not.toMatch(
      redFiveRule(),
    );
    expect(stripComments("// tile.isRed を直接読まない")).not.toMatch(
      rawIsRedRead(),
    );
  });

  it("走査は全文に対して行う(行単位へ分割すると折り返しを取りこぼす)", () => {
    // 正規表現が改行をまたげること(上の正例)と、走査がその性質を活かしていることは別。
    // 折り返された `Tile` の組み立ては本番コードに現存しないので、collectIn を行単位
    // ループへ書き換えても他のテストは落ちない。ここで走査の側を直接固定する。
    const text = "const a = 1;\nreturn { suit, rank, isRed\n};";
    expect(collectIn(text, tileLiteral, (m) => m[0])).toHaveLength(1);
    // 行に分けると 0 件になることを、同じ入力で対比して示す。
    const perLine = text
      .split("\n")
      .flatMap((line) => collectIn(line, tileLiteral, (m) => m[0]));
    expect(perLine).toHaveLength(0);
  });

  it("lineAt は先頭・改行直後・末尾行(改行なし)で正しい行を返す", () => {
    // 許可リストの鍵そのものを作る関数。境界を1文字ずらすと許可リスト全体が壊れる。
    const text = "a.isRed;\nb.isRed;\nc.isRed;";
    expect(lineAt(text, 0)).toBe("a.isRed;");
    expect(lineAt(text, text.indexOf("b"))).toBe("b.isRed;");
    expect(lineAt(text, text.indexOf("c"))).toBe("c.isRed;");
  });

  it("multisetDiff は余分・不足を多重度込みで並べる", () => {
    // 失敗メッセージ専用なので判定には効かず、壊れても他のテストは落ちない。
    expect(multisetDiff(["a", "a", "b"], ["a", "c"])).toEqual([
      "+ 許可されていない直読み: a",
      "+ 許可されていない直読み: b",
      "- 許可リストに残っている根拠なし: c",
    ]);
    expect(multisetDiff(["a"], ["a"])).toEqual([]);
  });

  it("コメント除去で行の対応が崩れない(許可リストの鍵の安定性)", () => {
    // ブロックコメントを丸ごと削ると前後の行が連結され、`ALLOWED_RAW_IS_RED_READS` の
    // 鍵が「実ソースに存在しない行」になる。改行を保存していることを直接固定する。
    const src = "const a = tile.isRed; /* 長い\n説明 */ const b = 1;\n";
    const lines = stripComments(src).split("\n");
    expect(lines).toHaveLength(src.split("\n").length);
    expect(lines[0].trim()).toBe("const a = tile.isRed;");
    expect(lines[1].trim()).toBe("const b = 1;");
  });

  it("ドメイン本番コードは tiles/tile.ts 以外で Tile を組み立てない", () => {
    const found = offenders(
      tileLiteral,
      TILE_LITERAL_ROOTS,
      TILE_LITERAL_EXEMPTIONS,
    );
    expect(
      found,
      `Tile の組み立ては createTile(${FACTORY})に集約してください。\n` +
        found.join("\n"),
    ).toEqual([]);
  });

  it("`.isRed` の直読みは許可リストの箇所だけ(issue #490)", () => {
    // 赤5判定の再実装(redFiveRule)とは別に、「フラグをそのまま赤ドラの意味で使う」形の
    // 違反を塞ぐ。完全一致で比較するので、許可リストは常に現実と一致していなければならない
    // (根拠を消せば不足、新しい直読みが増えれば余分として、どちらでも落ちる)。
    const found = offenderLines(rawIsRedRead, RED_FIVE_ROOTS);
    const actual = [...found].sort();
    const expected = [...ALLOWED_RAW_IS_RED_READS].sort();
    // 差分の整形は不一致のときだけ行う(第2引数は毎回評価されるため)。
    const diff =
      actual.join("\n") === expected.join("\n")
        ? ""
        : multisetDiff(found, ALLOWED_RAW_IS_RED_READS).join("\n");
    expect(
      actual,
      `赤ドラとしての意味づけは isRedDora(${FACTORY})に委ねてください。\n` +
        "フラグの値そのものを扱う正当な用途なら、理由を添えて " +
        `ALLOWED_RAW_IS_RED_READS へ追記してください(issue #490)。\n${diff}`,
    ).toEqual(expected);
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
