import type { ActiveGameEffect } from "./useGameEffects";

const EFFECT_CLASS: Record<ActiveGameEffect["kind"], string> = {
  discard: "border-control-border text-tile-ink",
  riichi: "border-tile-badge-red text-tile-badge-red",
  pon: "border-turn-highlight text-turn-highlight-ink",
  kan: "border-focus-ring text-focus-ring",
  tsumo: "border-positive text-positive",
  ron: "border-danger text-danger",
  draw: "border-control-border text-tile-ink",
  roundEnd: "border-control-border text-tile-ink",
};

interface EffectOverlayProps {
  readonly effect: ActiveGameEffect | null;
  readonly placement?: "overlay" | "inline";
}

/** A decorative, pointer-transparent cue; the existing LiveRegion carries its text. */
export default function EffectOverlay({
  effect,
  placement = "overlay",
}: EffectOverlayProps) {
  if (effect === null) return null;

  return (
    <div
      aria-hidden="true"
      className={
        placement === "inline"
          ? "pointer-events-none flex w-full min-w-0 justify-center px-4"
          : "pointer-events-none absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 justify-center px-4"
      }
      data-effect-id={effect.eventId}
      data-effect-key={effect.eventKey}
      data-effect-overlay="true"
      data-effect-type={effect.kind}
      data-testid="effect-overlay"
    >
      <div
        className={`flex max-w-full items-center gap-2 rounded-xl border-2 bg-tile-face px-4 py-3 text-center shadow-lg animate-pulse motion-reduce:animate-none motion-reduce:transition-none ${EFFECT_CLASS[effect.kind]}`}
      >
        <span className="text-xl leading-none" aria-hidden="true">
          {effect.icon}
        </span>
        <span className="min-w-0">
          <span className="block text-base font-bold leading-5">
            {effect.title}
          </span>
          {effect.detail ? (
            <span className="block max-w-[min(70vw,28rem)] truncate text-xs font-semibold leading-5">
              {effect.detail}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
