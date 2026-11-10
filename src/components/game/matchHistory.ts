/**
 * 対局履歴(戦績)の `localStorage` 永続化(issue #293)。
 *
 * 半荘終了時の確定結果(最終順位・素点/ウマ・オカ/役満祝儀のソシー内訳・終了日時)を
 * 端末ローカルへ追記保存し、`/history`(戦績画面)で新しい順に閲覧できるようにする。
 * バックエンドは持たずクライアント完結(スペック6 6.9)。保存するのは
 * **確定済みの表示値のみ**であり、順位決定・精算ロジック(スペック3)は一切含めない。
 *
 * `sessionStorage` のジャーナル(`gamePersistence.ts`)と同様に、読み込み時は
 * 形状を厳密検証し、件数・容量に上限を設けて巨大入力や破損データから防御する。
 */
import { localStorageOrNull } from "@/components/common/browserStorage";
import {
  hasDisallowedPlayerNameControls,
  isWellFormedPlayerName,
} from "@/lib/playerName";
import { hasOnlyKeys } from "./gamePersistence";

/** `localStorage` の保存キー。形式変更時は version を上げて別キーにする。 */
export const MATCH_HISTORY_KEY = "four-bros-mahjong.history.v1";
const VERSION = 1;
/** 保存する半荘結果の最大件数。超過時は最古(末尾)から破棄する。 */
export const MAX_HISTORY_ENTRIES = 20;
/**
 * `localStorage` 由来の文字列はメインスレッドで同期 parse される。JSON.parse 前に
 * UTF-16 の保存量(1 code unit = 2 bytes)を制限し、巨大入力による描画停止を防ぐ
 * (`gamePersistence.ts` の `MAX_JOURNAL_BYTES` と同じ防御)。
 */
export const MAX_HISTORY_BYTES = 128 * 1024;

/** 4兄弟のうち1人分の確定済みソシー内訳(`ResultPlayerView` と同形の保存用スナップショット)。 */
interface MatchHistoryPlayer {
  readonly name: string;
  /** 最終順位(1〜4)。 */
  readonly rank: number;
  /** ① 素点(スペック3 3.3①)。 */
  readonly rawScore: number;
  /** ② ウマ+オカ(1位のみオカを含む / スペック3 3.3②)。 */
  readonly uma: number;
  /** ③ 役満祝儀(スペック3 3.3③)。 */
  readonly bonus: number;
  /** ソシー合計(= rawScore + uma + bonus)。 */
  readonly soshiiTotal: number;
}

/** 半荘1回分の戦績レコード。 */
export interface MatchHistoryEntry {
  /**
   * 半荘のジャーナル seed(uint32)。終局済みジャーナルをリロード再生した際に
   * 同一半荘を二重保存しないための識別子として使う(終局後の値なので公開しても
   * 対局の完全性には影響しない)。
   */
  readonly seed: number;
  /** 半荘終了日時(epoch ミリ秒)。 */
  readonly finishedAt: number;
  /**
   * 4兄弟全員の確定内訳。配列順は engine の固定順 p0→p3。
   *
   * v1 を読む旧クライアントとの共存・rollback互換のため playerId は保存しない。
   * 表示時だけこの既存順序から固定IDを復元する。
   */
  readonly players: readonly MatchHistoryPlayer[];
}

/** 4兄弟の人数(保存レコードの `players` 長の不変条件)。 */
const PLAYER_COUNT = 4;
/**
 * 想定外に長い名前(改竄・破損)を拒否する上限(UTF-16 code unit)。
 *
 * ユーザー設定の上限は12**書記素クラスタ**(`MAX_PLAYER_NAME_LENGTH` / #291, #484)。
 * 1書記素は ZWJ列や tag sequence で十数 code unit になり得る(家族絵文字1つ = 11、
 * tag sequence の地域旗1つ = 14)ため、書記素数から code unit 数は一意に決まらない。
 * 12書記素がどんな構成でも確実に収まる余裕として 12×32 を取る。
 *
 * 設定側の上限そのものは**意図的にここへ持ち込まない**。戦績は確定済みの表示
 * スナップショットであり、設定フォームの入力規則を再適用する場所ではない。
 * `MAX_PLAYER_NAME_LENGTH` を将来下げたときに保存済みの戦績が全件無効化される
 * (`parseHistory` が null を返し `loadHistory` が保存キーごと削除する)のを避ける。
 */
const MAX_NAME_LENGTH = 12 * 32;
/**
 * `Date` が表現できる epoch ミリ秒の上限(±8.64e15)。
 * `Number.isSafeInteger` だけでは 2^53-1 まで通ってしまい、`new Date()` が
 * Invalid Date になって `Intl.DateTimeFormat.format` が `RangeError` を投げる。
 * 壊れた1件で戦績ページ全体が描画不能になるため、読み込み時点で弾く。
 */
const MAX_TIMESTAMP = 8_640_000_000_000_000;

function isPlayer(value: unknown): value is MatchHistoryPlayer {
  if (!value || typeof value !== "object") return false;
  const player = value as Record<string, unknown>;
  return (
    hasOnlyKeys(player, [
      "name",
      "rank",
      "rawScore",
      "uma",
      "bonus",
      "soshiiTotal",
    ]) &&
    typeof player.name === "string" &&
    player.name.length > 0 &&
    player.name.length <= MAX_NAME_LENGTH &&
    isWellFormedPlayerName(player.name) &&
    !hasDisallowedPlayerNameControls(player.name) &&
    Number.isInteger(player.rank) &&
    Number(player.rank) >= 1 &&
    Number(player.rank) <= PLAYER_COUNT &&
    Number.isSafeInteger(player.rawScore) &&
    Number.isSafeInteger(player.uma) &&
    Number.isSafeInteger(player.bonus) &&
    Number.isSafeInteger(player.soshiiTotal)
  );
}

function isEntry(value: unknown): value is MatchHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(entry, ["seed", "finishedAt", "players"]) ||
    !Number.isSafeInteger(entry.seed) ||
    Number(entry.seed) < 0 ||
    Number(entry.seed) > 0xffffffff
  ) {
    return false;
  }
  return isMatchHistoryResult(value);
}

/** Shared result validation; each version validates its own identity and keys. */
export function isMatchHistoryResult(
  value: unknown,
): value is Omit<MatchHistoryEntry, "seed"> {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(entry.finishedAt) ||
    Number(entry.finishedAt) < 0 ||
    Number(entry.finishedAt) > MAX_TIMESTAMP ||
    !Array.isArray(entry.players) ||
    entry.players.length !== PLAYER_COUNT ||
    !entry.players.every(isPlayer)
  ) {
    return false;
  }
  // 順位は 1〜4 が重複なく揃う(engine の厳密順位決定 Q19/Q20 の不変条件)。
  const ranks = new Set(entry.players.map((p) => p.rank));
  if (ranks.size !== PLAYER_COUNT) return false;
  // 名前の一意性は**検証しない**。対局者名はユーザーが自由に設定でき(issue #291 /
  // スペック6 6.2.1)、4人に同じ名前を付けることを禁止していないため。表示側の
  // React key には名前ではなく一意性を検証済みの rank を使う。
  // ソシー合計は内訳の総和と一致する(engine の不変条件: engine.test.ts)。
  return entry.players.every(
    (p) => p.rawScore + p.uma + p.bonus === p.soshiiTotal,
  );
}

/** 保存文字列を検証付きで戦績配列(新しい順)へ復元する。破損時は null。 */
export function parseHistory(raw: string): readonly MatchHistoryEntry[] | null {
  if (raw.length * 2 > MAX_HISTORY_BYTES) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      !hasOnlyKeys(value, ["version", "entries"]) ||
      value.version !== VERSION ||
      !Array.isArray(value.entries) ||
      value.entries.length > MAX_HISTORY_ENTRIES ||
      !value.entries.every(isEntry)
    ) {
      return null;
    }
    const entries = value.entries as readonly MatchHistoryEntry[];
    // `seed` is the persisted match identity and `persistHistory` refuses to
    // append it twice. Treat a duplicate as corrupt rather than rendering the
    // same logical match more than once from imported or manually edited data.
    if (new Set(entries.map((entry) => entry.seed)).size !== entries.length) {
      return null;
    }
    return entries;
  } catch {
    return null;
  }
}

/**
 * 保存済み戦績(新しい順)を読み込む。未保存・破損・読み込み不可は空配列。
 * 破損データはジャーナルと同様、次回以降のために削除しておく。
 */
export function loadHistory(storage: Storage): readonly MatchHistoryEntry[] {
  try {
    const raw = storage.getItem(MATCH_HISTORY_KEY);
    if (raw === null) return [];
    const entries = parseHistory(raw);
    if (entries === null) {
      storage.removeItem(MATCH_HISTORY_KEY);
      return [];
    }
    return entries;
  } catch {
    return [];
  }
}

function save(storage: Storage, entries: readonly MatchHistoryEntry[]): void {
  storage.setItem(
    MATCH_HISTORY_KEY,
    JSON.stringify({ version: VERSION, entries }),
  );
}

/**
 * 戦績追記の詳細結果。GameProvider は「既に保存済み」と「保存失敗」を区別して
 * 結果画面へ正しい状態を渡す必要があるため、boolean 版とは別に公開する(#358)。
 */
export type HistoryPersistenceResult = "appended" | "already-exists" | "failed";

/** Web Locks で使う origin 内共通名。戦績 JSON の read-modify-write 全体を直列化する。 */
const MATCH_HISTORY_LOCK = "four-bros-mahjong.history.write.v1";

/**
 * lock 取得を諦めるまでの上限時間(ms)。追記・削除で共通(issue #488)。
 *
 * `navigator.locks.request` は待ち時間の上限を持たないため、別タブがフリーズした・
 * bfcache へ入った等で lock を保持し続けると、追記も削除も永遠に完了しない。
 *
 * 正常系の保持時間は「localStorage の getItem → JSON.parse → setItem」1往復ぶん
 * (128KB 上限 = ミリ秒未満)であり、この値はその数千倍にあたる。したがって
 * ここに到達するのは競合ではなく異常事態であり、待たせ続けるより失敗として
 * 案内した方が利用者は次の行動(タブを閉じる・再試行)を選べる。
 */
export const HISTORY_LOCK_TIMEOUT_MS = 3_000;

/**
 * `navigator.locks.request` の options のうち、この実装が使う部分。
 *
 * 実 API は `mode` / `ifAvailable` / `steal` も取るが、戦績の排他は「排他モードで
 * 上限時間つきに待つ」以外を必要としないため `signal` だけをモデル化する。
 * `signal` の中断は**待機中にのみ**効き、lock 取得後の中断は無視される(実 API と同じ)。
 */
export interface HistoryLockOptions {
  readonly signal: AbortSignal;
}

/**
 * テストで決定的な lock manager を注入できる最小インターフェース。
 *
 * 実 API と同じ options 形式(`request(name, options, callback)`)で受ける。
 * 2引数形式しか表現できないと `signal` を渡す先が無く、上限時間を持てない(#488)。
 */
export interface HistoryLockManager {
  request<T>(
    name: string,
    options: HistoryLockOptions,
    callback: () => T | PromiseLike<T>,
  ): Promise<T>;
}

/**
 * 排他区間に使う lock manager を決める。
 *
 * 引数省略時はこのブラウザの Web Locks を使い、非対応(secure context 外を含む)なら
 * `null` を返す。明示的に `null` を渡した場合はそのまま `null`(= 排他不能)とする。
 * 追記と削除で解決規則が食い違うと片方だけが lock 外へ漏れるため、両者で共有する。
 */
export function resolveLockManager(
  locks: HistoryLockManager | null | undefined,
): HistoryLockManager | null {
  if (locks !== undefined) return locks;
  try {
    if (typeof navigator === "undefined") return null;
    // Optional Web APIs may be exposed through a throwing accessor in embedded or
    // privacy-restricted runtimes. Treat an unreadable capability as unavailable,
    // just like an absent one, so the public persistence result contract is kept.
    const browserLocks = navigator.locks;
    return browserLocks === undefined
      ? null
      : (browserLocks as HistoryLockManager);
  } catch {
    return null;
  }
}

/**
 * 戦績 lock の排他区間で `callback` を実行する。取得できないまま
 * `HISTORY_LOCK_TIMEOUT_MS` を過ぎたら待機を中断し、`onUnavailable()` の値を返す(#488)。
 *
 * 中断は `AbortSignal` で行う。`AbortSignal.timeout` ではなく `AbortController` +
 * `setTimeout` を使うのは、テストが偽タイマーで上限時間そのものを決定的に固定できる
 * ようにするため(`AbortSignal.timeout` の内部タイマーは差し替えられない)。
 *
 * **上限時間は「取得できるまで」にだけ掛ける。** lock を取得した時点(callback の先頭)で
 * タイマーを解除するので、排他区間の実行が上限時間より長引いても中断されない。仕様上は
 * 取得後の abort が無視されるため `finally` の解除だけでも足りるが、取得と上限時間が
 * 競り合った瞬間の挙動を実装依存にしない ─ もし取得後の abort で要求が失敗する実装が
 * あると、削除は「消えているのに失敗として案内する」最悪の形になる。
 * `finally` の解除は取得できなかった経路のために残す。
 */
export async function withHistoryLock<T>(
  lockManager: HistoryLockManager,
  callback: () => T,
  onUnavailable: () => T,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new DOMException(
        `history lock was not acquired within ${HISTORY_LOCK_TIMEOUT_MS}ms`,
        "TimeoutError",
      ),
    );
  }, HISTORY_LOCK_TIMEOUT_MS);
  try {
    return await lockManager.request(
      MATCH_HISTORY_LOCK,
      { signal: controller.signal },
      () => {
        // 取得できた = 上限時間の役目は終わり。以降は中断しない。
        clearTimeout(timer);
        return callback();
      },
    );
  } catch {
    // 中断(上限時間超過)と lock API 自体の失敗を同じ「排他できなかった」に畳む。
    // callback は例外を投げない(内部で握り潰す)ため、ここへ来るのは取得側の失敗のみ。
    return onUnavailable();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 半荘結果を戦績の先頭(最新)へ追記する。
 *
 * - 保存前に読み込みと同じ検証をかけ、`parseHistory` が受理できない値は書き込まない。
 *   書き込めてしまうと次回読み込みで全体が破損扱いになり、過去の記録ごと消える
 *   (`?seed=` で uint32 超の seed を与えた非production対局などが実際に該当する)。
 * - 同一 seed の記録が既にあれば何もしない(終局済みジャーナルのリロード再生対策)。
 * - `MAX_HISTORY_ENTRIES` を超える分は最古から破棄する。
 * - 保存容量が不足した場合は件数を半減させながら再試行し、**保存できる範囲の履歴を
 *   最大限残す**(最新結果を最優先しつつ、過去の記録を不必要に全消ししない)。
 *   1件でも保存できない環境では諦める(対局自体は継続できる)。
 *
 * 追記できたかを返す(`clearHistory` と同じく返り値で成否を伝える)。呼び出し側はこの返り値を見て
 * `notifyHistoryChanged()` を呼び、購読者へ通知する(issue #310)。検証を通らない値と
 * 保存失敗は `"failed"`、重複 seed は `"already-exists"` で、いずれも追記しない。
 *
 * 保証は**片方向**である ─ `"appended"` なら保存内容は必ず変化しているが、それ以外は
 * 「変化していない」を意味しない。破損データが残っていた場合、`loadHistory` が
 * その削除を行った上で追記に失敗し得る。ただしこのとき購読者から見える値は前後とも
 * 空配列(破損データは `getHistorySnapshot` でも空に落ちる)なので、通知の取りこぼしにはならない。
 *
 * **排他制御を持たない下位API。** 複数タブから呼ぶと read-modify-write が競合するため、
 * アプリからは `persistHistoryAcrossTabs` を使う。
 */
export function persistHistory(
  storage: Storage,
  entry: MatchHistoryEntry,
): HistoryPersistenceResult {
  if (!isEntry(entry)) return "failed";
  try {
    const entries = loadHistory(storage);
    if (entries.some((existing) => existing.seed === entry.seed)) {
      return "already-exists";
    }
    let next = [entry, ...entries].slice(0, MAX_HISTORY_ENTRIES);
    // 半減で切り詰めるため試行回数は log2(MAX_HISTORY_ENTRIES) 程度に収まる。
    for (;;) {
      try {
        save(storage, next);
        return "appended";
      } catch {
        if (next.length <= 1) return "failed";
        next = next.slice(0, Math.max(1, Math.floor(next.length / 2)));
      }
    }
  } catch {
    // 保存不可でも対局・画面表示は継続する。
    return "failed";
  }
}

/**
 * 複数タブで安全に戦績を追記する。
 *
 * `localStorage` の get/set 単体は同期でも、その間の read-modify-write は原子的でない。
 * Web Locks の origin 内排他区間へ `persistHistory` 全体を入れ、別タブの終局結果を古い
 * スナップショットで上書きしない。lock API が無い・取得処理が失敗した場合は、保存成功を
 * 偽らず `failed` とする。GameProvider は既存の復旧導線（終局 journal の再読込）と
 * 保存失敗表示を維持するため、無排他の危険な書き込みへはフォールバックしない。
 *
 * **追記の fail-closed は削除の fail-open(`clearHistoryAcrossTabs` / ADR-0004)の前提**
 * である。排他 API が無いオリジンでは追記が一切成功しないからこそ、同じ環境の削除には
 * 競合する writer が存在しない。ここを fail-open へ変えるなら削除側も見直すこと。
 *
 * 別タブが lock を保持し続ける場合は `HISTORY_LOCK_TIMEOUT_MS` で待機を打ち切り `failed`
 * とする(#488)。終局済みジャーナルは残るため、リロード復元時に同じ seed で再追記される。
 */
export async function persistHistoryAcrossTabs(
  storage: Storage,
  entry: MatchHistoryEntry,
  locks?: HistoryLockManager | null,
): Promise<HistoryPersistenceResult> {
  const lockManager = resolveLockManager(locks);
  if (lockManager === null) return "failed";
  return withHistoryLock(
    lockManager,
    () => {
      const result = persistHistory(storage, entry);
      if (result === "failed") return result;
      // lock callback 内で再読込し、自分の結果が実際に残っている場合だけ成功を返す。
      return loadHistory(storage).some(
        (existing) => existing.seed === entry.seed,
      )
        ? result
        : "failed";
    },
    () => "failed",
  );
}

/** 保存内容を実際に追記した場合だけ true を返す従来API。 */
export function appendHistory(
  storage: Storage,
  entry: MatchHistoryEntry,
): boolean {
  return persistHistory(storage, entry) === "appended";
}

/**
 * 保存済み戦績をすべて消去する。消去できたかを返す(Storage 無効等では `false`)。
 *
 * 返り値で成否を伝えるのは `savePlayerNames` と同じ方針。呼び出し側は「削除しました」と
 * いう通知を実態と食い違わせずに出し分けられる。
 *
 * **排他制御を持たない下位API。** UI から呼ぶと別タブの終局保存と競合するため、画面からは
 * `clearHistoryAcrossTabs` を使う(`persistHistory` と `persistHistoryAcrossTabs` の関係と同じ)。
 */
export function clearHistory(storage: Storage): boolean {
  try {
    storage.removeItem(MATCH_HISTORY_KEY);
    return true;
  } catch {
    // 消去不可(Storage 無効等)でも画面表示は継続できるため、例外は投げない。
    return false;
  }
}

/**
 * 全件削除の結果。失敗は理由で区別する(issue #489)。
 *
 * 「排他できなかった」と「ストレージを操作できなかった」では利用者が取るべき行動が
 * 違う(前者は他タブを閉じて再試行、後者はブラウザのストレージ設定の確認)ため、
 * boolean へ畳まず理由を返す。
 */
export type HistoryClearResult =
  /** 削除して、読み戻しても空であることを確認できた。 */
  | "cleared"
  /** lock を取得できなかった(別タブが保持中 / 上限時間超過)。保存内容は変えていない。 */
  | "lock-busy"
  /** `removeItem` が失敗した、または削除後も履歴が残っている。 */
  | "storage-failed";

/**
 * 戦績を消去し、読み戻して実際に空になったことまで確認する。
 *
 * `removeItem` が例外を投げずに無視される Storage でも「削除しました」と案内しない。
 * 例外は内部で握り潰すため、この関数は決して throw しない(排他区間の callback として
 * 使うため。`withHistoryLock` の catch が lock 失敗と混ざらないようにする)。
 */
function clearAndVerify(storage: Storage): HistoryClearResult {
  if (!clearHistory(storage)) return "storage-failed";
  try {
    // `loadHistory` は画面表示用に読み込み例外を空配列へ縮退する。その結果を
    // 削除検証へ使うと、removeItem 後に権限が失われて getItem が SecurityError を
    // 投げた場合も「空になった」と誤認してしまう。成功通知の根拠にする読み戻しは
    // 生の保存値を確認し、読めないことを空であることと区別する。
    return storage.getItem(MATCH_HISTORY_KEY) === null
      ? "cleared"
      : "storage-failed";
  } catch {
    return "storage-failed";
  }
}

/**
 * 複数タブの終局保存と競合せずに戦績を全件削除する。
 *
 * 追記と同じ Web Lock に参加し、writer が読んだ古い snapshot から削除済み履歴を
 * 復活させる lost update を防ぐ(#482)。lock を取得できなかった場合は削除成功を
 * 偽らず `"lock-busy"` を返す ─ 別タブが現に保持している可能性があるため
 * (別タブが保持し続ける場合は `HISTORY_LOCK_TIMEOUT_MS` で待機を打ち切る / #488)。
 *
 * **例外は「Web Locks API そのものが無い環境」**(非セキュアコンテキスト = 平文 http)。
 * このときだけ lock 無しで削除する(fail-open / ADR-0004 / #489)。根拠:
 *
 * - secure context の判定はオリジン単位で、`localStorage` の分離単位も同じオリジン。
 *   つまり同じ戦績を共有するタブは全て同じ判定になる。
 * - `navigator.locks` が無いオリジンでは `persistHistoryAcrossTabs` が必ず `"failed"`
 *   を返す(追記は fail-closed のまま)。したがって**削除と競合する writer は存在し得ない**。
 * - 削除はユーザーが明示要求する操作であり、排他できないことを理由に拒み続けると
 *   「自分のデータを消せない」状態が固定される。
 *
 * この安全性は追記側の fail-closed に依存する。追記を fail-open へ変える場合は
 * ここも同時に見直すこと(ADR-0004)。
 */
export async function clearHistoryAcrossTabs(
  storage: Storage,
  locks?: HistoryLockManager | null,
): Promise<HistoryClearResult> {
  const lockManager = resolveLockManager(locks);
  if (lockManager === null) return clearAndVerify(storage);
  return withHistoryLock(
    lockManager,
    // lock 内で読み直し、実際に空になった場合だけ成功を返す(追記側と対称)。
    () => clearAndVerify(storage),
    () => "lock-busy",
  );
}

// ---------------------------------------------------------------------------
// 外部ストア購読(`useSyncExternalStore` 用) — issue #302
//
// `localStorage` は React の外にある可変ストアなので、描画中(`useMemo`)に読むのでは
// なく `useSyncExternalStore` で購読する(`playerNames.ts` / `ThemeToggle` と同じ方式)。
//
// `getSnapshot` は React が「いつ・何度呼んでもよい」純粋関数でなければならないため、
// **破損データの削除(`loadHistory` の `removeItem`)は行わない**。削除は描画後に走る
// `subscribe`(= `useSyncExternalStore` の効果)側の責務とする。
// ---------------------------------------------------------------------------

const subscribers = new Set<() => void>();
// Cross-tab storage events are optional. This flag prevents a failed cleanup
// from causing duplicate listeners while still allowing registration retries
// after a registration failure.
let storageListenerAttached = false;
/** 空の結果は常に同一参照で返す(`getSnapshot` の参照安定性 = 無限再描画の防止)。 */
const EMPTY_HISTORY: readonly MatchHistoryEntry[] = Object.freeze([]);
/** 直近に解析した保存文字列と、その解析結果(同値なら同一参照を返すためのキャッシュ)。 */
let cachedRaw: string | null = null;
let cachedEntries: readonly MatchHistoryEntry[] = EMPTY_HISTORY;

/** `/history` が未保存・破損・読取失敗を混同しないための表示専用snapshot。 */
export type HistoryViewSnapshot =
  | {
      readonly status: "ready";
      readonly entries: readonly MatchHistoryEntry[];
    }
  | { readonly status: "corrupt-cleaned" | "corrupt-retained" }
  | { readonly status: "read-error" };

const EMPTY_HISTORY_VIEW: HistoryViewSnapshot = Object.freeze({
  status: "ready",
  entries: EMPTY_HISTORY,
});
const CORRUPT_CLEANED_HISTORY_VIEW: HistoryViewSnapshot = Object.freeze({
  status: "corrupt-cleaned",
});
const CORRUPT_RETAINED_HISTORY_VIEW: HistoryViewSnapshot = Object.freeze({
  status: "corrupt-retained",
});
const READ_ERROR_HISTORY_VIEW: HistoryViewSnapshot = Object.freeze({
  status: "read-error",
});
let cachedViewRaw: string | null | undefined;
let cachedHistoryView: HistoryViewSnapshot = EMPTY_HISTORY_VIEW;
// `subscribeHistory` が破損v1をcleanupした直後に「未保存」へ落とさず、
// そのmount中は何が起き、保存値を削除したかを利用者へ伝える。
let latchedCorruptView: "corrupt-cleaned" | "corrupt-retained" | null = null;

/**
 * Notify each external-store consumer independently.
 *
 * React normally supplies callbacks that do not throw, but the store also has
 * direct same-tab and cross-tab notification entry points. A consumer failure
 * must not abort the remaining subscribers or turn a completed persistence
 * operation into an uncaught async rejection.
 */
function notifySubscribers(): void {
  for (const callback of subscribers) {
    try {
      callback();
    } catch {
      // Subscriber failures are isolated from persistence and other consumers.
    }
  }
}

function invalidateHistoryViewSnapshot(): void {
  cachedViewRaw = undefined;
  cachedHistoryView = EMPTY_HISTORY_VIEW;
  latchedCorruptView = null;
}

function corruptView(
  status: "corrupt-cleaned" | "corrupt-retained",
): HistoryViewSnapshot {
  return status === "corrupt-cleaned"
    ? CORRUPT_CLEANED_HISTORY_VIEW
    : CORRUPT_RETAINED_HISTORY_VIEW;
}

/**
 * 効果/event handlerからだけ呼ぶ破損v1 cleanup。snapshot/renderからは呼ばない。
 * removeItemが例外・no-op・削除後の読み戻し不能のときは「削除済み」を騙らない。
 */
function cleanupCorruptHistory(
  storage: Storage,
): "none" | "cleaned" | "retained" | "read-error" {
  let raw: string | null;
  try {
    raw = storage.getItem(MATCH_HISTORY_KEY);
  } catch {
    return "read-error";
  }
  if (raw === null || parseHistory(raw) !== null) return "none";
  try {
    storage.removeItem(MATCH_HISTORY_KEY);
    return storage.getItem(MATCH_HISTORY_KEY) === null ? "cleaned" : "retained";
  } catch {
    return "retained";
  }
}

function latchCleanupResult(
  result: ReturnType<typeof cleanupCorruptHistory>,
): void {
  if (result !== "cleaned" && result !== "retained") return;
  latchedCorruptView =
    result === "cleaned" ? "corrupt-cleaned" : "corrupt-retained";
  cachedViewRaw = undefined;
  cachedHistoryView = corruptView(latchedCorruptView);
}

function onStorageEvent(event: StorageEvent): void {
  // key === null は「別タブが clear() した」を意味する(全キーが対象)。
  if (event.key === MATCH_HISTORY_KEY || event.key === null) {
    // event callbackは描画外の効果経路。外部から入った破損値もここで
    // cleanupし、「削除した」表示と実際のkeyを一致させる。
    invalidateHistoryViewSnapshot();
    const storage = localStorageOrNull();
    if (storage !== null) latchCleanupResult(cleanupCorruptHistory(storage));
    notifySubscribers();
  }
}

/**
 * 保存内容を変更したことを購読者へ知らせる。
 *
 * 永続化API(`persistHistoryAcrossTabs` / `clearHistoryAcrossTabs` とその下位API)は
 * `Storage` を引数に取る入出力に留め、モジュールグローバルなストアへの通知はこの関数に
 * 分離している(責務の分離)。
 *
 * 追記・削除のどちらの経路でも、**保存内容を実際に書き換えたとき(= 追記なら
 * `"appended"`、削除なら `true`)に呼ぶ**。通知経路を対称にしておくことで、戦績の
 * 購読者と `GameProvider` が将来同じ画面に同居しても「保存したのに一覧が更新されない」
 * 無音のバグにならない(issue #310)。
 *
 * **描画中に呼んではならない。** 購読中のコンポーネントの再描画を要求するため、他コンポーネントの
 * 描画フェーズから呼ぶと React の「描画中に別コンポーネントを更新した」警告になる。
 * このため `GameProvider` は終局済みジャーナル復元時の追記を `useState` の遅延初期化
 * (= 描画フェーズ)ではなくマウント後の効果から行う(issue #310)。
 */
export function notifyHistoryChanged(): void {
  // 正規APIによる外部保存・全件削除後は、一過性の破損表示も含め
  // 必ず実値を読み直す。storage eventはcleanup成否を保つ専用経路を通る。
  invalidateHistoryViewSnapshot();
  notifySubscribers();
}

/**
 * `localStorage` の変更(このタブの削除操作、別タブの `storage` イベント)を購読する。
 *
 * 購読開始とstorage eventの効果経路で破損データをcleanupし、
 * 成否を表示snapshotに保つ。描画中のgetSnapshotは書き込みを行わない。
 *
 * 購読者は `Set` で保持するため、**同一の関数参照で2回購読することは非対応**
 * (2回目が重複排除され、片方の解除で両方が通知を失う)。想定利用者である
 * `useSyncExternalStore` は購読ごとに新しいクロージャを渡すため問題にならない。
 */
export function subscribeHistory(callback: () => void): () => void {
  // `storage` リスナはモジュールで1本だけ張り、購読者数の 0↔1 の境界で着脱する。
  // 購読者ごとに張ると、イベント1回で購読者数の二乗回だけ callback が走る。
  if (subscribers.size === 0 && !storageListenerAttached) {
    try {
      window.addEventListener("storage", onStorageEvent);
      storageListenerAttached = true;
    } catch {
      // Cross-tab updates are optional; keep the callback for same-tab writes.
    }
  }
  subscribers.add(callback);
  const storage = localStorageOrNull();
  if (storage !== null) latchCleanupResult(cleanupCorruptHistory(storage));
  return () => {
    subscribers.delete(callback);
    if (subscribers.size !== 0 || !storageListenerAttached) return;
    try {
      window.removeEventListener("storage", onStorageEvent);
      storageListenerAttached = false;
    } catch {
      // Treat attachment as unknown when cleanup is rejected so a later
      // subscription can retry if the host rejected before attaching.
      storageListenerAttached = false;
    }
    // 破損通知は通常unmountで消さない。React Strict Modeのsetup→cleanup→setupで
    // cleanup済みkeyしか見えなくなっても、明示的な再読込み/外部更新まで保つ。
  };
}

/**
 * `/history` 表示用snapshot。保存shape/keyや追記APIは変えず、UIだけが
 * 未保存(`ready` + 空配列)・破損・Storage読取失敗を判別する。
 * `getSnapshot`の契約どおり書き込みは行わない。破損v1の削除は従来どおり
 * `subscribeHistory` の効果側で実行する。
 */
export function getHistoryViewSnapshot(): HistoryViewSnapshot {
  const storage = localStorageOrNull();
  if (storage === null) return READ_ERROR_HISTORY_VIEW;

  let raw: string | null;
  try {
    raw = storage.getItem(MATCH_HISTORY_KEY);
  } catch {
    return READ_ERROR_HISTORY_VIEW;
  }

  if (raw === null) {
    if (latchedCorruptView !== null) return corruptView(latchedCorruptView);
    cachedViewRaw = null;
    cachedHistoryView = EMPTY_HISTORY_VIEW;
    return EMPTY_HISTORY_VIEW;
  }
  if (raw === cachedViewRaw) return cachedHistoryView;

  const entries = parseHistory(raw);
  cachedViewRaw = raw;
  if (entries === null) {
    // cleanupはここで行わない。購読効果が成否を確定するまでは、
    // 「削除済み」を騙らない retained 表示を返す。
    latchedCorruptView = "corrupt-retained";
    cachedHistoryView = CORRUPT_RETAINED_HISTORY_VIEW;
    return CORRUPT_RETAINED_HISTORY_VIEW;
  }

  latchedCorruptView = null;
  cachedHistoryView = Object.freeze({ status: "ready", entries });
  return cachedHistoryView;
}

/** エラー案内の「もう一度読み込む」から現在のStorageを再評価する。 */
export function retryHistoryViewSnapshot(): void {
  invalidateHistoryViewSnapshot();
  const storage = localStorageOrNull();
  if (storage !== null) latchCleanupResult(cleanupCorruptHistory(storage));
  notifySubscribers();
}

/**
 * 現在の保存値(新しい順)。副作用を持たず、値が変わらない限り同一参照を返す。
 * 未保存・破損・読み込み不可はいずれも空配列(破損データの削除は `subscribeHistory`)。
 */
export function getHistorySnapshot(): readonly MatchHistoryEntry[] {
  let raw: string | null;
  try {
    raw = localStorageOrNull()?.getItem(MATCH_HISTORY_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw === null) {
    cachedRaw = null;
    cachedEntries = EMPTY_HISTORY;
    return EMPTY_HISTORY;
  }
  if (raw === cachedRaw) return cachedEntries;
  cachedRaw = raw;
  cachedEntries = parseHistory(raw) ?? EMPTY_HISTORY;
  return cachedEntries;
}

/**
 * サーバー描画・初回ハイドレーション時のスナップショット。
 *
 * `localStorage` はサーバーでは読めないため `null`(= 読み込み中)を返し、
 * ハイドレーション後に実値へ切り替える(`ResultPageClient` と同じマウントゲート)。
 */
export function getServerHistorySnapshot():
  | readonly MatchHistoryEntry[]
  | null {
  return null;
}

/** `/history` のSSR/初回hydrationは読み込み中に揃える。 */
export function getServerHistoryViewSnapshot(): HistoryViewSnapshot | null {
  return null;
}
