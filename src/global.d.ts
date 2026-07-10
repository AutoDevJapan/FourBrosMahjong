// TypeScript 6.0 enables `noUncheckedSideEffectImports` by default, which requires
// an ambient module declaration for side-effect-only imports (e.g. `import "./globals.css"`)
// that have no corresponding type declarations. Next.js only ships declarations for
// `*.module.css` (CSS Modules), not plain global stylesheet imports, so we declare it here.
// See: https://github.com/microsoft/TypeScript/issues/63181
declare module "*.css";
