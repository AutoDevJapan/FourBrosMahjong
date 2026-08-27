import Link from "next/link";
import type { ReactNode } from "react";

function classes(...values: (string | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}

export interface DesignPageShellProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/** UI刷新画面だけに適用する、theme追従の背景と安全な横幅を持つpage shell。 */
export function DesignPageShell({ children, className }: DesignPageShellProps) {
  return (
    <div className={classes("design-page-shell", className)}>{children}</div>
  );
}

export interface DesignPanelProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/** 金罫線とcharcoal/和紙surfaceを共有する汎用panel。 */
export function DesignPanel({ children, className }: DesignPanelProps) {
  return <div className={classes("design-panel", className)}>{children}</div>;
}

export interface DesignLinkButtonProps {
  readonly href: string;
  readonly children: ReactNode;
  readonly variant?: "primary" | "secondary";
  readonly className?: string;
}

/** 44px target・focus・reduced-motionを共通化した遷移link。 */
export function DesignLinkButton({
  href,
  children,
  variant = "secondary",
  className,
}: DesignLinkButtonProps) {
  return (
    <Link
      href={href}
      className={classes(
        "design-link-button",
        `design-link-button--${variant}`,
        className,
      )}
    >
      {children}
    </Link>
  );
}
