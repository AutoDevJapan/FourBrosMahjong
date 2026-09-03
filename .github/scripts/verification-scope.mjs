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
 * 文書ツリーに置かれているが、単体テストが入力として読む資産。
 *
 * これらは出荷ツリーへは入らないため E2E は不要だが、内容・inventory・hash の
 * 整合性を検査する Vitest は必要である。`DOCUMENTATION` より先に unit-test として
 * 分類することで、変更時に ci の quality は維持しつつ production/E2E を省略できる。
 */
export const TEST_INPUT_PATHS = [
  // src/app/rules/rules-doc.test.ts が内容を読み、/rules の記載と突き合わせる。
  "docs/四兄弟麻雀ルール.md",
  // src/test/playwright-projects.test.ts が playwright install 手順を検証する。
  "README.md",
  // src/test/release-guard.test.ts が current package version の release section を検証する。
  "CHANGELOG.md",
  // server/rolloutPreflight.test.ts が secret-safe な deploy 手順を検証する。
  "documents/guides/railway-online-deploy-runbook.md",
  // src/test/ui-refresh-assets.test.ts が manifest と原本 inventory を検証する。
  "documents/assets/ui-refresh/manifest.json",
  // src/test/railway-iac-migration.test.ts が契約モジュール経由で不変fixtureを検証する。
  "documents/fixtures/railway-pre-cutover.json",
  // src/test/unity-display-contract.test.ts がUnity表示契約と席回転を検証する。
  "documents/fixtures/unity-display-contract.json",
];

/** テストがディレクトリ単位で列挙する入力資産。追加・削除も同じ分類にする。 */
export const TEST_INPUT_DIRECTORIES = ["documents/assets/ui-refresh"];

/** @deprecated TEST_INPUT_PATHS に改名。既存のimportとの互換性を保つ。 */
export const DOCUMENTATION_EXCEPTIONS = TEST_INPUT_PATHS;

/**
 * production バンドルにも E2E の対象にも入らないテスト専用資産。
 * これらだけが変わった場合、ブラウザ上の振る舞いは 1 バイトも変化しないため
 * E2E を実行する意味がない (`pnpm test` は `ci` job で実行されるので、
 * テスト自体の退行は引き続き検出される)。
 */
const UNIT_TEST_ONLY = [
  // `src/test/` には `*.test.ts` だけでなく、テストからだけ参照される共有ヘルパ
  // (`webLocksStub.ts` / `appRoutes.ts` / `bannerLandmarks.ts`)も置く。production の
  // Tailwind content graph も globals.css の `@source not "../test"` で同じ境界を除外する。
  /^src\/test\//,
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

/** @param {string} path */
const isTestInput = (path) =>
  TEST_INPUT_PATHS.includes(path) ||
  TEST_INPUT_DIRECTORIES.some(
    (directory) => path === directory || path.startsWith(`${directory}/`),
  );

/**
 * 1 パスを分類する。
 * @param {string} path
 * @returns {"e2e-asset" | "documentation" | "unit-test" | "code"}
 */
export function classifyPath(path) {
  if (matches(path, E2E_ASSET)) return "e2e-asset";
  if (isTestInput(path)) return "unit-test";
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
 *   既定ブランチの ci job として共有キャッシュを投入するか。dev / stg の cache は
 *   保存しないため、検証済み昇格 push で setup を行っても消費するだけで再利用されない。
 * @returns {{ setup: boolean, verify: boolean, quality: boolean, production: boolean, browser: boolean }}
 *   `verify`: この job の検証コマンド (ci の品質全体 / e2e) を実行するか。
 *   `quality`: ci のうち lint/typecheck/format/Vitest を実行するか。
 *   `production`: production graph/build/PWA E2E を実行するか。
 *   `browser`: Playwright browser を復元・導入するか (main の cache seed を含む)。
 *   `setup`: 依存を導入するか。
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
  // test-only は shipped tree を変更しない。品質に必要な静的検査と Vitest は
  // 維持する一方、production graph / build / browser / PWA E2E は省略する (#758)。
  // docs + test の混在は docsOnly=false なので quality は実行する。
  const quality = job === "ci" && !docsOnly && !postMergeDuplicate;
  const production =
    job === "ci" && !docsOnly && !unitTestOnly && !postMergeDuplicate;
  // マージ後 push は検証しない。既定ブランチの **ci job だけ**がキャッシュを投入する。
  // E2E job は Playwright の固定イメージを使い、現在はキャッシュを書き込まないため、
  // verify=false の post-merge E2E で依存を導入する理由がない (#569)。
  // Actions のキャッシュは既定ブランチ (main) で保存したものだけが全 PR から復元できるため
  // (#380)、main の ci run が導入を止めると全 PR が毎回ダウンロードし直しになる。
  const seed = job === "ci" && postMergeDuplicate && seedCaches;
  const browser = production || seed;
  return { setup: verify || seed, verify, quality, production, browser };
}

export const SCOPE_OUTPUT_KEYS = /** @type {const} */ ([
  "setup",
  "verify",
  "quality",
  "production",
  "browser",
]);

/** API / ref 取得が job 全体の timeout まで居座らないための上限。 */
export const EVIDENCE_IO_TIMEOUT_MS = 15_000;

/** 同名 check run から Actions run を引く際の一意な API 呼び出し数上限。 */
export const CHECK_RUN_EVIDENCE_MAX_LOOKUPS = 16;

/** 同名 check run の Actions run 照合に使う累積時間上限。 */
export const CHECK_RUN_EVIDENCE_TIMEOUT_MS = EVIDENCE_IO_TIMEOUT_MS;

/** GitHub API response を JSON 化する前に保持できる最大サイズ。 */
export const GITHUB_API_RESPONSE_MAX_BYTES = 1 * 1024 * 1024;

// GitHub Compare API は 1 ページ最大 100 件で、変更ファイルは最大 300 件まで返す。
// 上限に達した場合は一覧の完全性を証明できないため、変更パス判定を null に戻して
// 呼び出し側の fail-open (全検証) を選ぶ。
const COMPARE_FILES_PAGE_SIZE = 100;
const COMPARE_FILES_MAX_PAGES = 3;

/** 成功 check をこのワークフローの PR run に束縛する。 */
const TRUSTED_CHECK_APP = "github-actions";
const TRUSTED_WORKFLOW_PATH = ".github/workflows/ci.yml";

/**
 * @template T
 * @param {() => Promise<T>} operation
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
function withTimeout(operation, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("evidence lookup timed out")),
      timeoutMs,
    );
    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

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
  if (!isUsableSha(baseSha) || !isUsableSha(headSha)) return null;
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

/** @param {unknown} sha */
function isUsableSha(sha) {
  return (
    typeof sha === "string" &&
    /^[0-9a-f]{40}$/.test(sha) &&
    !/^0{40}$/.test(sha)
  );
}

/**
 * local git diff の代替として GitHub Compare API から変更パスを取得する (#567)。
 *
 * Actions の E2E job は Playwright container 内で別の partial checkout を使うため、
 * 同じ SHA の compare でも local git の object/ref 解決結果が job ごとに揺れることがある。
 * API のファイル一覧を使うことで、checkout の状態に依存しない immutable SHA の判定にする。
 * local `--no-renames` と同じ安全性を保つため、rename の旧パスも含める。
 *
 * @param {object} input
 * @param {string} input.repo `owner/name`
 * @param {string | undefined} input.baseSha
 * @param {string | undefined} input.headSha
 * @param {(path: string) => Promise<unknown>} input.api
 * @returns {Promise<string[] | null>}
 */
export async function changedPathsFromApi({ repo, baseSha, headSha, api }) {
  if (!isUsableSha(baseSha) || !isUsableSha(headSha)) return null;

  /** @type {string[]} */
  const paths = [];
  const seen = new Set();
  const append = (/** @type {unknown} */ value) => {
    if (typeof value !== "string" || value.length === 0) return false;
    if (!seen.has(value)) {
      seen.add(value);
      paths.push(value);
    }
    return true;
  };

  for (let page = 1; page <= COMPARE_FILES_MAX_PAGES; page += 1) {
    /** @type {any} */
    let comparison;
    try {
      comparison = await api(
        `/repos/${repo}/compare/${baseSha}...${headSha}?per_page=${COMPARE_FILES_PAGE_SIZE}&page=${page}`,
      );
    } catch {
      return null;
    }

    const files = comparison?.files;
    if (!Array.isArray(files)) return null;
    for (const file of files) {
      if (!append(file?.filename)) return null;
      // Compare API exposes the source path of a rename as previous_filename.
      // Include it even when status is omitted so the safety property does not
      // depend on an optional response field.
      if (
        file &&
        Object.prototype.hasOwnProperty.call(file, "previous_filename") &&
        !append(file.previous_filename)
      ) {
        return null;
      }
    }

    if (files.length < COMPARE_FILES_PAGE_SIZE)
      return paths.length > 0 ? paths : null;
    // GitHub documents a 300-file cap for Compare API. A full third page means
    // the complete list cannot be proven, so keep the fail-open behavior.
    if (page === COMPARE_FILES_MAX_PAGES) return null;
  }

  return null;
}

/**
 * local diff を優先し、container/partial clone で解決できないときだけ API に補完させる。
 * API も解決できなければ `unresolved` のままにして全検証を実行する。
 *
 * @param {object} input
 * @param {string} input.repo
 * @param {string | undefined} input.baseSha
 * @param {string | undefined} input.headSha
 * @param {(path: string) => Promise<unknown>} input.api
 * @param {(baseSha: string | undefined, headSha: string | undefined) => string[] | null} [input.local]
 * @returns {Promise<{ paths: string[] | null, source: "git" | "github-api" | "unresolved" }>}
 */
export async function resolveChangedPaths({
  repo,
  baseSha,
  headSha,
  api,
  local = changedPaths,
}) {
  let localPaths = null;
  try {
    localPaths = local(baseSha, headSha);
  } catch {
    // Treat injected or future local resolution failures the same as git's
    // existing fail-open behavior.
  }
  if (localPaths) return { paths: localPaths, source: "git" };

  const apiPaths = await changedPathsFromApi({
    repo,
    baseSha,
    headSha,
    api,
  });
  if (apiPaths) return { paths: apiPaths, source: "github-api" };
  return { paths: null, source: "unresolved" };
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
 * 4. 通常PRでは push 前の宛先 tip が PR head の祖先である。環境昇格では push 前の宛先 tip が
 *    **着地した commit の祖先**である。main→dev / dev→stg は環境固有の過去の履歴により
 *    分岐するため、merge commit の親配列を固定せず Compare API で fast-forward / rebase /
 *    squash を含む前進を検証する。任意 commit の混入は、source branch、PR checks、tree 一致
 *    の検証で防ぐ。
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
  // 証拠とする。check run の履歴は同じ Actions run を重複して含み得るため、run ID ごとに
  // 応答を再利用する。API が遅延・大量候補・不正な応答で job を占有し続けても、証拠を
  // 確認できない場合は従来どおり fail-closed (スキップしない) とする。
  const lookupDeadline = Date.now() + CHECK_RUN_EVIDENCE_TIMEOUT_MS;
  let workflowRunLookups = 0;
  let successfulEligibleRun = false;
  /** @type {Map<string, any>} */
  const workflowRunsById = new Map();
  for (const run of own) {
    if (run?.app?.slug !== TRUSTED_CHECK_APP) continue;
    const match = String(run?.details_url ?? "").match(
      /\/actions\/runs\/(\d+)(?:\/job\/\d+)?(?:[/?#]|$)/,
    );
    if (!match) return { skip: false, reason: "own-check-run-not-successful" };
    const runId = match[1];
    /** @type {any} */
    let workflowRun;
    if (workflowRunsById.has(runId)) {
      workflowRun = workflowRunsById.get(runId);
    } else {
      if (workflowRunLookups >= CHECK_RUN_EVIDENCE_MAX_LOOKUPS) {
        return { skip: false, reason: "own-check-run-not-successful" };
      }
      const remainingMs = lookupDeadline - Date.now();
      if (remainingMs <= 0) {
        return { skip: false, reason: "check-runs-api-failed" };
      }
      workflowRunLookups += 1;
      try {
        workflowRun = await withTimeout(
          () => api(`/repos/${repo}/actions/runs/${runId}`),
          remainingMs,
        );
      } catch {
        return { skip: false, reason: "check-runs-api-failed" };
      }
      workflowRunsById.set(runId, workflowRun);
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
      // A successful eligible run is decisive: later same-named checks cannot
      // make the existing any-success evidence less trustworthy.
      successfulEligibleRun = true;
      break;
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

  if (branch !== "main") {
    /** @type {any} */
    let comparison;
    try {
      comparison = await api(`/repos/${repo}/compare/${before}...${sha}`);
    } catch {
      return { skip: false, reason: "landed-ancestor-api-failed" };
    }
    // Promotion methods may produce a one-parent fast-forward/rebase commit or
    // a two-parent merge commit. Only the ancestry relation matters here; the
    // source branch, PR checks, and landed tree are verified independently.
    if (comparison?.status !== "ahead" && comparison?.status !== "identical") {
      return { skip: false, reason: "base-not-ancestor-of-landed-commit" };
    }
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
  if (!response.ok) {
    try {
      await response.body?.cancel?.();
    } catch {
      // Keep the HTTP failure as the useful error for fail-open callers.
    }
    throw new Error(`GitHub API ${path} -> ${response.status}`);
  }
  // Compare API の files 配列には巨大な patch が含まれ得るため、response.json()
  // の無制限バッファリングは使わない。上限超過・切断・不正JSONは呼び出し側の
  // changedPathsFromApi / resolvePostMergeEvidence が fail-open (全検証) に戻す。
  const contentLength = response.headers?.get?.("content-length");
  if (contentLength !== null && contentLength !== undefined) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > GITHUB_API_RESPONSE_MAX_BYTES
    ) {
      await response.body?.cancel();
      throw new Error(
        `GitHub API ${path} response body is too large or invalid`,
      );
    }
  }

  if (!response.body)
    throw new Error(`GitHub API ${path} response body is unavailable`);
  const reader = response.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array))
        throw new Error(`GitHub API ${path} response body is invalid`);
      totalBytes += value.byteLength;
      if (totalBytes > GITHUB_API_RESPONSE_MAX_BYTES) {
        await reader.cancel();
        throw new Error(`GitHub API ${path} response body is too large`);
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The original fetch/stream error is the useful failure for fail-open callers.
    }
    throw error;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
    });
  }

  const changed = await resolveChangedPaths({
    repo: String(process.env.GITHUB_REPOSITORY ?? ""),
    baseSha: process.env.SCOPE_BASE_SHA,
    headSha: process.env.SCOPE_HEAD_SHA,
    api: githubApi,
  });
  const paths = changed.paths;
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
    `changedPathsSource=${changed.source}`,
    paths
      ? `changedPaths=${paths.length}`
      : "changedPaths=unresolved (fail-open)",
    `setup=${scope.setup}`,
    `verify=${scope.verify}`,
    `quality=${scope.quality}`,
    `production=${scope.production}`,
    `browser=${scope.browser}`,
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
