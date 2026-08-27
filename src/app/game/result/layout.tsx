import type { ReactNode } from "react";
import "./result.css";

/** `/game/result` だけに結果画面固有styleを配信するroute boundary。 */
export default function ResultLayout({ children }: { children: ReactNode }) {
  return children;
}
