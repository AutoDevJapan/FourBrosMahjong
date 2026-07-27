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
import { afterEach } from "vitest";

window.scrollTo = () => {};

afterEach(() => {
  cleanup();
});
