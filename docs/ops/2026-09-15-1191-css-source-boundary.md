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

独立 source review 後、`pnpm lint` は全体 pass、`pnpm check` は489 files pass。
`pnpm knip` が監査ヘルパの内部定数 `ROOT` の不要な export を1件検出したため export だけを外した。
修正後の knip、上記40 tests、型検査、ヘルパ ESLint/Biome、監査スクリプト再実行はすべて pass。
full build / 画面検証は引き続き別途調整し、この軽量検証の完了に含めない。

## PR #1193 の入力 inventory 干渉修正

head `295bd7577912d0f86482eb13c849fac94a7567ff` の
[CI run 34895196439](https://github.com/AutoDevJapan/FourBrosMahjong/actions/runs/34895196439)
では unit/component 全体が2,825 pass / 1 fail（208 files）だった。
唯一の失敗は `ci-workflow.test.ts` の #745 入力 inventory：追加した一時 repo 用の
架空 evidence パスを実 repository の入力として抽出し、`documentation` を
`unit-test` と比較して失敗した。実在しない類似名 canary も同じ原因を持つ。
対象1件だけをローカルで実行して同じ assertion failure を再現した。

tmp-only のパスだけを POSIX segment から組み立て、保存先・生成 import・検証先で共有する。
生成される fixture のパスと literal dynamic import は従来と同じであり、追加回帰でも
`couldNotResolve: false` / `dynamic: true` を確認する。Tailwind の4除外・4保持 canary、
除外削除の正対照、実 repository の Unity fixture 参照は維持した。
CI 分類、#745 の走査・assertion、入力 allowlist、production CSS は変更しない。
架空資産を検証対象へ登録して不要な CI を増やす修正ではない。

分割した修正後検証は #745 describe 11 tests pass、Tailwind / dependency boundary
41 tests pass。同 run の既存 E2E job は成功で完了したが、quality job の失敗により
run 全体は failure のまま。修正後 CI の成功とは報告しない。追加の全 suite / build / E2E、
CI 再実行はこの修正では行わない。

独立 reviewer は全3変更ファイル、両 fixture 全体、既存 #745 inventory を読み、
追加指摘なし。さらに `ci-workflow.test.ts` 全体169件と boundary 41件を独立実行し、
合計210 tests pass（6.53秒）を確認した。

現在の検証範囲として、修正前 checkpoint `295bd757` は別担当で local production build と
production E2E 14件を完了済み。認証済み Preview も6 routes、320/1440px、打牌とCPU進行、
全体盤面の Escape/focus 復帰、テーマ切替、reference の12盤面とロン表示を確認し、
captured console errors は0件だった（pageerror stream は別途監視していない）。
上の「full build / 画面検証未実施」は初期 source
checkpoint 時点の履歴であり、これらの後続結果を含まない。
今回の追加修正は2テストと本文だけで production code/CSS は不変のため、
重い検証を重複実行していない。既存 CI のquality失敗と、local/Preview成功は区別する。

## CodeQL の fixture コード生成指摘

`a9393cad` の CI run34897007502 は品質・E2E とも成功したが、別の
[CodeQL alert1](https://github.com/AutoDevJapan/FourBrosMahjong/security/code-scanning/1)
（`js/bad-code-sanitization`、`dependency-layers.test.ts`）が open だった。
固定パスの `JSON.stringify` 結果をコード文字列へ埋める構造が対象である。
[公式 query help](https://codeql.github.com/codeql-query-help/javascript/js-bad-code-sanitization/)
が説明する通り、JSON の符号化だけでは HTML 内に埋め込む JavaScript の安全性を保証しない。

この fixture は固定パス部品だけを使い、生成コードを一時ディレクトリへ書いて静的解析する。
外部入力、HTML sink、fixture の動的実行は見つからなかったが、自動 dismiss はしない。
値からのコード生成をなくし、引数を受け取らない固定2文字列の連結に置き換えた。
実入力 inventory と区別する分割を維持し、生成後の import は従来と同じである。
既存の literal dynamic import 実解決と forbidden-edge の回帰が出力先との一致を検証する。
sanitizer、検査抑制、CI 分類例外、production code の変更は加えない。

変更前後の実 initializer を固定式として読み、生成 JS が75 bytesで完全一致することを確認した。
既存 #745 全169件と boundary41件の合計210 tests、変更ファイル ESLint/Biome、
型検査、全体 knip は pass。独立 reviewer も差分・一次資料・生成比較を読み、
210 tests を別途実行して pass、追加指摘なしだった。

ローカルの CodeQL CLI は未導入で、修正後の実 scan／alert 再判定はまだ未確認。
旧 head の成功 CI を再実行せず、独立レビュー後の通常 push に伴う新 head の解析結果を
確認するまでは「alert 解決」と報告しない。
