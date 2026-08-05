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
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { localStorageOrNull } from "@/components/common/browserStorage";
import {
  clearHistoryAcrossTabs,
  getHistorySnapshot,
  getServerHistorySnapshot,
  type HistoryClearResult,
  MAX_HISTORY_ENTRIES,
  type MatchHistoryEntry,
  notifyHistoryChanged,
  subscribeHistory,
} from "@/components/game/matchHistory";
import RankingTable from "@/components/result/RankingTable";
import SoshiiBreakdown from "@/components/result/SoshiiBreakdown";
import { formatSignedSoshii } from "@/components/result/soshiiFormat";

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
  "lock-busy":
    "他のタブが戦績を更新中のため、削除できませんでした。他のタブを閉じるか、しばらく待ってからもう一度お試しください。",
  "storage-failed":
    "この端末のストレージを操作できず、戦績を削除できませんでした。ブラウザのストレージ設定(プライベートモードや空き容量)を確認してください。",
};

/** 半荘1件の見出し+展開内訳。 */
function HistoryItem({ entry }: { entry: MatchHistoryEntry }) {
  const finishedAt = finishedAtFormat.format(new Date(entry.finishedAt));
  const ordered = [...entry.players].sort((a, b) => a.rank - b.rank);
  const top = ordered[0];
  const topTotal = formatSignedSoshii(top.soshiiTotal);

  return (
    <details className="group rounded-lg border border-control-border">
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg p-4 text-sm hover:bg-foreground/5">
        <span className="font-medium">{finishedAt}</span>
        <span className="text-foreground/70">
          1位 {top.name}(<span aria-hidden="true">{topTotal.display}</span>
          <span className="sr-only">{topTotal.srLabel}</span>)
        </span>
        <span
          aria-hidden="true"
          className="ml-auto text-foreground/70 transition-transform motion-reduce:transition-none group-open:rotate-90"
        >
          →
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-foreground/10 p-4">
        {/* 見出しは h1(ページ)→ h2(本節)→ h3(SoshiiBreakdown 内の選手名)の順で
            レベルを飛ばさない(axe heading-order / スペック5)。 */}
        <section
          aria-label={`${finishedAt}の最終順位`}
          className="flex flex-col gap-2"
        >
          <h2 className="text-sm font-semibold">最終順位</h2>
          <RankingTable players={ordered} />
        </section>
        <section
          aria-label={`${finishedAt}のソシー内訳`}
          className="flex flex-col gap-2"
        >
          <h2 className="text-sm font-semibold">ソシー内訳(素点+ウマ+祝儀)</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {ordered.map((player) => (
              // 名前は重複し得る(#291)ため、一意な rank を key にする。
              <SoshiiBreakdown key={player.rank} player={player} />
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
  const entries = useSyncExternalStore<readonly MatchHistoryEntry[] | null>(
    subscribeHistory,
    getHistorySnapshot,
    getServerHistorySnapshot,
  );
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  // 全件削除すると「削除する」ボタンごと一覧セクションが消えるため、フォーカスが
  // body へ落ちてキーボード利用者が文脈を失う。削除直後だけ空状態へフォーカスを移す。
  const emptyStateRef = useRef<HTMLDivElement>(null);
  // 削除完了までに別タブの終局保存が届くと一覧が再び描かれ、空状態が存在しない。
  // その場合の着地点(名前とロールを持つ「戦績をすべて削除」ボタン)。
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  // 「削除直後の1回だけ」を表す一過性のフラグ。state にすると描画に影響しない値で
  // 再描画が走るうえ、効果内での state 更新になるため ref で持つ。
  const pendingFocusRef = useRef(false);

  useEffect(() => {
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    // 着地点は空状態が第一候補。削除完了までに別タブの終局保存が届くと一覧が再び描かれ、
    // 空状態が存在しないため、そのときは「戦績をすべて削除」ボタンへ連鎖する。
    // 到達可否は DOM 接続では判定できない(#377)ので、実際に activeElement が移ったかで
    // 実測してから次の候補へ進む(スペック5 5.2.2 / `Modal` と同じ規約)。
    for (const candidate of [emptyStateRef.current, clearButtonRef.current]) {
      if (candidate === null) continue;
      candidate.focus();
      if (candidate.ownerDocument.activeElement === candidate) return;
    }
    // 削除成功時は必ず確認UIを畳むため、通常はどちらかへ到達する。到達できないのは
    // 着地点が隠されている等の契約違反であり、黙って <body> へ落とさず知らせる。
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "MatchHistoryList: 全件削除後のフォーカス着地点へ到達できませんでした(スペック5 5.2.2)。",
      );
    }
  });

  const executeClear = async () => {
    const storage = localStorageOrNull();
    // Storage の getter 自体が例外を投げる環境も「ストレージを操作できない」に含める。
    const result: HistoryClearResult =
      storage === null
        ? "storage-failed"
        : await clearHistoryAcrossTabs(storage);
    if (result === "cleared") {
      // 永続化と購読者への通知は分離されているため、削除後に明示的に知らせる(#302)。
      notifyHistoryChanged();
      // 「削除する」ボタンごと一覧セクションが消えるので、着地点へフォーカスを移す。
      setConfirmingClear(false);
      pendingFocusRef.current = true;
      setStatusMessage("保存されていた戦績をすべて削除しました。");
      return;
    }
    // 削除できなかった場合は一覧が残る。「削除しました」と読み上げると実態と食い違う。
    // 確認UIも畳まない ─ 畳むと押した「削除する」ボタンが消える一方で空状態も描かれず、
    // フォーカスの行き先が無くなって body へ落ちるため(成功時と同じ a11y 契約を守る)。
    setStatusMessage(CLEAR_FAILURE_MESSAGE[result]);
  };

  if (entries === null) {
    return (
      <div
        role="status"
        className="flex min-h-40 items-center justify-center rounded-lg border border-foreground/15 p-6 text-sm text-foreground/70"
      >
        戦績を読み込んでいます…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 削除実行などの結果を読み上げで通知する(表示内容は下の一覧が担う)。 */}
      <p role="status" className="sr-only">
        {statusMessage}
      </p>

      {entries.length === 0 ? (
        <div
          ref={emptyStateRef}
          // 削除直後にフォーカスを受け取るため、プログラム的にのみフォーカス可能にする。
          tabIndex={-1}
          className="flex flex-col items-start gap-2 rounded-lg border border-foreground/15 p-6"
        >
          <p className="text-sm text-foreground/70">
            保存された戦績はまだありません。半荘終了時にこの端末のストレージが利用できる場合、最終順位とソシー内訳が自動で記録されます。記録されない場合は、ブラウザのストレージ設定や空き容量を確認してください。
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-foreground/70">
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
            className="flex flex-col gap-3"
          >
            {entries.map((entry) => (
              <li key={`${entry.seed}-${entry.finishedAt}`}>
                <HistoryItem entry={entry} />
              </li>
            ))}
          </ol>

          <section
            aria-labelledby="clear-history-heading"
            className="flex flex-col items-start gap-3 border-t border-foreground/15 pt-6"
          >
            <h2 id="clear-history-heading" className="text-sm font-semibold">
              戦績の削除
            </h2>
            {confirmingClear ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-foreground/70">
                  保存されているすべての戦績(この端末の
                  {entries.length}件)を削除します。よろしいですか?
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={executeClear}
                    className="rounded-full border border-danger px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10"
                  >
                    削除する
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingClear(false)}
                    className="rounded-full border border-control-border px-4 py-2 text-sm hover:bg-foreground/5"
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
                  setConfirmingClear(true);
                }}
                className="rounded-full border border-control-border px-4 py-2 text-sm hover:bg-foreground/5"
              >
                戦績をすべて削除
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
