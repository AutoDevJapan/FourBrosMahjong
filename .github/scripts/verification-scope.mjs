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
  // src/test/release-guard.test.ts が current package version の release section を検証する。
  "CHANGELOG.md",
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
  // `public/` は定義上そのまま配信される出荷ツリー。拡張子が .md でも文書ではない
  // (例: public/tiles/CREDITS.md は /tiles/CREDITS.md として配信され、
  //  Service Worker の /tiles/ ランタイムルールの対象にもなる)。
  if (path.startsWith("public/")) return "code";
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
 *   永続ブランチへのマージ後 push で、着地treeが直前にchecksを通過したPR headと
 *   同一だと証拠判定済みか。trueなら検証は重複である。
 * @param {boolean} [input.seedCaches=false]
 *   既定ブランチの push として共有キャッシュを投入するか。dev / stg の cache は
 *   保存しないため、検証済み昇格 push で setup を行っても消費するだけで再利用されない。
 * @returns {{ setup: boolean, verify: boolean }}
 *   `verify`: 検証コマンド (lint/test/build/playwright) を実行するか。
 *   `setup`: 依存とブラウザの導入 (= キャッシュ投入) を行うか。
 */
export function resolveScope({
  job,
  paths,
  postMergeDuplicate,
  seedCaches = false,
}) {
  const { docsOnly, unitTestOnly } = classifyChangedPaths(paths);
  const irrelevant = job === "e2e" ? unitTestOnly : docsOnly;
  const verify = !irrelevant && !postMergeDuplicate;
  // マージ後 push は検証しない。既定ブランチではキャッシュの投入だけを行う。
  // Actions のキャッシュは既定ブランチ (main) で保存したものだけが全 PR から復元できるため
  // (#380)、main の run が導入を止めると全 PR が毎回ダウンロードし直しになる。
  return { setup: verify || (postMergeDuplicate && seedCaches), verify };
}

export const SCOPE_OUTPUT_KEYS = /** @type {const} */ (["setup", "verify"]);

/** API / ref 取得が job 全体の timeout まで居座らないための上限。 */
export const EVIDENCE_IO_TIMEOUT_MS = 15_000;

/** 成功 check をこのワークフローの PR run に束縛する。 */
const TRUSTED_CHECK_APP = "github-actions";
const TRUSTED_WORKFLOW_PATH = ".github/workflows/ci.yml";

/**
 * この PR / push が持ち込んだ変更ファイルを取得する。
 * 特定できなければ `null` を返し、呼び出し側でフェイルオープンさせる。
 *
 * **3 点リーダ (`...`) を使う理由**: 2 点 (`base..head`) は「base の先端」と「head」の
 * 単純な差分なので、**base 側が進むとその変更まで差分に現れる**。本リポジトリは
 * 複数レーンが並行して main へマージするため、2 点だと文書のみの PR でも他レーンが
 * 変更した出荷コードが混ざり、スキップ判定がほぼ発火しなくなる (実測で確認)。
 * 3 点は merge-base からの差分 = **この PR 自身が持ち込んだ変更**であり、
 * GitHub の PR 画面が表示する差分と一致する。
 *
 * **`--no-renames` を付ける理由**: git は既定でリネームを検出し、`--name-only` は
 * **移動先のパスだけ**を出力する。そのため `git mv src/foo.ts docs/foo.md` のような変更が
 * 「`docs/foo.md` だけが変わった」= 文書のみと誤判定され、**出荷コードが 1 本消えているのに
 * lint も typecheck も test も build も走らないまま required check が緑になる**。
 * 検出を切って移動元・移動先の両方を出力させる。
 *
 * @param {string | undefined} baseSha
 * @param {string | undefined} headSha
 * @returns {string[] | null}
 */
export function changedPaths(baseSha, headSha) {
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
      ["diff", "--name-only", "--no-renames", "-z", `${baseSha}...${headSha}`],
      {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        // 失敗はフェイルオープンとして扱い理由を自前で出力するので、git の
        // エラー出力をそのまま垂れ流さない (ログのノイズになるだけ)。
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    // `-z` で NUL 区切りにする。パスに改行や非 ASCII (本リポジトリは日本語ファイル名を含む)
    // があっても、git がクォート/エスケープした形に化けない。
    const paths = output.split("\0").filter((entry) => entry.length > 0);
    return paths.length > 0 ? paths : null;
  } catch {
    return null;
  }
}

/**
 * マージ後 push のスキップを許してよいかを、**その run の中で実際に確かめる** (#496)。
 *
 * ## なぜ設定の記述を信じてはいけないか
 *
 * このスキップは「永続ブランチに着地するツリーは直前に PR の checks が緑にしたツリーと一致する」
 * という前提に立つ。その前提は branch protection (`strict: true` / 直 push 禁止 /
 * force push 禁止) が支えているが、**設定は後から緩められる**。緩んだ瞬間、未検証の
 * コミットが永続ブランチに入っても CI は緑のまま素通りする — 誰も気づけない失敗になる。
 *
 * そこで branch protection の *設定* を読むのではなく、**検証済みであることの証拠**を直接見る。
 * 設定がどうであれ、証拠が揃っていれば安全であり、揃っていなければ危険だからである
 * (`administration:read` 権限も不要になる)。
 *
 * ## 確認する証拠
 *
 * 1. force push でない (`github.event.forced`)。履歴の書き換えは前提を丸ごと壊す。
 * 2. この commit が **マージ済み PR の成果物**である (`merge_commit_sha` が一致)。
 *    直 push なら該当 PR が無いのでここで落ちる。
 * 3. **この job 自身の check run** が PR head SHA で `success` になっている。
 *    「required だったか」ではなく「実際に緑だったか」を見るため、required checks の
 *    設定変更から独立している。
 * 4. 通常PRでは push 前の宛先 tip が PR head の祖先である。環境昇格では merge commit の親が
 *    **push 前の宛先 tip, PR head** の順で完全一致する。main→dev / dev→stg は環境固有の過去の
 *    merge commit により履歴が分岐するため、親の一致で分岐を許しつつ任意commitの混入を防ぐ。
 * 5. 着地したツリーが **PR head のツリーと完全一致**する。3 で緑を確認した中身が
 *    そのまま入ったことを、内容そのもので照合する。
 *
 * ## フェイルセーフ
 *
 * どれか 1 つでも確認 **できなかった** 場合 (API 失敗・権限不足・ref 取得不可を含む) は
 * スキップせず全ゲートを実行する。「確認できない」を「安全」と読み替えない。
 *
 * @param {object} input
 * @param {string} input.repo `owner/name`
 * @param {string | undefined} input.sha push で着地した commit
 * @param {string | undefined} input.before push 前の branch 先端
 * @param {boolean} input.forced force push か
 * @param {string} input.branch push 先ブランチ名 (PR の base と突き合わせる)
 * @param {string} input.checkName この job の check run 名
 * @param {(path: string) => Promise<unknown>} input.api GitHub REST 呼び出し
 * @param {(args: string[]) => string} input.git git 実行 (stdout を返す)
 * @returns {Promise<{ skip: boolean, reason: string }>} `reason` は安定した ASCII 列挙
 */
export async function resolvePostMergeEvidence({
  repo,
  sha,
  before,
  forced,
  branch,
  checkName,
  api,
  git,
}) {
  const isSha = (/** @type {unknown} */ value) =>
    typeof value === "string" && /^[0-9a-f]{40}$/.test(value);

  if (forced) return { skip: false, reason: "forced-push" };
  if (!isSha(sha)) return { skip: false, reason: "head-sha-unresolved" };
  // 全 0 = ブランチ新規作成。比較対象が無く、着地内容を照合できない。
  if (!isSha(before) || /^0{40}$/.test(String(before)))
    return { skip: false, reason: "base-sha-unresolved" };

  /** @type {any} */
  let pulls;
  try {
    pulls = await api(`/repos/${repo}/commits/${sha}/pulls`);
  } catch {
    return { skip: false, reason: "pulls-api-failed" };
  }
  if (!Array.isArray(pulls))
    return { skip: false, reason: "pulls-response-invalid" };
  const pull = pulls.find(
    (candidate) =>
      candidate?.merged_at &&
      candidate?.merge_commit_sha === sha &&
      candidate?.base?.ref === branch &&
      // 環境昇格は経路を固定する。任意の feature PR が dev / stg の重い検証を
      // PR側の成功だけで短絡することを許さない。
      (branch === "main" ||
        (branch === "dev" &&
          candidate?.head?.ref === "main" &&
          candidate?.head?.repo?.full_name === repo) ||
        (branch === "stg" &&
          candidate?.head?.ref === "dev" &&
          candidate?.head?.repo?.full_name === repo)) &&
      isSha(candidate?.head?.sha),
  );
  // 直 push、未マージ、別ブランチ宛のいずれもここで落ちる。
  if (!pull) return { skip: false, reason: "no-merged-pull-request" };
  const headSha = pull.head.sha;

  /** @type {any} */
  let checks;
  try {
    checks = await api(
      `/repos/${repo}/commits/${headSha}/check-runs?per_page=100`,
    );
  } catch {
    return { skip: false, reason: "check-runs-api-failed" };
  }
  const runs = checks?.check_runs;
  if (!Array.isArray(runs))
    return { skip: false, reason: "check-runs-response-invalid" };
  const own = runs.filter((run) => run?.name === checkName);
  if (own.length === 0) return { skip: false, reason: "own-check-run-missing" };
  // 名前と app だけでは、同じ repository の別 workflow が作った check を区別できない。
  // details URL から Actions run を引き、その run がこの workflow の pull_request 実行で
  // 同じ head SHA を検証したことまで確認する。同じ SHA にはマージ後 push の同名 check も
  // 共存しうるため、それは候補から除外し、eligible な PR run が 1 本以上成功していることを
  // 証拠とする。
  let successfulEligibleRun = false;
  for (const run of own) {
    if (run?.app?.slug !== TRUSTED_CHECK_APP) continue;
    const match = String(run?.details_url ?? "").match(
      /\/actions\/runs\/(\d+)(?:\/job\/\d+)?(?:[/?#]|$)/,
    );
    if (!match) return { skip: false, reason: "own-check-run-not-successful" };
    /** @type {any} */
    let workflowRun;
    try {
      workflowRun = await api(`/repos/${repo}/actions/runs/${match[1]}`);
    } catch {
      return { skip: false, reason: "check-runs-api-failed" };
    }
    const ineligible =
      workflowRun?.event !== "pull_request" ||
      workflowRun?.path !== TRUSTED_WORKFLOW_PATH ||
      workflowRun?.head_sha !== headSha;
    if (ineligible) continue;
    if (
      run?.conclusion === "success" &&
      workflowRun?.conclusion === "success"
    ) {
      successfulEligibleRun = true;
    }
  }
  if (!successfulEligibleRun)
    return { skip: false, reason: "own-check-run-not-successful" };

  // マージ後は PR の head branch / `refs/pull/N/head` が削除されることがある。
  // ephemeral な ref に依存すると、並列 job の片方だけが証拠検証に失敗して
  // 重い検証を重複実行するため、head commit は GitHub API の immutable SHA で読む。
  /** @type {any} */
  let headCommit;
  try {
    headCommit = await api(`/repos/${repo}/git/commits/${headSha}`);
  } catch {
    return { skip: false, reason: "pull-head-commit-api-failed" };
  }
  if (
    headCommit?.sha !== headSha ||
    !/^[0-9a-f]{40}$/.test(String(headCommit?.tree?.sha ?? ""))
  ) {
    return { skip: false, reason: "pull-head-commit-invalid" };
  }

  if (branch === "main") {
    /** @type {any} */
    let comparison;
    try {
      comparison = await api(`/repos/${repo}/compare/${before}...${headSha}`);
    } catch {
      return { skip: false, reason: "base-ancestor-api-failed" };
    }
    // `identical` is also an ancestor relationship; GitHub normally reports
    // `ahead` for a PR head that contains the pre-merge base tip.
    if (comparison?.status !== "ahead" && comparison?.status !== "identical") {
      return { skip: false, reason: "base-not-ancestor-of-pull-head" };
    }
  } else {
    try {
      const mergeLine = git([
        "rev-list",
        "--parents",
        "-n",
        "1",
        String(sha),
      ]).trim();
      const [commit, ...parents] = mergeLine.split(/\s+/);
      if (
        commit !== sha ||
        parents.length !== 2 ||
        parents[0] !== String(before) ||
        parents[1] !== headSha
      ) {
        return { skip: false, reason: "merge-parents-mismatch" };
      }
    } catch {
      return { skip: false, reason: "merge-parents-unresolved" };
    }
  }

  // The checkout is not a stable source of merge metadata: a partial clone or
  // an unavailable object can make the same post-merge evidence resolve
  // differently in parallel jobs. Read the landed commit and its tree through
  // the immutable GitHub API, just like the PR head above.
  /** @type {any} */
  let landedCommit;
  try {
    landedCommit = await api(`/repos/${repo}/git/commits/${sha}`);
  } catch {
    return { skip: false, reason: "landed-commit-api-failed" };
  }
  if (
    landedCommit?.sha !== sha ||
    !/^[0-9a-f]{40}$/.test(String(landedCommit?.tree?.sha ?? ""))
  ) {
    return { skip: false, reason: "landed-commit-invalid" };
  }

  const landed = String(landedCommit.tree.sha);
  const verified = String(headCommit.tree.sha);
  if (landed !== verified) return { skip: false, reason: "tree-mismatch" };

  return { skip: true, reason: "verified-by-merged-pull-request" };
}

/** `resolvePostMergeEvidence` に渡す既定の GitHub REST 呼び出し。 */
export async function githubApi(/** @type {string} */ path) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not available");
  const base = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(EVIDENCE_IO_TIMEOUT_MS),
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  // 権限不足 (403) や存在しない (404) も「確認できなかった」として扱う。
  if (!response.ok) throw new Error(`GitHub API ${path} -> ${response.status}`);
  return response.json();
}

/** `resolvePostMergeEvidence` に渡す既定の git 実行。 */
export function runGit(
  /** @type {string[]} */ args,
  /** @type {typeof execFileSync} */ exec = execFileSync,
) {
  return exec("git", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: EVIDENCE_IO_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * CI の対象となる永続ブランチへの push ならブランチ名を返す。
 * PR と未知のブランチは証拠検証の対象にしない。
 *
 * @param {string | undefined} eventName
 * @param {string | undefined} ref
 * @returns {"main" | "dev" | "stg" | null}
 */
export function protectedPushBranch(eventName, ref) {
  if (eventName !== "push") return null;
  const match = String(ref ?? "").match(/^refs\/heads\/(main|dev|stg)$/);
  return /** @type {"main" | "dev" | "stg" | null} */ (match?.[1] ?? null);
}

/** GitHub Actions の `$GITHUB_OUTPUT` へ書き出す。 */
async function main() {
  const job = process.env.SCOPE_JOB === "e2e" ? "e2e" : "ci";
  const pushBranch = protectedPushBranch(
    process.env.SCOPE_EVENT_NAME,
    process.env.SCOPE_REF,
  );

  // マージ後 push のスキップは「前提が成立している」と信じるのではなく、
  // その run の中で証拠を確認できたときにだけ許す (#496)。
  let evidence = { skip: false, reason: "not-a-protected-branch-push" };
  if (pushBranch) {
    evidence = await resolvePostMergeEvidence({
      repo: String(process.env.GITHUB_REPOSITORY ?? ""),
      sha: process.env.SCOPE_HEAD_SHA,
      before: process.env.SCOPE_BASE_SHA,
      forced: process.env.SCOPE_FORCED === "true",
      branch: pushBranch,
      checkName: String(process.env.SCOPE_CHECK_NAME ?? ""),
      api: githubApi,
      git: runGit,
    });
  }

  const paths = changedPaths(
    process.env.SCOPE_BASE_SHA,
    process.env.SCOPE_HEAD_SHA,
  );
  const scope = resolveScope({
    job,
    paths,
    postMergeDuplicate: Boolean(pushBranch) && evidence.skip,
    // 保存 step は main 限定。dev / stg で setup しても共有cacheへ保存できず、
    // 特にbrowser cache miss時のdownloadが完全な浪費になる。
    seedCaches: pushBranch === "main",
  });

  const summary = [
    `job=${job}`,
    `pushBranch=${pushBranch ?? "none"}`,
    `postMergeEvidence=${evidence.reason}`,
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
  main().catch((error) => {
    // 判定自体が落ちたら job を赤にする。「判定できなかったので全部やる」を
    // 静かに握り潰すと、逆にスキップの誤りに気づけなくなる。
    console.error(error);
    process.exitCode = 1;
  });
}
