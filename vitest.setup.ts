/**
 * Setup for the jsdom (component) test project — see `vitest.config.ts`.
 *
 * - Registers `@testing-library/jest-dom` matchers (e.g. `toBeInTheDocument`)
 *   on Vitest's `expect`, including their TypeScript augmentation.
 * - Unmounts anything rendered by Testing Library after every test so the jsdom
 *   document does not leak between tests.
 * - Replaces `window.scrollTo` with a no-op. jsdom does not implement it and logs
 *   "Not implemented: Window's scrollTo() method" on every call, which would bury
 *   real errors in tests that restore scroll position (see `documentScrollLock`).
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// next/fontはNext buildのcompiler transformで関数化されるため、素のVite importでは
// page module収集時に呼べない。component testではclass contractだけを忠実に代替する。
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "test-font-geist-sans" }),
  Geist_Mono: () => ({ variable: "test-font-geist-mono" }),
  Noto_Sans_JP: () => ({ variable: "test-font-noto-sans-jp" }),
  Yuji_Syuku: () => ({ variable: "test-font-yuji-syuku" }),
}));

window.scrollTo = () => {};

afterEach(() => {
  cleanup();
});
