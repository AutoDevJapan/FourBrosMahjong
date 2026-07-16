"use client";

/**
 * 結果画面(`/game/result`)。スペック6 6.2 / 6.5 / 6.6。
 *
 * 半荘終了時の最終順位とソシー内訳(素点+ウマ+祝儀)を表示する。親レイアウト(`app/game/layout.tsx`)の
 * `GameProvider` が保持する確定済み結果を `useContext`(`useGame`)経由で読み取るため Client Component
 * とする(スペック6 6.6)。表示している値は骨組み確認用の固定サンプルであり、順位決定・ソシー計算
 * (ウマ割当 Q13 を含む)などのドメインロジックは一切持たない(スペック6 6.8)。
 *
 * 導線(スペック6 6.3): 「ロビーへ戻る」(→ `/`)・「もう一半荘」(→ `/game`)。
 */
import Link from "next/link";
import { useGame } from "@/components/game/GameProvider";
import RankingTable from "@/components/result/RankingTable";
import SoshiiBreakdown from "@/components/result/SoshiiBreakdown";

export default function ResultPage() {
  const { state } = useGame();
  const result = state.result;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold sm:text-2xl">対局結果</h1>
        <Link
          href="/"
          className="rounded-full border border-foreground/25 px-3 py-1.5 text-sm hover:bg-foreground/5"
        >
          ロビーへ戻る
        </Link>
      </header>

      {result === null ? (
        // 半荘が終了していない/結果未確定のまま直接アクセスされた場合のフォールバック(スペック6 6.8)。
        <div className="flex flex-col items-start gap-4 rounded-lg border border-foreground/15 p-6">
          <p className="text-sm text-foreground/70">
            まだ半荘の結果が確定していません。対局を進めると、ここに最終順位とソシー内訳が表示されます。
          </p>
          <Link
            href="/game"
            className="rounded-full border border-foreground/25 px-4 py-2 text-sm hover:bg-foreground/5"
          >
            対局画面へ
          </Link>
        </div>
      ) : (
        <>
          <p className="text-xs text-foreground/60">
            ※
            現在表示中の結果は骨組み確認用のサンプルです(順位・素点・ウマ・祝儀は固定値)。
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
              {result.players.map((player) => (
                <SoshiiBreakdown key={player.name} player={player} />
              ))}
            </div>
          </section>

          <nav
            aria-label="対局後の導線"
            className="mt-2 flex flex-wrap gap-3 border-t border-foreground/15 pt-6"
          >
            <Link
              href="/game"
              className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background hover:opacity-90"
            >
              もう一半荘
            </Link>
            <Link
              href="/"
              className="rounded-full border border-foreground/25 px-5 py-2 text-sm hover:bg-foreground/5"
            >
              ロビーへ戻る
            </Link>
          </nav>
        </>
      )}
    </div>
  );
}
