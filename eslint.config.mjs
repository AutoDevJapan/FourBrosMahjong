import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // eslint-config-next 16 ships real ESLint 9 flat-config arrays (with
  // live plugin objects, e.g. `plugins: { react: reactPluginInstance }`)
  // instead of the legacy eslintrc-shareable-config format. Feeding that
  // through `FlatCompat.extends()` (the `@eslint/eslintrc` shim for
  // pre-flat-config plugins) makes eslint try to schema-validate it as a
  // legacy config, which fails, and formatting that failure then crashes
  // with "Converting circular structure to JSON" because the plugin
  // objects self-reference their own flat configs. Import the flat
  // configs directly instead.
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Flat config does not auto-ignore Next's build output the way the
    // legacy .eslintignore-based setup did. Without this, `pnpm lint` run
    // after a local `pnpm build` lints the minified `.next` bundle itself
    // and fails with thousands of false positives.
    ignores: [
      ".godd/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "playwright-report/**",
      "docs/api/**",
    ],
  },
];

export default eslintConfig;
