"use client";

import {
  forwardRef,
  type LiHTMLAttributes,
  type ReactNode,
  useEffect,
  useState,
} from "react";

interface HandTileAnimationProps
  extends Omit<LiHTMLAttributes<HTMLLIElement>, "children"> {
  /** A new value starts one entrance transition for this option. */
  readonly animationKey?: string;
  readonly children: ReactNode;
}

/**
 * Keeps the listbox option itself as the animated element. This preserves
 * focus, option semantics, and the existing tile layout while allowing a
 * newly drawn/replacement tile to settle into the hand visually.
 */
const HandTileAnimation = forwardRef<HTMLLIElement, HandTileAnimationProps>(
  function HandTileAnimation(
    { animationKey, children, className = "", ...props },
    ref,
  ) {
    const [completedAnimationKey, setCompletedAnimationKey] = useState<
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
      return () => window.clearTimeout(timer);
    }, [animationKey]);

    const entering =
      animationKey !== undefined && completedAnimationKey !== animationKey;

    return (
      <li
        {...props}
        ref={ref}
        data-hand-animation={animationKey !== undefined ? "draw" : undefined}
        className={[
          className,
          "transition-opacity duration-200 ease-out motion-reduce:transition-none motion-reduce:opacity-100",
          entering ? "opacity-0" : "opacity-100",
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
