"use client";

/**
 * 打牌/鳴き/リーチ/北抜き(ガリ)の操作パネル(スペック6 6.7 `ActionPanel`)。
 *
 * すべての操作はネイティブ `<button>` によりキーボードのみで完結できる(スペック5 5.2.2:
 * `Tab` 到達・`Enter`/`Space` 決定)。本コンポーネントは操作の「入口(UI)」を提供するだけで、
 * 鳴きの成立可否・点数計算・ツモ配分(Q12)などのドメイン判定は行わない(スペック6 6.8)。
 * 骨組み段階では各操作は選択された旨を親へ通知するのみ。
 */
export type GameAction = "riichi" | "pon" | "kan" | "pullNorth" | "skip";

interface ActionDef {
  action: GameAction;
  icon: string;
  label: string;
}

const ACTIONS: readonly ActionDef[] = [
  { action: "riichi", icon: "宣", label: "リーチ" },
  { action: "pon", icon: "碰", label: "ポン" },
  { action: "kan", icon: "槓", label: "カン" },
  { action: "pullNorth", icon: "北", label: "北抜き(ガリ)" },
  { action: "skip", icon: "○", label: "スキップ" },
];

export interface ActionPanelProps {
  /** 操作が押されたときに呼ぶ(UIイベントのみ、ドメイン計算は行わない)。 */
  onAction?: (action: GameAction) => void;
  /** 選択不能な操作(局面上まだ確定できないもの)。骨組みでは既定で空。 */
  disabledActions?: readonly GameAction[];
}

export default function ActionPanel({
  onAction,
  disabledActions = [],
}: ActionPanelProps) {
  const disabled = new Set(disabledActions);
  return (
    <div
      role="group"
      aria-label="操作パネル"
      className="flex flex-wrap items-center justify-center gap-2"
    >
      {ACTIONS.map(({ action, icon, label }) => (
        <button
          key={action}
          type="button"
          disabled={disabled.has(action)}
          onClick={() => onAction?.(action)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/25 px-3 py-2 text-sm font-medium transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true" className="text-base">
            {icon}
          </span>
          {label}
        </button>
      ))}
    </div>
  );
}
