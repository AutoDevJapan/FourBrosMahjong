import type { ReactNode } from "react";
import "./history.css";

/** `/history` だけに戦績画面固有styleを配信するroute boundary。 */
export default function HistoryLayout({ children }: { children: ReactNode }) {
  return children;
}
