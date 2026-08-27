"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useGame } from "@/components/game/GameProvider";
import {
  DesignLinkButton,
  DesignPageShell,
  DesignPanel,
} from "@/components/layout/DesignSurface";
import ScreenNavigation from "@/components/layout/ScreenNavigation";
import RankingTable from "@/components/result/RankingTable";
import { SOSHII_BREAKDOWN_HEADING } from "@/components/result/resultLabels";
import SoshiiBreakdown from "@/components/result/SoshiiBreakdown";

type HistorySaveStatus = ReturnType<typeof useGame>["historySaveStatus"];

/** 保存の成否を結果本体と分離して可視・読み上げの双方へ伝える。 */
function HistorySaveNotice({ status }: { status: HistorySaveStatus }) {
  if (status === "idle") return null;

  if (status === "pending") {
    return (
      <div
        role="status"
        data-save-status="pending"
        className="result-save-notice result-save-notice--pending"
      >
        <strong>戦績を保存しています…</strong>
        <span>結果はこのまま確認できます。</span>
      </div>
    );
  }

  if (status === "saved") {
    return (
      <div
        role="status"
        data-save-status="saved"
        className="result-save-notice result-save-notice--saved"
      >
        <strong>戦績を保存しました。</strong>
        <span>この端末の戦績画面から、あとで見返せます。</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      data-save-status="failed"
      className="result-save-notice result-save-notice--failed"
    >
      <strong>この端末に今回の戦績を保存できませんでした。</strong>
      <span>
        この画面を閉じる前に結果を確認し、ブラウザのストレージ設定や空き容量を確認してください。対局結果の表示と対局の継続には影響ありません。
      </span>
    </div>
  );
}

/** `GameProvider` の確定結果を読み、結果表示と対局後の操作を提供する Client Component。 */
export default function ResultPageClient({
  fontVariableClassName,
}: {
  readonly fontVariableClassName: string;
}) {
  const { view, controls, historySaveStatus } = useGame();
  const router = useRouter();
  // sessionStorage はクライアントでのみ復元される。SSR は未確定状態を描くため、初回
  // hydration も同じ形に揃え、マウント後に確定結果へ切り替える。
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const result = mounted ? view.result : null;

  // ソシー内訳カードは最終順位テーブル(`RankingTable`)と同じく順位(rank)昇順で並べ、
  // 上部テーブル(1位→最下位)と視線移動を一致させる(issue #150 要検討点1)。
  const orderedPlayers =
    result === null ? [] : [...result.players].sort((a, b) => a.rank - b.rank);

  const startNewGame = () => {
    controls.newGame();
    // newGame は確定結果と journal を新しい半荘で不可逆に置き換える。push すると
    // 復元できなくなった /game/result が履歴に残り、ブラウザバックで「結果未確定」の
    // 空画面へ戻ってしまうため、現在の結果エントリごと対局画面へ置換する(#353)。
    router.replace("/game");
  };

  return (
    <DesignPageShell className={`result-page ${fontVariableClassName}`}>
      {/* 本文は単一の <main> に収める(スペック5 5.2.6)。読み込み中・未確定・確定の
          いずれの分岐でも本文がランドマーク外に取り残されないよう、分岐の外側で包む。
          ページヘッダー(<h1>)も内側に置く。外に出すと <header> が banner ランドマークに
          なり、ルートごとにランドマーク構成が割れる(#431)。 */}
      <main className="result-main">
        <header className="result-header">
          <DesignLinkButton href="/" className="result-back-link">
            <span aria-hidden="true">←</span>
            ロビーへ戻る
          </DesignLinkButton>
          <div className="result-heading-copy">
            <p className="result-kicker">対局結果</p>
            <h1 className="result-title">半荘終了</h1>
            <p className="result-introduction">
              最終順位と、確定したソシー内訳を確認できます。
            </p>
          </div>
        </header>
        <div className="result-screen-navigation">
          <ScreenNavigation currentPath="/game/result" showGameLink={false} />
        </div>

        <DesignPanel className="result-panel">
          {!mounted ? (
            <div role="status" className="result-state-card">
              <span className="result-state-mark" aria-hidden="true">
                ◇
              </span>
              <div>
                <strong>対局結果を読み込んでいます…</strong>
                <p>保存された対局状態を確認しています。</p>
              </div>
            </div>
          ) : result === null ? (
            // 半荘が終了していない/結果未確定のまま直接アクセスされた場合のフォールバック(スペック6 6.8)。
            <div className="result-state-card result-state-card--empty">
              <span className="result-state-mark" aria-hidden="true">
                ◇
              </span>
              <div className="result-state-copy">
                <strong>まだ半荘の結果が確定していません。</strong>
                <p>
                  対局を進めると、ここに最終順位とソシー内訳が表示されます。
                </p>
                <DesignLinkButton href="/game" className="result-state-link">
                  対局画面へ
                </DesignLinkButton>
              </div>
            </div>
          ) : (
            <div className="result-confirmed">
              {/* hydration 後の復元完了を、巨大な順位表を丸ごと再読させず簡潔に通知する。 */}
              <p role="status" className="sr-only">
                対局結果を読み込みました。
              </p>
              <section
                aria-labelledby="ranking-heading"
                className="result-section result-ranking-section"
              >
                <div className="result-section-heading">
                  <span aria-hidden="true">01</span>
                  <h2 id="ranking-heading">最終順位</h2>
                </div>
                <RankingTable players={result.players} />
              </section>

              <div className="result-divider" aria-hidden="true" />

              <section
                aria-labelledby="soshii-heading"
                className="result-section result-soshii-section"
              >
                <div className="result-section-heading">
                  <span aria-hidden="true">02</span>
                  <h2 id="soshii-heading">{SOSHII_BREAKDOWN_HEADING}</h2>
                </div>
                <div className="result-breakdown-grid">
                  {orderedPlayers.map((player) => (
                    // 名前は重複し得る(#291)ため、一意な rank を key にする。
                    <SoshiiBreakdown key={player.rank} player={player} />
                  ))}
                </div>
              </section>

              <HistorySaveNotice status={historySaveStatus} />

              <nav aria-label="対局後の導線" className="result-actions">
                <button
                  type="button"
                  onClick={startNewGame}
                  className="result-action result-action--primary"
                >
                  もう一半荘
                </button>
                <DesignLinkButton
                  href="/history"
                  className="result-action result-action--secondary"
                >
                  戦績を見る
                </DesignLinkButton>
                <DesignLinkButton
                  href="/"
                  className="result-action result-action--secondary"
                >
                  ロビーへ戻る
                </DesignLinkButton>
              </nav>
            </div>
          )}
        </DesignPanel>
      </main>
    </DesignPageShell>
  );
}
