"use client";

/**
 * 操作パネル(スペック6 6.7 `ActionPanel`)。
 *
 * すべての操作はネイティブ `<button>` によりキーボードのみで完結できる(スペック5 5.2.2:
 * `Tab` 到達・`Enter`/`Space` 決定)。表示するアクションは**現在の局面**(engine の pending/phase)に
 * 応じて呼び出し側が構築する。本コンポーネントは合法性を判断せず、受け取った定義のうち麻雀操作4種だけを
 * 標準相対順へ整えて描画する純表示に徹する(issue #709 / スペック6 6.8: 判定は engine 側)。
 */
import type { RefObject } from "react";

/** 複数表示時に相対順を固定する麻雀アクショングループ(issue #709)。 */
type StandardActionOrder = "chi" | "pon" | "kan" | "riichi";

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
  /** この操作を結果画面など別ビューから開いたときのフォーカス復帰先。 */
  readonly buttonRef?: RefObject<HTMLButtonElement | null>;
  /** 接続待ちでも実行できるローカル操作(例: 結果画面への遷移)。 */
  readonly requiresConnection?: boolean;
  /** 強調(主要操作)。 */
  readonly primary?: boolean;
  /** チー→ポン→カン→リーチの標準相対順へ参加する場合のグループ。 */
  readonly standardOrder?: StandardActionOrder;
}

export interface ActionPanelProps {
  /** 現在の局面で選べるアクション群。空なら操作なし。 */
  readonly actions: readonly ActionItem[];
  /** 補助テキスト(例: 「牌を選んで打牌してください」)。 */
  readonly hint?: string;
  /** 接続待ちなど、局面上は選べても一時的に送信できない状態。 */
  readonly disabled?: boolean;
}

const STANDARD_ACTION_RANK: Readonly<Record<StandardActionOrder, number>> = {
  chi: 0,
  pon: 1,
  kan: 2,
  riichi: 3,
};

/**
 * 対象4種だけを標準相対順へ並べ、ロン・ツモ・北抜・スルー等の位置は変えない。
 * 暗槓・加槓など同じグループ内は入力順を維持する。返却配列だけを作り、props は変更しない。
 */
function orderActionItems(
  actions: readonly ActionItem[],
): readonly ActionItem[] {
  const ordered = actions
    .map((action, index) => ({ action, index }))
    .filter(
      (
        entry,
      ): entry is typeof entry & {
        action: ActionItem & { standardOrder: StandardActionOrder };
      } => entry.action.standardOrder !== undefined,
    )
    .sort(
      (a, b) =>
        STANDARD_ACTION_RANK[a.action.standardOrder] -
          STANDARD_ACTION_RANK[b.action.standardOrder] || a.index - b.index,
    )
    .map(({ action }) => action);

  if (ordered.length < 2) return actions;
  let next = 0;
  return actions.map((action) =>
    action.standardOrder === undefined ? action : ordered[next++],
  );
}

export default function ActionPanel({
  actions,
  hint,
  disabled = false,
}: ActionPanelProps) {
  const orderedActions = orderActionItems(actions);
  return (
    <div
      role="group"
      aria-label="操作パネル"
      className="game-action-panel flex flex-col items-center gap-2"
    >
      {hint ? (
        <p className="game-action-hint text-xs text-foreground/70">{hint}</p>
      ) : null}
      {orderedActions.length > 0 ? (
        <div className="game-action-list flex flex-wrap items-center justify-center gap-2">
          {orderedActions.map(
            ({
              key,
              label,
              icon,
              onClick,
              disabled: actionDisabled,
              buttonRef,
              requiresConnection = true,
              primary,
            }) => (
              <button
                key={key}
                type="button"
                data-action-key={key}
                disabled={actionDisabled || (disabled && requiresConnection)}
                ref={buttonRef}
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
                className={`game-action-button inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40 ${
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
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
