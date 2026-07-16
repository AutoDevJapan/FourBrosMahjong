// `test.globals` is enabled in vitest.config.ts, so Vitest's APIs (`describe`,
// `it`, `expect`, `afterEach`, …) are available without importing them. This
// reference makes those globals visible to `tsc --noEmit` / editors.
/// <reference types="vitest/globals" />
