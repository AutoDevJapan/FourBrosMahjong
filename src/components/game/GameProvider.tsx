"use client";

/**
 * 対局状態プロバイダ(スペック6 6.5 / 6.6 / 6.9)。
 *
 * React stateに実対局エンジン状態を保持し、同一タブの`sessionStorage`には
 * **seed + 検証済み操作履歴**を保存する。リロード時は通常のengine APIで履歴を再生するため、
 * Wall/RNG/台帳などのclassを不完全なJSONへ変換せず安全に復元できる。Storageの一時的な
 * 書き込み失敗ではジャーナルをメモリに保持し、復旧後の次の操作で再保存する。終局結果の
 * `localStorage` 保存が失敗した場合も、結果スナップショットを件数制限付きで
 * `sessionStorage` (使えない場合はプロバイダのメモリ)へ退避するため、「もう一半荘」で
 * 進行中ジャーナルへ置き換えても履歴を失わない(issue #892)。
 * `/game`(対局画面)と `/game/result`(結果画面)の間で同一インスタンスを共有する。`/game` 配下の
 * 共有レイアウト(`app/game/layout.tsx`)に配置することで、ページ遷移してもプロバイダは再生成されず
 * 半荘の状態(進行・精算・結果)が保たれる(スペック6 6.5 / 6.9)。
 *
 * 本プロバイダは engine 状態の「保持」と、UI へ渡す**表示ビュー**(`selectView`)・**操作**(controls)
 * の受け渡しを担う。席割り・親・ツモ配分・ウマ等の決定ロジック(Q9〜Q13)は engine が持ち、
 * UI は値を受け取って表示する構造を維持する(スペック6 6.8)。
 *
 * 永続範囲は同一タブのセッション内だけであり、バックエンド/複数デバイス同期は行わない。
 */
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { localStorageOrNull } from "@/components/common/browserStorage";
import { loadPlayerNames } from "@/components/settings/playerNames";
import {
  advanceDisplaySource,
  type LocalDisplaySource,
  newLocalDisplaySource,
} from "@/domain/display/displaySource";
import {
  createGame,
  DEFAULT_NAMES,
  type EngineState,
  type GamePhase,
  type Pending,
  type PlayerId,
  type PlayerNames,
  type RoundSummary,
} from "@/domain/game/engine";
import type { Tile } from "@/domain/tiles/tile";
import {
  applyGameAction,
  type GameAction,
  type GameJournal,
  loadJournal,
  replayJournal,
  saveJournal,
} from "./gamePersistence";
import { selectView, toTile } from "./gameView";
import {
  type MatchHistoryEntry,
  notifyHistoryChanged,
  persistHistoryAcrossTabs,
} from "./matchHistory";
import {
  forgetPendingHistory,
  loadPendingHistory,
  rememberPendingHistory,
} from "./pendingHistory";
import type { GameViewState, TileData } from "./types";

/** UI から呼べる対局操作。判定は engine 側が行う。 */
interface GameControls {
  /** 自家の打牌(表示手牌から選んだ牌)。 */
  readonly discard: (tile: TileData) => void;
  /** 自家のツモ切り(リーチ後にツモ和了しないとき)。 */
  readonly tsumogiri: () => void;
  /** 自家のリーチ宣言(宣言牌を切る)。 */
  readonly riichi: (tile: TileData) => void;
  /** 自家のツモ和了宣言。 */
  readonly tsumo: () => void;
  /** 自家のロン和了宣言。 */
  readonly ron: () => void;
  /** 自家のポン(直前の他家打牌に対して)。 */
  readonly pon: () => void;
  /** 自家の明槓(大明槓・直前の他家打牌に対して)。 */
  readonly kan: () => void;
  /** 自家の北抜き(自ツモ番・手牌またはツモ牌の北1枚)。 */
  readonly kita: () => void;
  /** 自家の暗槓(自ツモ番・指定牌種)。 */
  readonly ankan: (tile: TileData) => void;
  /** 自家の加槓(自ツモ番・既存ポンに4枚目)。 */
  readonly kakan: (tile: TileData) => void;
  /** 自家のロン/鳴き見送り(スルー)。 */
  readonly passRon: () => void;
  /** 局終了後、次局を開始する。 */
  readonly nextRound: () => void;
  /** 新規半荘を開始する(「もう一半荘」)。 */
  readonly newGame: () => void;
}

export interface GameContextValue {
  /** Local display adapter only; absent online until server-version integration. */
  readonly displaySource?: LocalDisplaySource;
  /** Read the synchronous committed revision, including before React rerenders. */
  readonly readDisplaySource?: () => LocalDisplaySource | undefined;
  /** この画面を操作している席。オンラインではserver snapshotの`you`。 */
  readonly playerId: PlayerId;
  /** host専用の局進行・次半荘操作を表示できるか。認可そのものはserverが行う。 */
  readonly isHost: boolean;
  /** 対局画面の表示ビューモデル。 */
  readonly view: GameViewState;
  /** 半荘のフェーズ(playing / roundEnd / gameEnd)。 */
  readonly phase: GamePhase;
  /** 期待する自家入力(打牌 / ロン)。無ければ null。 */
  readonly pending: Pending;
  /** 直前局の決着サマリ(未決着時は null)。 */
  readonly roundSummary: RoundSummary | null;
  /** 現在の半荘ジャーナルをこのタブの sessionStorage へ保存できた状態。 */
  readonly sessionSaveStatus: "idle" | "saved" | "failed";
  /** 現在の半荘結果をこの端末の戦績へ保存した状態。 */
  readonly historySaveStatus: "idle" | "pending" | "saved" | "failed";
  /** 安全な乱数が利用できず、新しい半荘を開始できなかった状態。 */
  readonly seedGenerationError: boolean;
  /** 対局操作。 */
  readonly controls: GameControls;
}

export const GameContext = createContext<GameContextValue | null>(null);

/**
 * 決定的再現用の乱数 seed を URL クエリ `?seed=<非負整数>` から読む(テスト専用フック)。
 *
 * E2E(状態駆動 a11y 監査など)が特定局面へ**決定的に**到達するための最小の状態注入口。
 * seed 付与時のみ `createGame({ seed })` で半荘を固定再現する。**本番挙動は変えない**:
 * - **通常の本番ビルドでは丸ごと無効**。エンドユーザーが
 *   `?seed` で壁・配牌を決定的再現し「良い配牌を引くまで seed を探す」等の完全性侵害をできないよう、
 *   production では `NEXT_PUBLIC_E2E_SEED_ENABLED=1` でビルドしたE2E専用成果物だけ許可する
 *   (サンマ賭博テーマの完全性 / #159 レビュー指摘、prod E2E parity / #432)。
 *   E2E は dev サーバ(`pnpm dev` = development)で走るため引き続き機能する。
 * - クエリ無し(通常導線の `/game`)は `null` を返し、既定の乱数半荘(`createGame()`)のまま。
 * - サーバ(`window` 不在)・非整数・負値は `null`(既定へフォールバック)。`?seed=1.5` の様な
 *   誤読(`>>>0` による 1 への丸め)を避けるため「非負整数」に厳格化する。
 * seed は盤面の牌列(乱数)を固定するだけで、席割り・進行規則・UI の分岐は一切変えない。
 */
export function deterministicSeedEnabled(
  nodeEnv: string | undefined,
  e2eSeedEnabled: string | undefined,
): boolean {
  return nodeEnv !== "production" || e2eSeedEnabled === "1";
}

const MAX_SEED = 0xffffffff;

interface SeedQuery {
  /** 決定的 seed 機能が有効な環境で `seed` クエリが明示されたか。 */
  readonly present: boolean;
  /** 有効な uint32 seed。不正な明示値は null。 */
  readonly value: number | null;
}

/**
 * URL の seed 値と「クエリが存在したか」を分離して読む。
 *
 * `null` だけではクエリ無しと不正値を区別できない。前者は既存ジャーナルを復元する
 * べきだが、後者は指定を無視して古い対局を復元せず、新しい乱数へフォールバックする。
 */
function seedQueryFromLocation(): SeedQuery {
  if (
    !deterministicSeedEnabled(
      process.env.NODE_ENV,
      process.env.NEXT_PUBLIC_E2E_SEED_ENABLED,
    )
  ) {
    // production の通常ビルドでは seed クエリ自体を機能対象外として扱う。
    return { present: false, value: null };
  }
  if (typeof window === "undefined") return { present: false, value: null };

  try {
    // Sandboxed or privacy-restricted hosts can expose `location` or the URL
    // parser while throwing when either is read or invoked. An explicit seed
    // is only an optional deterministic-test capability, so an unreadable URL
    // must behave like an absent query and leave the secure-random path intact.
    const params = new URLSearchParams(window.location.search);
    if (!params.has("seed")) return { present: false, value: null };
    const raw = params.get("seed");
    if (raw === null || raw.trim() === "") {
      return { present: true, value: null };
    }
    const seed = Number(raw);
    return Number.isSafeInteger(seed) && seed >= 0 && seed <= MAX_SEED
      ? { present: true, value: seed }
      : { present: true, value: null };
  } catch {
    return { present: false, value: null };
  }
}

export function seedFromLocation(): number | null {
  return seedQueryFromLocation().value;
}

/**
 * 暗号学的に安全な乱数源が利用できないときの固定エラー。
 *
 * 対局seedを `Date.now()` や `Math.random()` へフォールバックすると、開始時刻から
 * 牌山を推測できるため、利用者向けの乱数では予測可能な代替を許可しない。呼び出し側は
 * このエラーだけを復旧可能な「対局を開始できない」状態へ変換し、他の予期しない例外は
 * 通常どおり上位へ伝播させる。
 */
export class SecureRandomUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("A secure random source is unavailable", { cause });
    this.name = "SecureRandomUnavailableError";
  }
}

export const SECURE_RANDOM_UNAVAILABLE_MESSAGE =
  "安全な乱数を利用できないため、対局を開始できません。ブラウザの設定を確認してから再試行してください。";

/**
 * 通常対局の壁を決める、予測困難な uint32 seed を生成する。
 *
 * 時刻由来の seed は開始時刻から全牌順を総当たりできるため使わない。
 * Web Crypto はブラウザとサポート対象の Node.js の双方で利用できる。
 */
export function freshSeed(): number {
  try {
    // Optional browser capabilities can be absent or exposed through a
    // throwing accessor in embedded/privacy-restricted runtimes. Keep the
    // capability lookup and invocation in one boundary so callers can show a
    // recoverable fail-closed state instead of leaking a TypeError.
    const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
    const getRandomValues = cryptoApi?.getRandomValues;
    if (typeof getRandomValues !== "function") {
      throw new TypeError("Web Crypto getRandomValues is unavailable");
    }
    const values = new Uint32Array(1);
    getRandomValues.call(cryptoApi, values);
    return values[0];
  } catch (error) {
    if (error instanceof SecureRandomUnavailableError) throw error;
    throw new SecureRandomUnavailableError(error);
  }
}

/**
 * 終局(gameEnd)した半荘の表示値を戦績レコードへ変換する(issue #293)。
 *
 * `finishedAt` は最初に終局を観測した時点で固定する。保存が遅延しても、リロードや
 * `「もう一半荘」`後の再試行で同じ結果レコードを使い、履歴の時刻が書き換わらないようにする。
 */
function finishedHistoryEntry(
  engine: EngineState,
  seed: number,
): MatchHistoryEntry | null {
  if (engine.phase !== "gameEnd" || engine.result === null) return null;
  return {
    seed,
    finishedAt: Date.now(),
    players: engine.result.map((r) => ({
      name: r.name,
      rank: r.rank,
      rawScore: r.rawScore,
      uma: r.uma,
      bonus: r.bonus,
      soshiiTotal: r.soshiiTotal,
    })),
  };
}

/**
 * 終局した半荘の確定結果を戦績(`localStorage`)へ追記する(issue #293)。
 *
 * `entry.seed` はジャーナルの seed をそのまま半荘の識別子に使い、`persistHistory` 側の
 * 重複排除で「終局済みジャーナルのリロード再生」や退避結果の再試行による二重保存を防ぐ。
 * 実際に追記できたときは購読者へ通知する(issue #310)。永続化と通知は
 * `matchHistory.ts` 側で分離されているため、書き換えた側が明示的に知らせる。
 * **描画フェーズから呼んではならない**(通知が他コンポーネントの再描画を要求するため)。
 */
async function recordFinishedGame(
  entry: MatchHistoryEntry,
): Promise<"saved" | "failed"> {
  const storage = localStorageOrNull();
  if (storage === null) return "failed";
  const persisted = await persistHistoryAcrossTabs(storage, entry);
  if (persisted === "appended") notifyHistoryChanged();
  return persisted === "failed" ? "failed" : "saved";
}

/** Storage の getter 自体が SecurityError を投げる環境ではメモリ内対局へ退避する。 */
function sessionStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * `/settings` で保存された対局者名を読む(issue #291)。未設定・保存不可時は engine の既定名。
 *
 * 半荘の開始時にだけ読み、以後はジャーナルの `names` が正となる。これにより対局中に設定を
 * 変更しても進行中の半荘の表示名は変わらず、リロード後も同じ名前で復元される。
 */
function currentPlayerNames(): PlayerNames {
  const storage = localStorageOrNull();
  return storage === null ? DEFAULT_NAMES : loadPlayerNames(storage);
}

/** 新規半荘のジャーナルを作る。保存不可でも復旧後の再保存用にメモリへ保持する。 */
function newJournal(seed: number, names: PlayerNames): GameJournal {
  return { version: 3, seed, names, explicitKita: true, actions: [] };
}

/** `sessionStorage` が使えない場合も対局を継続し、状態だけを失敗として公開する。 */
function persistSessionJournal(
  storage: Storage | null,
  journal: GameJournal,
): "saved" | "failed" {
  return storage === null ? "failed" : saveJournal(storage, journal);
}

function initialSession(initialGame?: EngineState): {
  engine: EngineState;
  journal: GameJournal | null;
  historySaveStatus: GameContextValue["historySaveStatus"];
  sessionSaveStatus: GameContextValue["sessionSaveStatus"];
} {
  if (initialGame) {
    return {
      engine: initialGame,
      journal: null,
      sessionSaveStatus: "idle",
      historySaveStatus: "idle",
    };
  }
  const seedQuery = seedQueryFromLocation();
  const storage = sessionStorageOrNull();
  const stored = storage === null ? null : loadJournal(storage);
  if (
    stored &&
    (!seedQuery.present ||
      (seedQuery.value !== null && stored.seed === seedQuery.value))
  ) {
    try {
      const engine = replayJournal(stored);
      // v1/v2からの移行も新keyへだけ保存する。旧keyは旧client/rollback用に保持する。
      const sessionSaveStatus = persistSessionJournal(storage, stored);
      // 復元時の戦績追記(終局時の保存失敗の補完)はマウント効果側で行う(#310)。
      return {
        engine,
        journal: stored,
        sessionSaveStatus,
        historySaveStatus: engine.phase === "gameEnd" ? "pending" : "idle",
      };
    } catch {
      // 現在版engineで再生できない記録は新規対局へ安全にフォールバックする。
    }
  }
  const seed = seedQuery.value ?? freshSeed();
  const names = currentPlayerNames();
  const journal = newJournal(seed, names);
  return {
    engine: createGame({ seed, names }),
    journal,
    sessionSaveStatus: persistSessionJournal(storage, journal),
    historySaveStatus: "idle",
  };
}

export interface GameProviderProps {
  children: React.ReactNode;
  /** 初期エンジン状態(テスト/決定的再現用)。既定は新規半荘。 */
  initialGame?: EngineState;
}

type InitialSession = ReturnType<typeof initialSession> & {
  readonly displaySource: LocalDisplaySource;
};

function GameSeedUnavailable() {
  const retry = () => {
    try {
      window.location.reload();
    } catch {
      // The link below remains available if a host blocks reload().
    }
  };

  return (
    <main
      className="mx-auto flex min-h-[16rem] w-full max-w-2xl flex-col items-center justify-center gap-4 rounded-xl border border-control-border p-6 text-center"
      aria-labelledby="game-seed-error-heading"
    >
      <p className="text-sm font-semibold tracking-widest text-foreground/60">
        対局準備エラー
      </p>
      <h1 id="game-seed-error-heading" className="text-2xl font-bold">
        対局を開始できません
      </h1>
      <p role="alert" className="max-w-xl text-sm/6 text-foreground/80">
        {SECURE_RANDOM_UNAVAILABLE_MESSAGE}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          className="inline-flex min-h-11 items-center rounded-lg border border-control-border px-4 py-2 text-sm font-medium hover:bg-foreground/5"
          onClick={retry}
        >
          再試行
        </button>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-lg border border-control-border px-4 py-2 text-sm hover:bg-foreground/5"
        >
          ロビーへ戻る
        </Link>
      </div>
    </main>
  );
}

function createInitialSession(
  initialGame?: EngineState,
): InitialSession | null {
  try {
    return {
      ...initialSession(initialGame),
      displaySource: newLocalDisplaySource(),
    };
  } catch (error) {
    if (error instanceof SecureRandomUnavailableError) return null;
    throw error;
  }
}

interface GameProviderRuntimeProps {
  children: React.ReactNode;
  initial: InitialSession;
}

function GameProviderRuntime({ children, initial }: GameProviderRuntimeProps) {
  // 実対局の乱数状態はprovider外のlazy initializerで1度だけ生成する。SSR とクライアント
  // 初回描画の不一致は、盤面を描く `GameBoard` 側のマウントゲート(クライアントでのみ盤面を
  // 描画)で回避する。`initialGame`(単体テストの明示注入)を最優先し、次に URL の `?seed`
  // (E2E の決定的再現)、どちらも無ければ既定の乱数半荘。seed 経路は本番導線(クエリ無し)では
  // 発火しない。
  const [session, setSession] = useState(initial);
  // React が再レンダーする前に操作イベントが連続しても、必ず直前の確定 session から
  // 次の遷移を計算する。engine は Wall/RNG を含め入力を可変更新するため、レンダー時点の
  // session をクロージャから再利用するとライブ状態だけが二重に進み、journal と分岐する。
  const sessionRef = useRef(session);
  const displayActiveRef = useRef(true);
  useLayoutEffect(() => {
    displayActiveRef.current = true;
    return () => {
      displayActiveRef.current = false;
    };
  }, []);
  const readDisplaySource = useCallback(
    () =>
      displayActiveRef.current ? sessionRef.current.displaySource : undefined,
    [],
  );
  // `localStorage` の保存完了前に「もう一半荘」へ進んでも、結果を現行ジャーナルから
  // 切り離して保持する。sessionStorage にも書くが、Storage が使えない環境では同一
  // プロバイダの存続中だけでも回復できるようメモリを正とする(issue #892)。
  const [pendingHistory] = useState(
    () =>
      new Map(
        loadPendingHistory(sessionStorageOrNull()).map((entry) => [
          entry.seed,
          entry,
        ]),
      ),
  );
  const pendingHistoryAttemptsRef = useRef(new Set<number>());
  const [seedGenerationError, setSeedGenerationError] = useState(false);
  const persistPendingHistoryEntry = useCallback(
    (entry: MatchHistoryEntry, expectedJournal?: GameJournal) => {
      if (pendingHistoryAttemptsRef.current.has(entry.seed)) return;
      pendingHistoryAttemptsRef.current.add(entry.seed);
      void recordFinishedGame(entry).then((historySaveStatus) => {
        pendingHistoryAttemptsRef.current.delete(entry.seed);
        if (historySaveStatus === "saved") {
          forgetPendingHistory(
            pendingHistory,
            entry.seed,
            sessionStorageOrNull(),
          );
        }
        // 背景再試行は履歴だけを更新し、現在の新規対局の表示状態を変更しない。
        if (
          expectedJournal === undefined ||
          sessionRef.current.journal !== expectedJournal
        ) {
          return;
        }
        const nextSession = {
          ...sessionRef.current,
          historySaveStatus,
        };
        sessionRef.current = nextSession;
        setSession(nextSession);
      });
    },
    [pendingHistory],
  );
  const retryPendingHistory = useCallback(
    (excludeSeed?: number) => {
      for (const entry of pendingHistory.values()) {
        if (entry.seed !== excludeSeed) {
          persistPendingHistoryEntry(entry);
        }
      }
    },
    [pendingHistory, persistPendingHistoryEntry],
  );
  // 1回の描画で公開したUIから受け付ける遷移は1つだけにする。engine の1操作は
  // AI進行を含めて次の自家入力まで同期的に進み得るため、同じDOMへのダブルクリック等を
  // React commitまで直列化する。
  // accepted transition後は session identityが変わるため、旧renderのcontrolsも失効する。
  const transitionPendingRef = useRef(false);
  const { engine } = session;

  useLayoutEffect(() => {
    transitionPendingRef.current = false;
  }, [engine]);

  // 終局済みジャーナルを復元したときの戦績追記(終局時の保存失敗の補完)は、
  // 描画フェーズではなくマウント後の効果で行う(#310)。追記に伴う
  // `notifyHistoryChanged` は購読者の再描画を要求するため、`useState` の遅延初期化から
  // 呼ぶと「描画中に別コンポーネントを更新した」形になり、購読者の実装次第で React の
  // 警告や表示のずれ(tearing)を招く。描画は純粋に保ち、書き込みは効果側へ寄せる。
  // 初期 session だけを見たいので、以降の遷移で変わる `sessionRef` ではなく専用 ref を使う。
  const initialSessionRef = useRef<typeof session | null>(session);
  useEffect(() => {
    const initial = initialSessionRef.current;
    // 初回だけ使う参照なので、使い終えたら手放す。これにより最初の遷移後は初期半荘の
    // Wall/RNG が残らず、Strict Mode の効果2回実行でも2回目は早期 return になる
    // (重複追記は `appendHistory` の seed 重複排除でも防がれるため二重保存はしない)。
    initialSessionRef.current = null;
    if (initial !== null && initial.journal !== null) {
      const entry = finishedHistoryEntry(initial.engine, initial.journal.seed);
      if (entry !== null) {
        const pendingEntry = rememberPendingHistory(
          pendingHistory,
          entry,
          sessionStorageOrNull(),
        );
        persistPendingHistoryEntry(pendingEntry, initial.journal);
        retryPendingHistory(pendingEntry.seed);
        return;
      }
    }
    // 現在のジャーナルが新規対局でも、前回「もう一半荘」へ進んだ後に残った結果を再試行する。
    retryPendingHistory();
  }, [pendingHistory, persistPendingHistoryEntry, retryPendingHistory]);

  // engine の遷移は内部で `Wall` 等を可変更新するため、React Strict Mode で再実行され得る
  // 関数型 updater の中では実行しない。同期 ref 上で1度だけ遷移し、その確定値を state へ渡す。
  // ref は同一レンダー中の連続イベントにも即時反映され、engine と journal を同じ順序で進める。
  const controls = useMemo<GameControls>(() => {
    const renderSession = session;
    const canAccept = () =>
      !transitionPendingRef.current && sessionRef.current === renderSession;
    const markAccepted = () => {
      transitionPendingRef.current = true;
    };
    const commit = (action: GameAction) => {
      if (!canAccept()) return;
      const { engine, journal } = sessionRef.current;
      // Validate revision capacity before invoking the mutable engine. This
      // immutable stamp is published only if the engine accepts the action.
      const displaySource = advanceDisplaySource(
        sessionRef.current.displaySource,
      );
      const nextEngine = applyGameAction(engine, action);
      // engine が局面上不正な操作を同一 state の no-op として拒否した場合は、
      // 再生不能なイベントを journal に残さない。
      if (nextEngine === engine) return;
      markAccepted();
      // この操作で半荘が終局したら、確定結果を退避してから戦績へ追記する(issue #293 / #892)。
      const historyEntry =
        journal === null
          ? null
          : finishedHistoryEntry(nextEngine, journal.seed);
      const historySaveStatus =
        nextEngine.phase === "gameEnd"
          ? historyEntry === null
            ? "failed"
            : "pending"
          : sessionRef.current.historySaveStatus;
      if (journal === null) {
        const nextSession = {
          displaySource,
          engine: nextEngine,
          journal: null,
          sessionSaveStatus: sessionRef.current.sessionSaveStatus,
          historySaveStatus,
        };
        sessionRef.current = nextSession;
        setSession(nextSession);
        return;
      }
      const nextJournal: GameJournal = {
        ...journal,
        actions: [...journal.actions, action],
      };
      const storage = sessionStorageOrNull();
      const sessionSaveStatus = persistSessionJournal(storage, nextJournal);
      const nextSession = {
        displaySource,
        engine: nextEngine,
        journal: nextJournal,
        sessionSaveStatus,
        historySaveStatus,
      };
      // storage / React state より先に同期 ref を進め、同一 tick の次イベントを直列化する。
      sessionRef.current = nextSession;
      setSession(nextSession);
      if (historyEntry !== null) {
        const pendingEntry = rememberPendingHistory(
          pendingHistory,
          historyEntry,
          sessionStorageOrNull(),
        );
        persistPendingHistoryEntry(pendingEntry, nextJournal);
      }
    };
    const tileAction = (
      type: "discard" | "riichi" | "ankan" | "kakan",
      tile: Tile,
    ) => commit({ type, tile } as GameAction);
    return {
      discard: (tile) => tileAction("discard", toTile(tile)),
      tsumogiri: () => commit({ type: "tsumogiri" }),
      riichi: (tile) => tileAction("riichi", toTile(tile)),
      tsumo: () => commit({ type: "tsumo" }),
      ron: () => commit({ type: "ron" }),
      pon: () => commit({ type: "pon" }),
      kan: () => commit({ type: "kan" }),
      kita: () => commit({ type: "kita" }),
      ankan: (tile) => tileAction("ankan", toTile(tile)),
      kakan: (tile) => tileAction("kakan", toTile(tile)),
      passRon: () => commit({ type: "passRon" }),
      nextRound: () => commit({ type: "nextRound" }),
      newGame: () => {
        if (!canAccept()) return;
        const previous = sessionRef.current;
        if (
          previous.historySaveStatus !== "saved" &&
          previous.journal !== null
        ) {
          const entry = finishedHistoryEntry(
            previous.engine,
            previous.journal.seed,
          );
          if (entry !== null) {
            rememberPendingHistory(
              pendingHistory,
              entry,
              sessionStorageOrNull(),
            );
          }
        }
        let seed: number;
        try {
          seed = freshSeed();
        } catch (error) {
          if (error instanceof SecureRandomUnavailableError) {
            setSeedGenerationError(true);
            return;
          }
          throw error;
        }
        setSeedGenerationError(false);
        const storage = sessionStorageOrNull();
        // 「もう一半荘」は新しい半荘の開始なので、設定で変更された名前をここで取り込む。
        const names = currentPlayerNames();
        const nextJournal = newJournal(seed, names);
        const nextSession = {
          engine: createGame({ seed, names }),
          displaySource: newLocalDisplaySource(),
          journal: nextJournal,
          sessionSaveStatus: persistSessionJournal(storage, nextJournal),
          historySaveStatus: "idle" as const,
        };
        markAccepted();
        sessionRef.current = nextSession;
        setSession(nextSession);
        retryPendingHistory();
      },
    };
  }, [
    pendingHistory,
    persistPendingHistoryEntry,
    retryPendingHistory,
    session,
  ]);

  const value = useMemo<GameContextValue>(
    () => ({
      displaySource: session.displaySource,
      readDisplaySource,
      playerId: "p0",
      isHost: true,
      view: selectView(engine),
      phase: engine.phase,
      pending: engine.pending,
      roundSummary: engine.lastRound,
      sessionSaveStatus: session.sessionSaveStatus,
      historySaveStatus: session.historySaveStatus,
      seedGenerationError,
      controls,
    }),
    [
      session.displaySource,
      readDisplaySource,
      engine,
      seedGenerationError,
      session.sessionSaveStatus,
      session.historySaveStatus,
      controls,
    ],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function GameProvider({ children, initialGame }: GameProviderProps) {
  // Seed generation happens in a lazy initializer so a normal game still has
  // one stable seed. A missing secure RNG is converted to a local recovery
  // surface before the runtime provider mounts; no predictable fallback is
  // ever written to the session journal.
  const [initial] = useState(() => createInitialSession(initialGame));
  if (initial === null) return <GameSeedUnavailable />;
  return (
    <GameProviderRuntime initial={initial}>{children}</GameProviderRuntime>
  );
}

/** 対局状態・操作にアクセスする。`GameProvider` の外で呼ぶとエラー。 */
export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (ctx === null) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return ctx;
}
