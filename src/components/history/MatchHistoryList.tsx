"use client";

/**
 * 戦績一覧(`/history`)の対話部分(issue #293)。
 *
 * `localStorage` の保存済み戦績(`matchHistory.ts`)を新しい順に一覧し、各半荘を
 * 展開すると結果画面と同じ確定内訳(最終順位 `RankingTable`+ソシー内訳
 * `SoshiiBreakdown`)を閲覧できる。末尾に全件削除(2段階確認)を備える。
 *
 * アクセシビリティ(スペック5):
 * - 展開はネイティブ `<details>`/`<summary>` でキーボード操作・状態通知を担保する。
 * - 削除確認はインラインの明示ボタン2択とし、結果は `role="status"` で通知する。
 * - 順位・増減は色に依存せずテキスト+符号で伝える(既存の結果コンポーネントを再利用)。
 *
 * `localStorage` はクライアントでのみ読めるため、SSR/初回 hydration は読み込み中
 * 表示に揃え、マウント後に一覧へ切り替える。読み込みは `useSyncExternalStore` による
 * ストア購読で行い、描画中に `localStorage` を読んだり書いたりしない(issue #302)。
 */
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { localStorageOrNull } from "@/components/common/browserStorage";
import CharacterPortrait, {
  characterAccentStyle,
} from "@/components/game/CharacterPortrait";
import {
  clearHistoryAcrossTabs,
  getHistoryViewSnapshot,
  getServerHistoryViewSnapshot,
  type HistoryClearResult,
  type HistoryViewSnapshot,
  MAX_HISTORY_ENTRIES,
  type MatchHistoryEntry,
  notifyHistoryChanged,
  retryHistoryViewSnapshot,
  subscribeHistory,
} from "@/components/game/matchHistory";
import { clearPendingHistory } from "@/components/game/pendingHistory";
import RankingTable from "@/components/result/RankingTable";
import { SOSHII_BREAKDOWN_HEADING } from "@/components/result/resultLabels";
import SoshiiBreakdown from "@/components/result/SoshiiBreakdown";
import { formatSignedSoshii } from "@/components/result/soshiiFormat";
import { CHARACTER_PLAYER_IDS } from "@/domain/game/characters";

/**
 * 終了日時の表示フォーマット(例: 2026/07/20 14:05)。
 * 一覧はマウント後にのみ描画されるため、SSR とのロケール差異による
 * hydration 不一致は発生しない。
 */
const finishedAtFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * 削除できなかった場合の案内(issue #489)。
 *
 * 原因ごとに**利用者が取るべき行動が違う**ため文面を分ける。以前は理由を問わず
 * 「ブラウザの設定を確認してください」と案内していたが、非セキュアコンテキスト
 * (平文 http)では設定をいくら見ても解決せず、誤案内になっていた。
 * なお非セキュアコンテキストは ADR-0004 により失敗しなくなったため、ここには現れない。
 */
const CLEAR_FAILURE_MESSAGE: Record<
  Exclude<HistoryClearResult, "cleared">,
  string
> = {
  // 「排他できなかった」の内訳は他タブの保持がほとんどだが、lock API 側の失敗も
  // 同じ経路へ来る。断定すると #489 と同じ誤案内になるため、両方を含む言い回しにする。
  "lock-busy":
    "他のタブが戦績を更新中か、排他制御を利用できなかったため、削除できませんでした。他のタブを閉じるか、しばらく待ってからもう一度お試しください。",
  "storage-failed":
    "この端末のストレージを操作できず、戦績を削除できませんでした。ブラウザのストレージ設定(プライベートモードや空き容量)を確認してください。",
};

/**
 * 「削除しています…」を読み上げるまでの猶予(ms)。
 *
 * lock が空いていれば削除はミリ秒で終わるので、その場合は進行中を読み上げず結果だけを
 * 通知する(`role="status"` の連続更新を避ける / スペック5 5.2.3)。待たされたときだけ
 * 進行中が出る。値は「人が遅いと感じ始める境界」に合わせた小さめの猶予。
 */
const CLEAR_PROGRESS_DELAY_MS = 150;

/** 半荘1件の見出し+展開内訳。 */
function HistoryItem({ entry }: { entry: MatchHistoryEntry }) {
  const finishedAt = finishedAtFormat.format(new Date(entry.finishedAt));
  // 保存JSONは旧クライアントと同じv1形状を維持する。engineが保存してきた固定配列順
  // p0→p3から表示モデルにだけIDを付け、旧戦績にも現在の肖像を対応させる。
  const fixedPlayers = entry.players.map((player, index) => ({
    ...player,
    playerId: CHARACTER_PLAYER_IDS[index],
  }));
  const ordered = [...fixedPlayers].sort((a, b) => a.rank - b.rank);
  const top = ordered[0];
  const topTotal = formatSignedSoshii(top.soshiiTotal);

  return (
    <details
      data-character-id={top.playerId}
      style={top.playerId ? characterAccentStyle(top.playerId) : undefined}
      className="history-entry character-accent-edge group rounded-lg border border-control-border"
    >
      <summary className="history-entry-summary flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg p-4 text-sm hover:bg-foreground/5">
        <span className="history-entry-time">
          <span className="history-entry-date">{finishedAt}</span>
          <span className="history-entry-kind">半荘</span>
        </span>
        <span
          role="group"
          aria-label="四兄弟の最終順位"
          className="history-placement-list"
        >
          {fixedPlayers.map((player) => (
            <span
              key={player.playerId}
              role="img"
              aria-label={`${player.name} ${player.rank}位`}
              data-player-id={player.playerId}
              data-rank={player.rank}
              style={characterAccentStyle(player.playerId)}
              className="history-placement-chip"
            >
              {player.rank}
            </span>
          ))}
        </span>
        <span className="history-entry-winner text-foreground/70">
          {top.playerId ? <CharacterPortrait playerId={top.playerId} /> : null}
          <span className="history-entry-winner-copy">
            <span className="history-entry-winner-name">
              1位{" "}
              <span dir="auto" className="player-name-bidi-isolate">
                {top.name}
              </span>
            </span>
            <span className="history-entry-total">
              <span aria-hidden="true">{topTotal.display}</span>
              <span className="sr-only">{topTotal.srLabel}</span>
            </span>
          </span>
        </span>
        <span
          aria-hidden="true"
          className="history-entry-arrow ml-auto text-foreground/70 transition-transform motion-reduce:transition-none group-open:rotate-90"
        >
          →
        </span>
      </summary>
      <div className="history-entry-details flex flex-col gap-4 border-t border-foreground/10 p-4">
        {/* 見出しは h1(ページ)→ h2(本節)→ h3(SoshiiBreakdown 内の選手名)の順で
            レベルを飛ばさない(axe heading-order / スペック5)。 */}
        <section
          aria-label={`${finishedAt}の最終順位`}
          className="history-detail-section flex flex-col gap-2"
        >
          <h2 className="text-sm font-semibold">最終順位</h2>
          <RankingTable players={ordered} variant="history" />
        </section>
        <section
          aria-label={`${finishedAt}のソシー内訳`}
          className="history-detail-section flex flex-col gap-2"
        >
          <h2 className="text-sm font-semibold">{SOSHII_BREAKDOWN_HEADING}</h2>
          <div className="history-breakdown-grid grid gap-3 sm:grid-cols-2">
            {ordered.map((player) => (
              // 名前は重複し得る(#291)ため、一意な rank を key にする。
              <SoshiiBreakdown
                key={player.rank}
                player={player}
                variant="history"
              />
            ))}
          </div>
        </section>
      </div>
    </details>
  );
}

export default function MatchHistoryList() {
  // localStorage は React の外にある可変ストアなので `useSyncExternalStore` で購読する
  // (issue #302 / `playerNames.ts` と同じ方式)。サーバー描画・初回 hydration は
  // `null`(= 読み込み中)で一致させ、マウント後に保存値へ切り替える。全件削除や
  // 別タブでの変更は購読経由で反映されるため、描画中に localStorage は読まない。
  const historyView = useSyncExternalStore<HistoryViewSnapshot | null>(
    subscribeHistory,
    getHistoryViewSnapshot,
    getServerHistoryViewSnapshot,
  );
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  // 削除は Web Lock の取得を待つ非同期処理で、最大 `HISTORY_LOCK_TIMEOUT_MS` 掛かる
  // (issue #488)。待機中は「反応しない画面」に見えるため、進行中であることを示す。
  const [clearing, setClearing] = useState(false);
  // 連打の抑止は ref で行う。同一タスク内の2回目のクリックでは `clearing` の
  // 再描画が済んでおらず、state を見るハンドラは古い値(false)を読んでしまう。
  const clearingRef = useRef(false);
  // 全件削除すると「削除する」ボタンごと一覧セクションが消えるため、フォーカスが
  // body へ落ちてキーボード利用者が文脈を失う。削除直後だけ空状態へフォーカスを移す。
  const emptyStateRef = useRef<HTMLDivElement>(null);
  // 削除完了までに別タブの終局保存が届くと一覧が再び描かれ、空状態が存在しない。
  // その場合の着地点(名前とロールを持つ「戦績をすべて削除」ボタン)。
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  // 破壊操作の確認を始めた直後と削除失敗後は、安全側の「キャンセル」へ移す。
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  // 「削除直後の1回だけ」を表す一過性のフラグ。state にすると描画に影響しない値で
  // 再描画が走るうえ、効果内での state 更新になるため ref で持つ。
  const pendingFocusRef = useRef<
    "confirm-cancel" | "trigger" | "success" | "failure" | null
  >(null);

  useEffect(() => {
    const request = pendingFocusRef.current;
    if (request === null) return;
    // 着地点は空状態が第一候補。削除完了までに別タブの終局保存が届くと一覧が再び描かれ、
    // 空状態が存在しないため、そのときは「戦績をすべて削除」ボタンへ連鎖する。
    // 到達可否は DOM 接続では判定できない(#377)ので、実際に activeElement が移ったかで
    // 実測してから次の候補へ進む(スペック5 5.2.2 / `Modal` と同じ規約)。
    // 外部ストア通知と確認UIのstate更新が別コミットになることがあるため、候補がまだ
    // 描画されていない中間renderではフラグを消費しない。先に消費すると、次のrenderで
    // 空状態が現れてもフォーカスを取りこぼし、bodyへ落ちる(#482)。
    const candidates =
      request === "success"
        ? [emptyStateRef.current, clearButtonRef.current]
        : request === "trigger"
          ? [clearButtonRef.current, emptyStateRef.current]
          : [
              cancelButtonRef.current,
              clearButtonRef.current,
              emptyStateRef.current,
            ];
    let hasCandidate = false;
    for (const candidate of candidates) {
      if (candidate === null) continue;
      hasCandidate = true;
      candidate.focus();
      if (candidate.ownerDocument.activeElement === candidate) {
        pendingFocusRef.current = null;
        return;
      }
    }
    if (!hasCandidate) return;
    pendingFocusRef.current = null;
    // 削除成功時は必ず確認UIを畳むため、通常はどちらかへ到達する。到達できないのは
    // 着地点が隠されている等の契約違反であり、黙って <body> へ落とさず知らせる。
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "MatchHistoryList: 全件削除後のフォーカス着地点へ到達できませんでした(スペック5 5.2.2)。",
      );
    }
  });

  const executeClear = async () => {
    // 待機中の再クリックは無視する(要求を積み上げない / issue #488)。
    if (clearingRef.current) return;
    clearingRef.current = true;
    setClearing(true);
    // 直前の結果は伏せる(古い成否が残っていると、いま起きたことと混同する)。
    setStatusMessage("");
    // 進行中の読み上げは**待たされたときだけ**出す。lock が空いていれば削除は
    // ミリ秒で終わり、進行中→結果を続けて流すと `role="status"` を1フレームに2回
    // 更新することになる(スペック5 5.2.3 は「まとめて1回」を求める)。
    // 視覚側の即時フィードバックはボタンのラベル変化が担う。
    const progressTimer = setTimeout(() => {
      setStatusMessage("戦績を削除しています…");
    }, CLEAR_PROGRESS_DELAY_MS);
    try {
      const storage = localStorageOrNull();
      // Storage の getter 自体が例外を投げる環境も「ストレージを操作できない」に含める。
      let result: HistoryClearResult =
        storage === null
          ? "storage-failed"
          : await clearHistoryAcrossTabs(storage);
      if (result === "cleared" && !clearPendingHistory()) {
        // 保存済み履歴は消えているが、退避値の削除を確認できない場合は成功を案内しない。
        // 次回の操作で退避結果が復活するのを防ぐため、利用者へ再試行を促す。
        result = "storage-failed";
      }
      if (result === "cleared") {
        // 購読通知は同期的に再描画を起こし得るため、通知より先に着地点を予約する。
        // 先に通知すると、その再描画で effect が走った時点ではフラグがまだ falseで、
        // 高負荷時にフォーカス移動を取りこぼして body へ落ちる(#482 / スペック5 5.2.2)。
        pendingFocusRef.current = "success";
        // 永続化と購読者への通知は分離されているため、削除後に明示的に知らせる(#302)。
        notifyHistoryChanged();
        // 「削除する」ボタンごと一覧セクションが消えるので、着地点へフォーカスを移す。
        setConfirmingClear(false);
        setStatusMessage("保存されていた戦績をすべて削除しました。");
        return;
      }
      // 削除できなかった場合は一覧が残る。「削除しました」と読み上げると実態と食い違う。
      // 確認UIも畳まない ─ 畳むと押した「削除する」ボタンが消える一方で空状態も描かれず、
      // フォーカスの行き先が無くなって body へ落ちるため(成功時と同じ a11y 契約を守る)。
      pendingFocusRef.current = "failure";
      setStatusMessage(CLEAR_FAILURE_MESSAGE[result]);
      // 失敗時は確認UIがそのまま残るため、非同期の効果を待つと利用者が一時的に
      // 破壊操作のボタンへ留まる。失敗処理の完了時点で安全側のキャンセルへ移し、
      // focus() が到達できなかった場合だけ既存の効果による候補連鎖へ委ねる。
      cancelButtonRef.current?.focus();
      if (
        cancelButtonRef.current?.ownerDocument.activeElement ===
        cancelButtonRef.current
      ) {
        pendingFocusRef.current = null;
      }
    } finally {
      clearTimeout(progressTimer);
      clearingRef.current = false;
      setClearing(false);
    }
  };

  if (historyView === null) {
    return (
      <div
        role="status"
        className="history-state-card history-loading flex min-h-40 items-center justify-center rounded-lg border border-foreground/15 p-6 text-sm text-foreground/70"
      >
        戦績を読み込んでいます…
      </div>
    );
  }

  if (historyView.status !== "ready") {
    const isCorrupt = historyView.status.startsWith("corrupt-");
    const corruptWasCleaned = historyView.status === "corrupt-cleaned";
    return (
      <section
        role="alert"
        aria-labelledby="history-read-error-heading"
        className="history-state-card history-read-error flex min-h-40 flex-col items-start justify-center gap-4 rounded-lg border border-foreground/15 p-6"
      >
        <div className="history-read-error-copy">
          <h2 id="history-read-error-heading" className="font-semibold">
            {isCorrupt
              ? "保存された戦績データが壊れていました"
              : "戦績を読み込めませんでした"}
          </h2>
          <p className="mt-2 text-sm text-foreground/70">
            {isCorrupt
              ? corruptWasCleaned
                ? "保存内容を読み込めないため表示していません。壊れた戦績データは安全のため削除しました。"
                : "保存内容を読み込めないため表示していません。データを自動削除できなかったため、ブラウザのストレージ設定を確認してください。"
              : "この端末のストレージへアクセスできません。ブラウザのストレージ設定を確認してください。保存データは削除していません。"}
          </p>
        </div>
        <div className="history-read-error-actions flex flex-wrap gap-3">
          <button
            type="button"
            onClick={retryHistoryViewSnapshot}
            className="history-empty-link history-empty-link--primary"
          >
            もう一度読み込む
          </button>
          <Link
            href="/"
            className="history-empty-link history-empty-link--secondary"
          >
            ロビーへ戻る
          </Link>
        </div>
      </section>
    );
  }

  // 保存配列は書き込み完了順に先頭へ追加されるため、別タブの lock 待ちなどで
  // 終了日時と順番が入れ替わり得る。画面の「新しい順」という契約は実際の終了日時で
  // 決め、同時刻は保存順を保つ(安定ソート)ことで既存の並びも不必要に変えない。
  const entries = [...historyView.entries].sort((a, b) => {
    if (a.finishedAt === b.finishedAt) return 0;
    return a.finishedAt > b.finishedAt ? -1 : 1;
  });

  return (
    <div className="history-content flex flex-col gap-6">
      {entries.length === 0 ? (
        <div
          ref={emptyStateRef}
          // 削除直後にフォーカスを受け取るため、プログラム的にのみフォーカス可能にする。
          tabIndex={-1}
          role="region"
          // 説明文全体を名前にせず、フォーカス後の文脈を固定した短い名称で知らせる。
          aria-label="保存された戦績はまだありません"
          className="history-state-card history-empty flex flex-col gap-4 rounded-lg border border-foreground/15 p-6"
        >
          <p className="history-empty-copy text-sm text-foreground/70">
            保存された戦績はまだありません。半荘終了時にこの端末のストレージが利用できる場合、最終順位とソシー内訳が自動で記録されます。記録されない場合は、ブラウザのストレージ設定や空き容量を確認してください。
          </p>
          <div
            role="group"
            aria-labelledby="history-empty-actions-heading"
            className="history-empty-actions flex min-w-0 flex-col gap-3"
          >
            <h2
              id="history-empty-actions-heading"
              className="text-sm font-semibold"
            >
              次の対局を選ぶ
            </h2>
            <div className="history-empty-action-grid grid min-w-0 gap-3 sm:grid-cols-2">
              <section
                aria-labelledby="history-local-game-heading"
                className="history-empty-action-card flex min-w-0 flex-col items-start gap-3 rounded-lg border border-control-border p-4"
              >
                <div>
                  <h3 id="history-local-game-heading" className="font-medium">
                    ローカル対局
                  </h3>
                  <p
                    id="history-local-game-description"
                    className="mt-1 text-sm/5 text-foreground/70"
                  >
                    ローカル対局をすぐに開始できます。
                  </p>
                </div>
                <Link
                  href="/game"
                  aria-describedby="history-local-game-description"
                  className="history-empty-link history-empty-link--primary inline-flex min-h-11 items-center rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
                >
                  対局を開始
                </Link>
              </section>
              <section
                aria-labelledby="history-online-game-heading"
                className="history-empty-action-card flex min-w-0 flex-col items-start gap-3 rounded-lg border border-control-border p-4"
              >
                <div>
                  <h3 id="history-online-game-heading" className="font-medium">
                    オンライン対戦
                  </h3>
                  <p
                    id="history-online-game-description"
                    className="mt-1 text-sm/5 text-foreground/70"
                  >
                    表示名が必要です。参加する場合は6文字のルームコードも必要です。
                  </p>
                </div>
                <Link
                  href="/online"
                  aria-describedby="history-online-game-description"
                  className="history-empty-link history-empty-link--secondary inline-flex min-h-11 items-center rounded-full border border-control-border px-4 py-2 text-sm font-medium hover:bg-foreground/5"
                >
                  オンライン対戦へ
                </Link>
              </section>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="history-list-introduction text-sm text-foreground/70">
            半荘の結果を新しい順に表示しています(この端末に最大
            {MAX_HISTORY_ENTRIES}
            件まで保存され、超えた分は古い記録から削除されます)。
          </p>
          {/* role="list" は冗長だが明示する — Tailwind preflight の list-style 除去により Safari が
              list セマンティクスを落とし、VoiceOver がリスト名ごと読まなくなる既知挙動への対処
              (スペック5 5.2.5 / #313)。 */}
          <ol
            role="list"
            aria-label="保存された半荘結果"
            className="history-entry-list flex flex-col gap-3"
          >
            {entries.map((entry) => (
              <li key={`${entry.seed}-${entry.finishedAt}`}>
                <HistoryItem entry={entry} />
              </li>
            ))}
          </ol>

          <section
            aria-labelledby="clear-history-heading"
            className="history-clear-section flex flex-col items-start gap-3 border-t border-foreground/15 pt-6"
          >
            <h2 id="clear-history-heading" className="text-sm font-semibold">
              戦績の削除
            </h2>
            {confirmingClear ? (
              <div className="history-clear-confirmation flex flex-col items-start gap-3">
                <p className="text-sm text-foreground/70">
                  保存されているすべての戦績(この端末の
                  {entries.length}件)を削除します。よろしいですか?
                </p>
                {/*
                  待機中の操作不能は `disabled` ではなく `aria-disabled` + ハンドラ側の
                  ガードで表す。`disabled` にすると押した瞬間にボタンがフォーカスを失って
                  <body> へ落ち、削除後の着地点まで文脈が途切れる(スペック5 5.2.2 の
                  フォーカス契約 / #482)。

                  視覚の伝え方は2つのボタンで異なる。「削除する」は**実行中**なので
                  ラベルの変化で示し(淡色化すると進行中の文字まで読みにくくなる)、
                  「キャンセル」は**単に効かない**ので、既存の非活性表現(`Hand` /
                  `ActionPanel` と同じ淡色化)に揃える。
                */}
                <div className="history-clear-actions flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      void executeClear();
                    }}
                    aria-disabled={clearing || undefined}
                    className={`history-clear-button history-clear-button--danger rounded-full border border-danger px-4 py-2 text-sm font-medium text-danger ${
                      clearing ? "cursor-progress" : "hover:bg-danger/10"
                    }`}
                  >
                    {clearing ? "削除しています…" : "削除する"}
                  </button>
                  <button
                    ref={cancelButtonRef}
                    type="button"
                    // 待機中にキャンセルで確認UIを畳むと、押した「削除する」ボタンが
                    // 消える一方で削除はまだ終わっておらず、フォーカスの行き先が無い。
                    onClick={() => {
                      if (clearingRef.current) return;
                      pendingFocusRef.current = "trigger";
                      setConfirmingClear(false);
                    }}
                    aria-disabled={clearing || undefined}
                    className={`history-clear-button history-clear-button--cancel rounded-full border border-control-border px-4 py-2 text-sm ${
                      clearing
                        ? "cursor-not-allowed opacity-45"
                        : "hover:bg-foreground/5"
                    }`}
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <button
                ref={clearButtonRef}
                type="button"
                onClick={() => {
                  setStatusMessage("");
                  pendingFocusRef.current = "confirm-cancel";
                  setConfirmingClear(true);
                }}
                className="history-clear-trigger rounded-full border border-control-border px-4 py-2 text-sm hover:bg-foreground/5"
              >
                戦績をすべて削除
              </button>
            )}
          </section>
        </>
      )}

      {/*
        削除の進行中・結果を通知する。読み上げ用に `role="status"` を常設したまま、
        メッセージがあるときは**目でも読める**ように可視化する(スペック5 5.2.2 /
        issue #488)。sr-only のままだと、削除失敗や進行中であることが晴眼の利用者へ
        まったく伝わらない(成功時だけは一覧の消失という視覚的変化がある)。

        置き場所は一覧の**後ろ** ─ 操作した「削除する」ボタン(ページ末尾)のすぐ近くに
        出す。先頭に置くと、最大20件の一覧を挟んだ画面外で通知が更新され、失敗しても
        視界の中では何も起きていないように見える。空状態のときも直後に続く。
        分岐の外に置くことで、一覧↔空状態の切り替えでライブリージョンが作り直されない。
      */}
      <p
        role="status"
        className={
          statusMessage === ""
            ? "sr-only"
            : "history-status rounded-lg border border-foreground/15 p-4 text-sm text-foreground"
        }
      >
        {statusMessage}
      </p>
    </div>
  );
}
