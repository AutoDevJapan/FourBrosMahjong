# #1191: Tailwind の入力境界

## 対象と根拠

Tailwind は import graph ではなくファイルをテキストとして走査する。`@source not` のパスは stylesheet からの相対である（[公式仕様](https://tailwindcss.com/docs/detecting-classes-in-source-files)）。そのため JavaScript が import しない native 資産も CSS の入力になり得る。今回の変更は CSS の入力だけを狭め、検証範囲の分類・CI・native 検証ゲートを変更しない。

| 境界 | 現在の consumer と扱い |
| --- | --- |
| `prototypes/` | Unity C# / Blender のコード・生成物。`blender-asset-study.test.ts` と `unity-display-csharp-contract.test.ts` が内容を読む。CSS から除外するが、これらのテストも native build/render 検証も省略しない。 |
| `documents/evidence/` | 実行結果・検証記録。基準 `2074f2c` には存在しないため、将来の JSON 混入は一時 fixture の実スキャナ canary で確認する。CSS から除外する。 |
| `documents/assets/` | 素材原本・UI 更新監査 manifest。`ui-refresh-assets.test.ts` と `scripts/verify-ui-refresh-assets.mjs` が inventory/hash を読む。Web が配信する `public/` とは別。CSS から除外する。 |
| `documents/fixtures/railway-pre-cutover.json` | Railway 移行契約モジュールとテストが読む、移行前状態の fixture。CSS からこのファイルだけを除外する。 |
| `documents/fixtures/unity-display-contract.json` | `src/components/prototype/UnityDisplayReference.tsx` の本番 import、Unity 契約テスト、`e2e/unity-display-reference.spec.ts` が読む。CSS 走査に残す。 |
| `src/` の本番コード、`public/`、その他の runtime fixture | 従来の走査を維持する。`documents/` 全体の除外は行わない。 |

## 再発ガード

- 既存の除外指令回帰テストに4境界を追加した。
- 実際に lock された `@tailwindcss/postcss` と、その package が使う PostCSS を起動する。実 repo の入力 graph で `src` と Unity fixture が残り、除外先が消えることを確認する。
- 一時 repo の4除外先に独立したクラス canary を置き、入力 graph と生成 CSS の両方から消えることを確認する。`src`、Unity fixture、別 runtime fixture、類似名ディレクトリの4 canary は残す。除外指令だけを消した正対照では全8 canary が復活する。別の base でコンパイルし、スキャナの状態を共有しない。
- canary と監査コードは既存の除外対象 `*.test.ts` / `src/test/` に置く。監査自身が CSS 候補を供給しない。
- `no-runtime-to-css-excluded-inputs` は除外先への静的 import、literal の dynamic import、re-export を error にする。中継モジュール経由も見落とさないよう、走査 graph 内の非テストモジュールにも適用する。直接のテスト consumer と本番 Unity fixture は許可する。任意の計算済みパスによる `fs` / `fetch` は静的 import graph では保証できないため、新たな読み込み処理を追加する際はこの境界の再レビューが必要。
- コンパイラ package は `exports` のみを公開し、従来の dependency-cruiser resolver（`exportsFields: []`）では未解決だった。未解決 import を除外するのではなく、[公式 options](https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md#enhancedresolveoptions) と lock 済み18.2.0の `--init` template に従い `exportsFields` / `conditionNames` を明示した。exports-only package の実解決 canary、既存レイヤー canary、実 graph を確認する。

## 2026-09-15 ソース checkpoint の実測

基準は `2074f2cae28745907396c957a21c63b944dd8b3a`。Node 26.7.0、pnpm 10.33.0、`@tailwindcss/postcss` 4.3.3、plugin 配下の PostCSS 8.5.25。依存導入は `pnpm install --offline --frozen-lockfile`（download 0、lock 変更なし）。空き容量15 GiB。full build / 画面検証はこの checkpoint 時点では未実施。

再現コマンド（read-only、生成 CSS / 依存一覧 / 改行対照を JSON で標準出力）:

```sh
node src/test/tailwind-source-audit.mjs 2074f2c
```

`base` は worktree root、`from` はその `src/app/globals.css` の絶対パス、`optimize: false`。前後とも同じ現在の source tree を走査し、stylesheet だけを基準版／変更版へ切り替える。異なる commit 全体のビルドを比較したものではない。

| 測定 | 結果 |
| --- | --- |
| 生成 CSS | 前後とも52,242 bytes、バイト単位で一致 |
| 前後の SHA-256 | `fa076e0da6ff2d8d43c43f60a1351847607834c6f22c9c5e414f8b9d6bd1179e` |
| worktree 依存数（重複除去） | 299 → 251、追加0、除外48 |
| 除外の内訳 | native prototype46件、UI監査manifest1件、Railway fixture1件 |
| 残る `documents/` / `prototypes/` 依存 | `documents/fixtures/unity-display-contract.json` だけ |
| root の298件リストとの差 | worktree の `.git` 通常ファイル1件だけ。root は `.git` ディレクトリ。 |
| 最初の1 byte差の原因 | 除外指令の文字列を末尾LFなしで追記した場合、出力も末尾LFだけが消える（52,241 bytes）。LFを付けると52,242 bytesで元と一致。 |
| resolver 前後の実 local dependency edge | 919 → 919、全 edge 一致。コンパイラ package の未解決1件だけが解決する。 |

局所実行:

```sh
pnpm exec vitest run --project unit src/app/tailwind-content-scan.regression.test.ts src/test/dependency-layers.test.ts --maxWorkers=1
pnpm exec vitest run --project unit src/test/ui-refresh-assets.test.ts src/test/blender-asset-study.test.ts src/test/unity-display-contract.test.ts src/test/unity-display-csharp-contract.test.ts src/test/railway-iac-migration.test.ts --maxWorkers=1
pnpm depcruise
pnpm exec tsc --noEmit
pnpm exec eslint .dependency-cruiser.cjs src/app/tailwind-content-scan.regression.test.ts src/test/tailwind-source-audit.mjs src/test/dependency-layers.test.ts
```

順に40 tests pass、88 tests pass、441 modules / 1,443 dependencies 違反なし、型検査 pass、変更ファイル ESLint pass。これらは native アプリのビルド／実描画や本番ブラウザの視覚検証を代替しない。#1192 の入力分類修正は別変更のまま保持し、この変更だけを根拠に native / mixed 変更の検証省略を許可しない。
