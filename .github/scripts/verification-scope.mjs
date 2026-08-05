// @ts-check
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * 変更パスから「この job が何をすべきか」を判定する (#491)。
 *
 * ## なぜ job ではなく step なのか
 *
 * GitHub Actions の課金は **job ごとに分単位へ切り上げ**られる。判定用の軽量 job と
 * 集約用の gate job を足す構成は、判定そのものが数秒で終わっても **1 run あたり +2 分**
 * を常に上乗せする。本リポジトリの実測 job 時間 (ci 3.9 分 / e2e 5.4 分) では、
 * その上乗せがパススキップの節約をほぼ食い潰す (試算: 判定 job 方式 9.80 分/PR に対し、
 * job 内で短絡する方式 8.10 分/PR)。
 *
 * したがって判定は **各 job の先頭 step** で行い、重い step だけを `if:` で落とす。
 * 副次的な利点として、job 自体は常に実行され常に成功を報告するため:
 *   - required status check が「skip されたまま永久に pending」になる罠を構造的に回避できる
 *   - branch protection の context 名を変更する必要がない
 * つまり `ci` job 自体が「変更が無関係でも短時間で成功する安定した gate」として機能する。
 *
 * ## フェイルオープン
 *
 * 変更ファイルを特定できない場合 (浅い clone・force push・新規ブランチで
 * `github.event.before` が全 0 など) は **必ず全検証を実行する**。判定できないことを
 * 「スキップしてよい」と解釈すると、検証の穴が静かに開く。
 */

/**
 * 出荷グラフにも検証ロジックにも入らない純粋な文書。
 * これらだけが変わった場合、検証すべき対象が存在しない。
 */
const DOCUMENTATION = [/^docs\//, /^documents\//, /\.md$/];

/**
 * `DOCUMENTATION` に形の上では一致するが、**テストが実際に読んでいる**ため
 * 文書として扱ってはいけないファイル。
 *
 * ここが実態とずれると「テストが読んでいるファイルを変更したのに CI が走らない」
 * という静かな検証漏れになる。`src/test/ci-workflow.test.ts` が
 * `src/**` 内の `resolve(process.cwd(), "…")` リテラルを走査して、この一覧が
 * 実態と一致していることを固定する。
 */
export const DOCUMENTATION_EXCEPTIONS = [
  // src/app/rules/rules-doc.test.ts が内容を読み、/rules の記載と突き合わせる。
  "docs/四兄弟麻雀ルール.md",
  // src/test/playwright-projects.test.ts が playwright install 手順を検証する。
  "README.md",
];

/**
 * production バンドルにも E2E の対象にも入らないテスト専用資産。
 * これらだけが変わった場合、ブラウザ上の振る舞いは 1 バイトも変化しないため
 * E2E を実行する意味がない (`pnpm test` は `ci` job で実行されるので、
 * テスト自体の退行は引き続き検出される)。
 */
const UNIT_TEST_ONLY = [
  /(^|\/)__testing__\//,
  /(^|\/)__oracle__\//,
  /\.(test|spec)\.tsx?$/,
];

/**
 * ブラウザ経路そのものを定義するパス。`UNIT_TEST_ONLY` の
 * `\.(test|spec)\.tsx?$` にも一致してしまうため、**先に**判定する必要がある。
 */
const E2E_ASSET = [/^e2e\//, /^playwright\.config\.ts$/];

/** @param {string} path @param {RegExp[]} patterns */
const matches = (path, patterns) =>
  patterns.some((pattern) => pattern.test(path));

/**
 * 1 パスを分類する。
 * @param {string} path
 * @returns {"e2e-asset" | "documentation" | "unit-test" | "code"}
 */
export function classifyPath(path) {
  if (matches(path, E2E_ASSET)) return "e2e-asset";
  if (DOCUMENTATION_EXCEPTIONS.includes(path)) return "code";
  if (matches(path, DOCUMENTATION)) return "documentation";
  if (matches(path, UNIT_TEST_ONLY)) return "unit-test";
  return "code";
}

/**
 * 変更パス一覧から、何が影響を受けうるかを判定する。
 *
 * @param {readonly string[] | null | undefined} paths
 *   変更ファイル一覧。`null` / `undefined` は「特定できなかった」を意味する。
 * @returns {{ docsOnly: boolean, unitTestOnly: boolean }}
 *   `docsOnly`: 出荷物にも検証対象にも影響しない。
 *   `unitTestOnly`: ブラウザ上の振る舞いには影響しない (単体テストには影響しうる)。
 */
export function classifyChangedPaths(paths) {
  // 特定できない / 空 → フェイルオープンで全検証。
  if (!paths || paths.length === 0) {
    return { docsOnly: false, unitTestOnly: false };
  }
  const kinds = paths.map(classifyPath);
  return {
    docsOnly: kinds.every((kind) => kind === "documentation"),
    unitTestOnly: kinds.every(
      (kind) => kind === "documentation" || kind === "unit-test",
    ),
  };
}

/**
 * job が実行すべき内容を決める。
 *
 * @param {object} input
 * @param {"ci" | "e2e"} input.job
 * @param {readonly string[] | null | undefined} input.paths
 * @param {boolean} input.postMergeDuplicate
 *   `main` へのマージ後 push か。`main` は branch protection が
 *   `strict: true` (マージ前に最新であることを要求) / 直 push 禁止 / force push 禁止
 *   なので、着地するツリーは直前に PR の checks が緑にしたツリーと必ず一致する。
 *   したがって検証は重複であり、この run はキャッシュ投入だけを行う。
 * @returns {{ setup: boolean, verify: boolean }}
 *   `verify`: 検証コマンド (lint/test/build/playwright) を実行するか。
 *   `setup`: 依存とブラウザの導入 (= キャッシュ投入) を行うか。
 */
export function resolveScope({ job, paths, postMergeDuplicate }) {
  const { docsOnly, unitTestOnly } = classifyChangedPaths(paths);
  const irrelevant = job === "e2e" ? unitTestOnly : docsOnly;
  const verify = !irrelevant && !postMergeDuplicate;
  // マージ後 push は検証しないが、キャッシュの投入だけは行う。
  // Actions のキャッシュは既定ブランチ (main) で保存したものだけが全 PR から復元できるため
  // (#380)、main の run が導入を止めると全 PR が毎回ダウンロードし直しになる。
  return { setup: verify || postMergeDuplicate, verify };
}

export const SCOPE_OUTPUT_KEYS = /** @type {const} */ (["setup", "verify"]);

/**
 * `git diff --name-only <base>..<head>` で変更ファイルを取得する。
 * 特定できなければ `null` を返し、呼び出し側でフェイルオープンさせる。
 *
 * @param {string | undefined} baseSha
 * @param {string | undefined} headSha
 * @returns {string[] | null}
 */
function changedPaths(baseSha, headSha) {
  // 新規ブランチへの push では `github.event.before` が全 0 になり、比較対象が無い。
  /** @param {string | undefined} sha */
  const isUsable = (sha) =>
    typeof sha === "string" &&
    /^[0-9a-f]{40}$/.test(sha) &&
    !/^0{40}$/.test(sha);
  if (!isUsable(baseSha) || !isUsable(headSha)) return null;
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", "-z", `${baseSha}..${headSha}`],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    // `-z` で NUL 区切りにする。パスに改行や非 ASCII (本リポジトリは日本語ファイル名を含む)
    // があっても、git がクォート/エスケープした形に化けない。
    const paths = output.split("\0").filter((entry) => entry.length > 0);
    return paths.length > 0 ? paths : null;
  } catch {
    return null;
  }
}

/** GitHub Actions の `$GITHUB_OUTPUT` へ書き出す。 */
function main() {
  const job = process.env.SCOPE_JOB === "e2e" ? "e2e" : "ci";
  const postMergeDuplicate =
    process.env.SCOPE_EVENT_NAME === "push" &&
    process.env.SCOPE_REF === "refs/heads/main";
  const paths = changedPaths(
    process.env.SCOPE_BASE_SHA,
    process.env.SCOPE_HEAD_SHA,
  );
  const scope = resolveScope({ job, paths, postMergeDuplicate });

  const summary = [
    `job=${job}`,
    `postMergeDuplicate=${postMergeDuplicate}`,
    paths
      ? `changedPaths=${paths.length}`
      : "changedPaths=unresolved (fail-open)",
    `setup=${scope.setup}`,
    `verify=${scope.verify}`,
  ].join(" ");
  console.log(summary);
  if (paths)
    console.log(
      paths.map((path) => `  ${classifyPath(path)}\t${path}`).join("\n"),
    );

  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  appendFileSync(
    outputFile,
    SCOPE_OUTPUT_KEYS.map((key) => `${key}=${scope[key]}\n`).join(""),
  );
}

// テストからの import 時には実行しない (CLI として起動されたときだけ動かす)。
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
