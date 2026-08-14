/**
 * Node 26 exposes a global `localStorage` accessor that is unavailable unless
 * Node was started with `--localstorage-file`. Vitest's jsdom environment does
 * not replace that pre-existing global, so expose the storage created by jsdom
 * for browser-environment tests and restore the original descriptor afterward.
 */
import { afterAll } from "vitest";

type JsdomHost = typeof globalThis & {
  jsdom?: {
    window: Window;
  };
};

const host = globalThis as JsdomHost;
const storage = host.jsdom?.window.localStorage;

if (storage !== undefined) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });

  afterAll(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });
}
