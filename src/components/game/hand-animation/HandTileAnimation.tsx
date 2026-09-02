"use client";

import {
  forwardRef,
  type LiHTMLAttributes,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import type { HandAnimationKind } from "./handAnimation";

const HAND_ANIMATION_DURATION_MS = 200;

interface HandTileAnimationProps
  extends Omit<LiHTMLAttributes<HTMLLIElement>, "children"> {
  /** A new value starts one entrance transition for this option. */
  readonly animationKey?: string;
  /** The transition controls the small movement used for a meld reflow. */
  readonly animationKind?: HandAnimationKind;
  /** Deal tiles use a stable index-based delay for deterministic staggering. */
  readonly animationDelayMs?: number;
  readonly children: ReactNode;
}

/**
 * Keeps the listbox option itself as the animated element. This preserves
 * focus, option semantics, and the existing tile layout while allowing a
 * newly drawn/replacement tile to settle into the hand visually.
 */
const HandTileAnimation = forwardRef<HTMLLIElement, HandTileAnimationProps>(
  function HandTileAnimation(
    {
      animationKey,
      animationKind = "draw",
      animationDelayMs,
      children,
      className = "",
      style,
      ...props
    },
    ref,
  ) {
    const [completedAnimationKey, setCompletedAnimationKey] = useState<
      string | undefined
    >();
    const [completedDelayKey, setCompletedDelayKey] = useState<
      string | undefined
    >();

    useEffect(() => {
      if (animationKey === undefined) return;
      // Let the initial opacity render before changing to the settled state so
      // the browser can perform a real CSS transition. Reduced-motion users
      // get opacity: 1 from the motion-reduce utility on the initial render.
      const timer = window.setTimeout(() => {
        setCompletedAnimationKey(animationKey);
      }, 0);
      const delayTimer =
        animationDelayMs === undefined
          ? undefined
          : window.setTimeout(() => {
              // Keep the staggered delay through the entrance transition, but
              // do not let later selection/hover transforms inherit it.
              setCompletedDelayKey(animationKey);
            }, animationDelayMs + HAND_ANIMATION_DURATION_MS);
      return () => {
        window.clearTimeout(timer);
        if (delayTimer !== undefined) window.clearTimeout(delayTimer);
      };
    }, [animationKey, animationDelayMs]);

    const entering =
      animationKey !== undefined && completedAnimationKey !== animationKey;
    const hasAnimationDelay =
      animationDelayMs !== undefined && completedDelayKey !== animationKey;
    const enteringClass =
      animationKind === "meld"
        ? "opacity-80 translate-x-1 motion-reduce:opacity-100 motion-reduce:translate-x-0"
        : "opacity-0 translate-y-1 motion-reduce:opacity-100 motion-reduce:translate-y-0";

    return (
      <li
        {...props}
        ref={ref}
        // Keep the cue kind discoverable for the duration of this committed
        // hand transition. The settled classes are controlled by
        // `completedAnimationKey`; clearing the data marker at the 0ms timer
        // makes real-browser event assertions race the DOM update.
        data-hand-animation={
          animationKey !== undefined ? animationKind : undefined
        }
        style={
          !hasAnimationDelay
            ? style
            : { ...style, transitionDelay: `${animationDelayMs}ms` }
        }
        className={[
          className,
          "transition-opacity transition-transform duration-200 ease-out motion-reduce:transition-none motion-reduce:opacity-100",
          entering ? enteringClass : "opacity-100",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </li>
    );
  },
);

HandTileAnimation.displayName = "HandTileAnimation";

export default HandTileAnimation;
