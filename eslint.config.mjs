import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Flat config does not auto-ignore Next's build output the way the
    // legacy .eslintignore-based setup did. Without this, `pnpm lint` run
    // after a local `pnpm build` lints the minified `.next` bundle itself
    // and fails with thousands of false positives.
    ignores: [
      ".next/**",
      "out/**",
      "coverage/**",
      "playwright-report/**",
      "docs/api/**",
    ],
  },
];

export default eslintConfig;
