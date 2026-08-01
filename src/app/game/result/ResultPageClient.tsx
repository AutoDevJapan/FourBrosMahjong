"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useGame } from "@/components/game/GameProvider";
import RankingTable from "@/components/result/RankingTable";
import SoshiiBreakdown from "@/components/result/SoshiiBreakdown";

/** `GameProvider` の確定結果を読み、結果表示と対局後の操作を提供する Client Component。 */
export default function ResultPageClient() {
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
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col p-4 sm:p-6">
      {/* 本文は単一の <main> に収める(スペック5 5.2.6)。読み込み中・未確定・確定の
          いずれの分岐でも本文がランドマーク外に取り残されないよう、分岐の外側で包む。
          ページヘッダー(<h1>)も内側に置く。外に出すと <header> が banner ランドマークに
          なり、ルートごとにランドマーク構成が割れる(#431)。 */}
      <main className="flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold sm:text-2xl">対局結果</h1>
          <Link
            href="/"
            className="rounded-full border border-control-border px-3 py-1.5 text-sm hover:bg-foreground/5"
          >
            ロビーへ戻る
          </Link>
        </header>

        {!mounted ? (
          <div
            role="status"
            className="flex min-h-40 items-center justify-center rounded-lg border border-foreground/15 p-6 text-sm text-foreground/70"
          >
            対局結果を読み込んでいます…
          </div>
        ) : result === null ? (
          // 半荘が終了していない/結果未確定のまま直接アクセスされた場合のフォールバック(スペック6 6.8)。
          <div className="flex flex-col items-start gap-4 rounded-lg border border-foreground/15 p-6">
            <p className="text-sm text-foreground/70">
              まだ半荘の結果が確定していません。対局を進めると、ここに最終順位とソシー内訳が表示されます。
            </p>
            <Link
              href="/game"
              className="rounded-full border border-control-border px-4 py-2 text-sm hover:bg-foreground/5"
            >
              対局画面へ
            </Link>
          </div>
        ) : (
          <>
            {/* hydration 後の復元完了を、巨大な順位表を丸ごと再読させず簡潔に通知する。 */}
            <p role="status" className="sr-only">
              対局結果を読み込みました。
            </p>
            <section
              aria-labelledby="ranking-heading"
              className="flex flex-col gap-3"
            >
              <h2 id="ranking-heading" className="text-lg font-semibold">
                最終順位
              </h2>
              <RankingTable players={result.players} />
            </section>

            <section
              aria-labelledby="soshii-heading"
              className="flex flex-col gap-3"
            >
              <h2 id="soshii-heading" className="text-lg font-semibold">
                ソシー内訳(素点+ウマ+祝儀)
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {orderedPlayers.map((player) => (
                  // 名前は重複し得る(#291)ため、一意な rank を key にする。
                  <SoshiiBreakdown key={player.rank} player={player} />
                ))}
              </div>
            </section>

            {historySaveStatus === "failed" ? (
              <div
                role="status"
                className="rounded-lg border border-danger bg-danger/5 p-4 text-sm"
              >
                <p className="font-semibold">
                  この端末に今回の戦績を保存できませんでした。
                </p>
                <p className="mt-1 text-foreground/70">
                  この画面を閉じる前に結果を確認し、ブラウザのストレージ設定や空き容量を確認してください。対局結果の表示と対局の継続には影響ありません。
                </p>
              </div>
            ) : null}

            <nav
              aria-label="対局後の導線"
              className="mt-2 flex flex-wrap gap-3 border-t border-foreground/15 pt-6"
            >
              <button
                type="button"
                onClick={startNewGame}
                className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background hover:opacity-90"
              >
                もう一半荘
              </button>
              <Link
                href="/history"
                className="rounded-full border border-control-border px-5 py-2 text-sm hover:bg-foreground/5"
              >
                戦績を見る
              </Link>
              <Link
                href="/"
                className="rounded-full border border-control-border px-5 py-2 text-sm hover:bg-foreground/5"
              >
                ロビーへ戻る
              </Link>
            </nav>
          </>
        )}
      </main>
    </div>
  );
}
