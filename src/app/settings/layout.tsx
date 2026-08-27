import type { ReactNode } from "react";
import "./settings.css";

/** `/settings` だけに画面固有styleを配信するroute boundary。 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return children;
}
