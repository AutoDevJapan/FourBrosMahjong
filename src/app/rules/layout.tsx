import type { ReactNode } from "react";
import "./rules.css";

/** `/rules` だけに画面固有styleを配信するroute boundary。 */
export default function RulesLayout({ children }: { children: ReactNode }) {
  return children;
}
