"use client";

/**
 * 結果画面(`/game/result`)。スペック6 6.2 / 6.5 / 6.6。
 *
 * 半荘終了時の最終順位とソシー内訳(素点+ウマ+祝儀)を表示する。親レイアウト(`app/game/layout.tsx`)の
 * `GameProvider` が保持する**実対局の確定結果**(engine 精算)を `useContext`(`useGame`)経由で読み取るため
 * Client Component とする(スペック6 6.6)。順位決定・ソシー計算(ウマ割当 Q13 を含む)などのドメイン
 * ロジックは engine が担い、本画面は確定済みの内訳を表示するだけ(スペック6 6.8)。
 *
 * 導線(スペック6 6.3): 「ロビーへ戻る」(→ `/`)・「もう一半荘」(→ 新規半荘を生成して `/game`)。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useGame } from "@/components/game/GameProvider";
import RankingTable from "@/components/result/RankingTable";
import SoshiiBreakdown from "@/components/result/SoshiiBreakdown";

export default function ResultPage() {
  const { view, controls } = useGame();
  const router = useRouter();
  const result = view.result;

  // ソシー内訳カードは最終順位テーブル(`RankingTable`)と同じく順位(rank)昇順で並べ、
  // 上部テーブル(1位→最下位)と視線移動を一致させる(issue #150 要検討点1)。
  // 表示順の整列のみで、順位やソシーの計算は engine の責務(スペック6 6.8)。
  const orderedPlayers =
    result === null ? [] : [...result.players].sort((a, b) => a.rank - b.rank);

  const startNewGame = () => {
    controls.newGame();
    router.push("/game");
  };

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
                <SoshiiBreakdown key={player.name} player={player} />
              ))}
            </div>
          </section>

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
