import { readFileSync } from "node:fs";

/**
 * `globals.css` を素のテキストとして読み、セレクタブロック/宣言を取り出すテスト用ヘルパ。
 *
 * `globals.contrast.test.ts`(トークンのコントラスト)と `globals.river-grid.test.ts`
 * (河グリッドのトラック定義)が同じ壊れやすいパーサを重複実装していたため一本化した。
 * 片方だけ直して他方が空振りする事故を防ぐのが目的で、**テストからのみ使う**。
 *
 * 正規表現ベースなので、ネストしたブロックやブロック内コメントに `}` を含む CSS は
 * 正しく切り出せない。ブロック限定で「無いこと」を検査すると、探索範囲が縮んだだけで
 * 真になってしまうため、**否定の検査はブロックではなくファイル全体に対して行うこと**
 * (`CSS` をそのまま使う)。
 */
export const CSS = readFileSync(
  new URL("./globals.css", import.meta.url),
  "utf8",
);

/** セレクタブロック(`selector { ... }`、ネストなし)の中身を切り出す。 */
export function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (match === null) throw new Error(`block not found: ${selector}`);
  return match[1];
}

/** ブロック内から CSS カスタムプロパティの 6 桁 HEX 値を取り出す。 */
export function token(scope: string, name: string): string {
  const match = block(scope).match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (match === null) throw new Error(`token not found: ${name} in ${scope}`);
  return match[1];
}

/** ブロック内の宣言 1 件の値を取り出す(末尾のセミコロンは任意)。 */
export function declaration(selector: string, property: string): string {
  const match = block(selector).match(
    new RegExp(`(?:^|[;\\s])${property}:\\s*([^;}]+)`),
  );
  if (match === null) {
    throw new Error(`declaration not found: ${property} in ${selector}`);
  }
  return match[1].trim().replace(/\s+/g, " ");
}

/** ファイル全体から、あるカスタムプロパティのすべての宣言値を集める。 */
export function allDeclarations(property: string): string[] {
  return [...CSS.matchAll(new RegExp(`${property}\\s*:\\s*([^;}]+)`, "g"))].map(
    (match) => match[1].trim().replace(/\s+/g, " "),
  );
}
