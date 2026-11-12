# #1191: Tailwind の入力境界

## 2026-11-09の再利用範囲（当時の記録）

以下は3D候補の保存済みcheckpointで、後続の入力境界修正と実行結果は末尾に追記する。

本資料の2026-09-15の数値・CI/Preview確認は保存された旧headの履歴であり、現行branchで再実行した結果ではない。
現行は [ADR-0006](../../documents/adr/0006-prd-only-deployment.md) のPrd専用運用を使い、localhost/CI隔離検証と通常マージ後の既存Production確認を行う。新しいPreview/dev/stgを作成しない。
画像の一般公開・再配布は2026-11-07の提供者回答と各CREDITSに従う。CSS境界は画像公開の許否を決めるものではない。

`src/components/game/three/` と `src/components/game/characters3d/` はCSS走査にもCI full検証にも残す。
キャラ原本はオフライン制作とhash検証だけが読み、geometryのsource path文字列を持つことと原本のruntime importを区別する。
`documents/assets/` のruntime value importは禁止したまま、明示的なtype-only参照はこのCSS境界の対象外とする。domain/presentationの型依存方向ルールは引き続き有効である。
現行の合成canaryには `three/` と `characters3d/` の保持ケースを追加し、4除外・6保持を検証する。今回の一時フォルダー作成条件ではこの隔離canaryは未実行とし、実repoのread-onlyスキャンと旧Macのcanary実測を分けて記録する。

## 対象と根拠

Tailwind は import graph ではなくファイルをテキストとして走査する。`@source not` のパスは stylesheet からの相対である（[公式仕様](https://tailwindcss.com/docs/detecting-classes-in-source-files)）。そのため JavaScript が import しない native 資産も CSS の入力になり得る。今回の変更は CSS の入力だけを狭め、検証範囲の分類・CI・native 検証ゲートを変更しない。

| 境界 | 現在の consumer と扱い |
| --- | --- |
| `prototypes/` | Unity C# / Blender のコード・生成物。`blender-asset-study.test.ts` と `unity-display-csharp-contract.test.ts` が内容を読む。CSS から除外するが、これらのテストも native build/render 検証も省略しない。 |
| `documents/evidence/` | 実行結果・検証記録。基準 `2074f2c` には存在しないため、将来の JSON 混入は一時 fixture の実スキャナ canary で確認する。CSS から除外する。 |
| `documents/assets/` | 素材原本・UI 更新監査 manifest。`ui-refresh-assets.test.ts` と `scripts/verify-ui-refresh-assets.mjs` が inventory/hash を読む。Web が配信する `public/` とは別。CSS から除外する。 |
| `documents/fixtures/railway-pre-cutover.json` | Railway 移行契約モジュールとテストが読む、移行前状態の fixture。CSS からこのファイルだけを除外する。 |
| `documents/fixtures/railway-readyz-before-iac.json` | readyz移行前状態のfixture。単体テストの入力であり、CSSから除外する。 |
| `.godd/` | 配布しない作業メタデータ。CSS・Git・ESLint・TypeScriptの自動入力から除外する。 |
| `**/__testing__/` / `**/__oracle__/` | テスト専用のfixture・比較実装。CSSから除外し、これらから検証資産へのimportを許可する。本番moduleからこれらへのimportは許可しない。 |
| `documents/fixtures/unity-display-contract.json` | `src/components/prototype/UnityDisplayReference.tsx` の本番 import、Unity 契約テスト、`e2e/unity-display-reference.spec.ts` が読む。CSS 走査に残す。 |
| `src/` の本番コード、`public/`、その他の runtime fixture | 従来の走査を維持する。`documents/` 全体の除外は行わない。 |

## 再発ガード

- 除外指令の回帰テストは監査コードの`BOUNDARY_SOURCES`を参照する。実graphの境界照合も同じ一覧を使い、tracked pathと正負のcanary全体でdependency-cruiser側の範囲との一致を確認する。
- 実際に lock された `@tailwindcss/postcss` と、その package が使う PostCSS を起動する。実 repo の入力 graph で `src` と Unity fixture が残り、除外先が消えることを確認する。
- 一時 repo の8除外先に独立したクラス canary を置き、入力 graph と生成 CSS の両方から消えることを確認する。`src`、Unity fixture、別 runtime fixture、類似名ディレクトリの5 canary は残す。除外指令だけを消した正対照では全13 canary が現れる。別の base でコンパイルし、スキャナの状態を共有しない。Windowsではnode_modulesの接続にjunctionを使い、symlink作成権限を必要としない。
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

## 2026-11-10 main 更新への追従

元head `aac804c` の実装を現在のmain `6cf781e` へ正常mergeし、exports-only CSS compilerとmainのSDK両方の解決canaryを保持した。非runtimeの4境界に作業メタデータ`.godd/`を追加し、実行時importの禁止側も同じ範囲に揃えた。本番src/publicとUnity契約fixtureは保持する。

未追跡の`.godd/`はローカルに保持し、`.gitignore`で公開対象から明示的に外す。Knipもこの既存の除外機構を使うため、作業用probeを配布ソースの未使用ファイルとして扱わず、Knip独自の重複ignoreは追加しない。

実rootの比較は、私的な作業メタデータを両条件で除外した公開ソース条件で行う。旧stylesheetを使う条件にも同じmetadata除外を加えるため、無視ファイルを含まないmainのcheckoutと同じ比較範囲になる。実`.godd/`を前提条件確認のため再走査しない。除外指令そのものは、隔離した所有fixtureに既知のmetadata canaryを置き、明示的なsource指定と除外削除の正対照で検証する。依存pathはWindowsでもPOSIXへ正規化する。

lock済み`@tailwindcss/postcss` 4.3.3/PostCSS 8.5.25、`optimize:false`で、前後とも52,242 bytes、SHA-256 `fa076e0da6ff2d8d43c43f60a1351847607834c6f22c9c5e414f8b9d6bd1179e`、全バイト一致。依存308→260、除外48/追加0、出力側metadata依存0件。これは同一の現在source treeでstylesheetだけを切り替えた比較で、旧commit全体とのbuild比較ではない。

入力分類・依存境界・実compilerの関連3スイート242件が成功。元の公開済みCI失敗、修正、旧Previewの証跡は上の履歴として保持し、現在の配備先をPreviewへ戻す根拠にはしない。現在はmain→既存Productionだけを使用する。今回の同一CSS出力は3D外観採用や製品全体完成の判断を代替しない。

## 追加の入力境界修正

現在mainで追加済みのreadyz移行fixtureと、テスト専用の`__testing__` / `__oracle__`もCSS走査から除外した。依存境界は同じ範囲へ揃え、テスト専用helperの正当なconsumerは残した。元の修正で明示した`.godd/`の除外はESLintのflat configとTypeScriptにも反映した。ESLintの検証は、存在しない仮pathに対する`isPathIgnored`で行い、実メタデータの内容を読まない。

修正前は、新しい回帰テスト8件が意図したassertionで失敗した（compiler canary、移行fixtureとhelperへのruntime import、helperの正当なconsumer、ESLintとTypeScriptの除外）。Windowsのfixture接続はjunctionへ変更した。境界一覧の整合テストは全tracked pathと正負のcanaryを照合し、監査・CSS指令・importルールの範囲がずれた場合に失敗する。

`6cf781e`のstylesheetを基準に、同じ現在source treeで再測定した結果、CSSは前後とも52,242 bytes、SHA-256 `fa076e0da6ff2d8d43c43f60a1351847607834c6f22c9c5e414f8b9d6bd1179e`、全バイト一致だった。入力依存308→253、除外55/追加0。直前の260件から減った7件は、readyz fixture1件とテスト専用module6件である。実作業メタデータは両条件で除外したまま、隔離fixtureでその除外を対照検証した。末尾LFなしの対照は52,241 bytes、LFを保持すれば元出力と一致する。

関連3スイート250件、型検査、変更ファイルESLint、全体Biome・Knip・dependency-cruiserが成功した。TypeScriptの入力一覧にmetadataは0件。依存検査は457 modules / 1,519 dependenciesで違反0だった。全tracked pathの整合テストは初回、dotfileをglob照合が拾わない4件で失敗したため、directoryの範囲をdotfileも含むprefixへ修正して再確認した。

上の308→253はオンライン戦績統合前の`8116dd5`時点の記録である。最新main`2ac7588`を取り込んだ`758a896`でも関連250件が成功し、同mainのstylesheetを基準に再監査した。CSSは同じ52,242 bytes・同じSHA-256で前後一致、入力311→256、除外55/追加0だった。オンライン機能のruntime module追加による母数の増加と、CSS境界の効果を区別する。

## 3D候補への最新境界の統合

オンライン戦績と最新mainのCI入力検査を統合し、上記の8除外・5保持へthree/characters3dの保持canary2件を追加した。型専用の契約参照はCSS境界だけで許可し、runtime value importは引き続きerrorにする。レイヤーの型依存方向検査は維持する。過去のcanary未実行は当時の記録として残し、この統合版の実行結果とは区別する。

この3D統合treeで実compilerを再実行し、main `2ac7588`のstylesheetとの比較は前後52,806 bytes、SHA-256 `8a98626e97dbe060c62b3ea7a24d49def88f2851d2987397dcd22456b6cc7268`で一致した。依存351→287、除外64/追加0。3D候補を含まないCSS単独headの52,242 bytesや311→256と混同しない。8除外・7保持canary、除外削除の正対照、型専用参照の実解決とruntime value拒否を検証した。型・変更箇所Lint・全体Biome/Knip/依存検査は成功し、依存検査は514 modules / 1,765 dependenciesで違反0だった。描画・モデルのcore sourceは保存済みの3D候補から変更していないが、過去のGPU実測を新しい統合版や本番で再実行したとは扱わない。
