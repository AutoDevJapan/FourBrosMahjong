/**
 * 場況・状態バッジ(スペック5 5.2.1)。
 *
 * 色のみのバッジにせず、必ずアイコン(記号)+テキストラベルを併記する。
 * 親・手番・リーチ・抜け番などの状態表示に共通で使う純表示コンポーネント。
 */
export interface StatusBadgeProps {
  /** 先頭に添える記号(装飾。読み上げはラベル側が担う)。 */
  icon: string;
  /** テキストラベル(読み上げ対象)。 */
  label: string;
  /** 強調バリアント。`highlight` は現在手番のハイライト色を使う。 */
  variant?: "default" | "highlight" | "riichi" | "bench";
}

const VARIANT_CLASS: Record<
  NonNullable<StatusBadgeProps["variant"]>,
  string
> = {
  default: "border-foreground/25 text-foreground/80",
  highlight: "border-turn-highlight text-turn-highlight font-semibold",
  riichi: "border-tile-accent-red text-tile-accent-red font-semibold",
  bench: "border-foreground/30 text-foreground/70",
};

export default function StatusBadge({
  icon,
  label,
  variant = "default",
}: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${VARIANT_CLASS[variant]}`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}
