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

/*
 * `highlight` / `riichi` は卓 felt(緑地)上に描画されるため、felt を直接地色にすると
 * 文字コントラストが WCAG 1.4.3 の 4.5:1 を満たせない(#154)。バッジに明色地 `bg-tile-face`
 * を敷き、その上で 4.5:1 以上を満たす濃色トークン(`turn-highlight-ink` / `tile-badge-red`)を
 * 文字・枠に用いる。明色地はライト/ダーク双方で felt に対し非テキスト 3:1 以上を満たし、
 * バッジが地(felt)と識別できる。色はアイコン+ラベルの冗長表現の補助であり単独では意味を担わない。
 */
const VARIANT_CLASS: Record<
  NonNullable<StatusBadgeProps["variant"]>,
  string
> = {
  default: "border-foreground/25 text-foreground/80",
  highlight:
    "bg-tile-face border-turn-highlight-ink text-turn-highlight-ink font-semibold",
  riichi:
    "bg-tile-face border-tile-badge-red text-tile-badge-red font-semibold",
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
