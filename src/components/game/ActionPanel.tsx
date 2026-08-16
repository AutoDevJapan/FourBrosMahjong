"use client";

/**
 * 操作パネル(スペック6 6.7 `ActionPanel`)。
 *
 * すべての操作はネイティブ `<button>` によりキーボードのみで完結できる(スペック5 5.2.2:
 * `Tab` 到達・`Enter`/`Space` 決定)。表示するアクションは**現在の局面**(engine の pending/phase)に
 * 応じて呼び出し側が構築し、本コンポーネントは受け取ったアクション定義を描画するだけの純表示に徹する
 * (スペック6 6.8: 判定は engine 側)。
 */
export interface ActionItem {
  /** 一意キー。 */
  readonly key: string;
  /** ボタンのテキストラベル(読み上げ対象)。 */
  readonly label: string;
  /** 先頭に添える記号(装飾。読み上げはラベルが担う)。 */
  readonly icon?: string;
  /** 押下時のハンドラ。 */
  readonly onClick: () => void;
  /** 選択不能(局面上まだ確定できない)。 */
  readonly disabled?: boolean;
  /** 強調(主要操作)。 */
  readonly primary?: boolean;
}

export interface ActionPanelProps {
  /** 現在の局面で選べるアクション群。空なら操作なし。 */
  readonly actions: readonly ActionItem[];
  /** 補助テキスト(例: 「牌を選んで打牌してください」)。 */
  readonly hint?: string;
}

export default function ActionPanel({ actions, hint }: ActionPanelProps) {
  return (
    <div
      role="group"
      aria-label="操作パネル"
      className="flex flex-col items-center gap-2"
    >
      {hint ? <p className="text-xs text-foreground/70">{hint}</p> : null}
      {actions.length > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {actions.map(({ key, label, icon, onClick, disabled, primary }) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={(event) => {
                if (event.detail > 1) return;
                onClick();
              }}
              onKeyDown={(event) => {
                if (
                  event.repeat &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                }
              }}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40 ${
                primary
                  ? "border-turn-highlight bg-turn-highlight/10 text-turn-highlight-strong hover:bg-turn-highlight/20"
                  : "border-control-border hover:bg-foreground/5"
              }`}
            >
              {icon ? (
                <span aria-hidden="true" className="text-base">
                  {icon}
                </span>
              ) : null}
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
