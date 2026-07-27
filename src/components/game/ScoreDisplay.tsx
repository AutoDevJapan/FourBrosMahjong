/**
 * 点数表示(スペック6 6.4.2)。対局中は持ち点(素点)を表示する。
 *
 * 点差(`delta`)は色だけでなく `+`/`-` の符号+テキストで伝える(スペック5 5.2.1: 色のみでの
 * 増減表現は禁止)。ツモ支払い配分(Q12)には関与せず、与えられた差分数値を表示するのみ(スペック6 6.8)。
 * 値渡しのみの純表示コンポーネント(スペック6 6.6)。
 */
export interface ScoreDisplayProps {
  /** 持ち点(素点)。 */
  points: number;
  /** 直近の点差(表示専用)。省略時は表示しない。 */
  delta?: number;
}

export default function ScoreDisplay({ points, delta }: ScoreDisplayProps) {
  const hasDelta = typeof delta === "number" && delta !== 0;
  const isPositive = (delta ?? 0) > 0;
  const sign = isPositive ? "+" : "−";
  const deltaColor = isPositive ? "text-positive" : "text-danger";

  return (
    // 点差は狭いスロット(段階①のクロス配置の左右列)では持ち点と同じ行に収まらないため
    // 折り返しを許す。折り返せないとスロット幅を超えてページが横スクロールする(#387)。
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="font-mono text-lg font-bold tabular-nums">
        {points.toLocaleString("ja-JP")}
        <span className="ml-0.5 text-xs font-normal">点</span>
      </span>
      {hasDelta ? (
        <span
          className={`font-mono text-sm font-semibold tabular-nums ${deltaColor}`}
        >
          {/* 符号は視覚記号ではなくテキストとして読み上げられるよう明示ラベルを付す。 */}
          <span aria-hidden="true">
            {sign}
            {Math.abs(delta as number).toLocaleString("ja-JP")}
          </span>
          <span className="sr-only">
            {isPositive ? "プラス" : "マイナス"}
            {Math.abs(delta as number).toLocaleString("ja-JP")}点
          </span>
        </span>
      ) : null}
    </p>
  );
}
