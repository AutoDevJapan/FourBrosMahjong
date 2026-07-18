/** 公開された抜き北(ガリ)を表示する。 */
import Tile from "../common/Tile";

export interface KitaDisplayProps {
  count: number;
  compact?: boolean;
}

const NORTH = { suit: "honor", rank: 4 } as const;

export default function KitaDisplay({
  count,
  compact = false,
}: KitaDisplayProps) {
  if (count === 0) return null;

  return (
    <div
      aria-label={`抜き北 ガリ${count}枚`}
      className="flex min-w-0 items-center gap-1"
      data-testid="kita-display"
    >
      <span className="shrink-0 rounded bg-foreground/10 px-1.5 py-0.5 text-xs font-semibold">
        ガリ{count}
      </span>
      {!compact ? (
        <span className="flex min-w-0 flex-wrap gap-0.5" aria-hidden="true">
          {Array.from({ length: count }, (_, index) => (
            <Tile key={`kita-${index}`} tile={NORTH} size="river" decorative />
          ))}
        </span>
      ) : null}
    </div>
  );
}
