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
 * 表示に揃え、マウント後に一覧へ切り替える(`ResultPageClient` のマウントゲートと同型)。
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  clearHistory,
  loadHistory,
  localStorageOrNull,
  type MatchHistoryEntry,
  MAX_HISTORY_ENTRIES,
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

/** 半荘1件の見出し+展開内訳。 */
function HistoryItem({ entry }: { entry: MatchHistoryEntry }) {
  const finishedAt = finishedAtFormat.format(new Date(entry.finishedAt));
  const ordered = [...entry.players].sort((a, b) => a.rank - b.rank);
  const top = ordered[0];
  const topTotal = formatSignedSoshii(top.soshiiTotal);

  return (
    <details className="group rounded-lg border border-foreground/15">
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg p-4 text-sm hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
        <span className="font-medium">{finishedAt}</span>
        <span className="text-foreground/70">
          1位 {top.name}(<span aria-hidden="true">{topTotal.display}</span>
          <span className="sr-only">{topTotal.srLabel}</span>)
        </span>
        <span
          aria-hidden="true"
          className="ml-auto text-foreground/70 transition-transform group-open:rotate-90"
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
              <SoshiiBreakdown key={player.name} player={player} />
            ))}
          </div>
        </section>
      </div>
    </details>
  );
}

export default function MatchHistoryList() {
  // localStorage はクライアントでのみ読める。SSR/初回 hydration は「読み込み中」を描き、
  // マウント後に保存値へ切り替える(`ResultPageClient` と同じマウントゲート)。
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  // マウント後に1度だけ読む(loadHistory は破損時の削除まで含めて冪等)。
  // 以後の更新(全件削除)は overridden で上書きする。
  const loaded = useMemo<readonly MatchHistoryEntry[] | null>(() => {
    if (!mounted) return null;
    const storage = localStorageOrNull();
    return storage === null ? [] : loadHistory(storage);
  }, [mounted]);
  const [overridden, setOverridden] = useState<
    readonly MatchHistoryEntry[] | null
  >(null);
  const entries = overridden ?? loaded;
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const executeClear = () => {
    const storage = localStorageOrNull();
    if (storage !== null) clearHistory(storage);
    setOverridden([]);
    setConfirmingClear(false);
    setStatusMessage("保存されていた戦績をすべて削除しました。");
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
        <div className="flex flex-col items-start gap-2 rounded-lg border border-foreground/15 p-6">
          <p className="text-sm text-foreground/70">
            保存された戦績はまだありません。半荘を最後まで打つと、最終順位とソシー内訳がこの端末に自動で記録されます。
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-foreground/70">
            半荘の結果を新しい順に表示しています(この端末に最大
            {MAX_HISTORY_ENTRIES}
            件まで保存され、超えた分は古い記録から削除されます)。
          </p>
          <ol aria-label="保存された半荘結果" className="flex flex-col gap-3">
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
                    className="rounded-full border border-danger px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                  >
                    削除する
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingClear(false)}
                    className="rounded-full border border-foreground/25 px-4 py-2 text-sm hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setStatusMessage("");
                  setConfirmingClear(true);
                }}
                className="rounded-full border border-foreground/25 px-4 py-2 text-sm hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
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
