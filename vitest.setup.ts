/**
 * Setup for the jsdom (component) test project — see `vitest.config.ts`.
 *
 * - Registers `@testing-library/jest-dom` matchers (e.g. `toBeInTheDocument`)
 *   on Vitest's `expect`, including their TypeScript augmentation.
 * - Unmounts anything rendered by Testing Library after every test so the jsdom
 *   document does not leak between tests.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
