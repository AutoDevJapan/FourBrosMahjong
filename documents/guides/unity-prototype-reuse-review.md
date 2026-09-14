# Unity／Blender試作の再利用前レビュー（2026-09-15）

#1177／#1179が参照する、#818／#1165の保存済み修正と検証記録を整理した。
本資料の対象は表示試作とアセット試作であり、実対局との接続・ブラウザ向け3D方式の採用・
本番配布の完了判定は各実装Issueで行う。

## 取り込む修正と順序

| 元の保存コミット | 親 | 修正の内容 |
|---|---|---|
| `01fe89514cdf357f7a82fb0f12185279ed1f3fa7` | `2074f2cae28745907396c957a21c63b944dd8b3a` | #1165: FBXの向き、空の起動シーン、環境光、カメラ／牌操作の共通処理、Unity取込・再取込の検証器と証跡 |
| `188838137085c1805620d13ace4c112e72d19f11` | `01fe89514cdf357f7a82fb0f12185279ed1f3fa7` | #818: JsonUtility往復時の任意値の有無、牌文字寸法、左パネル背景、実Player検証器と証跡 |

上記順で通常のcherry-pickを行い、競合はなかった。取り込んだ31ファイルは
`1888381`の保存内容とバイト単位で一致することを確認した。
その後の整理は本資料とREADMEの案内のみで、C#、fixture、FBX、画像、測定JSONを変更していない。
他の保存ブランチにある運用・CI変更は含めていない。

復元修正は、検証済みのメモリ内snapshotに任意値の有無を添えてJSON往復する。
外部の不正JSONを補正して受け入れる処理ではなく、入力前と復元後の検証を維持している。
カメラ・牌操作と表示の検証器は実際の操作ハンドラを呼び、通常起動では自動実行しない。

## 再利用する既存証跡

| 証跡 | 確認できる範囲 | 引き継ぐ制約 |
|---|---|---|
| [Unity表示の実行記録](unity-display-prototype.md)と[Playerレポート・PNG](../evidence/unity-display-20260908/) | 2026-09-08、Unity 2022.3.62f2／macOS／M2／Metal。実JsonUtilityの2,267 assertions、2解像度のPlayer各6,954 assertions・errors 0、各44枚生成のうち9枚収録 | 固定fixture、Developmentビルド。物理入力・GPU完了・画面走査の遅延、WebGL、実対局接続、対象端末全体の性能を保証しない |
| [Blender→Unityの検証記録](../../prototypes/blender/README.md#unity実測2026-09-08)と[測定JSON](../../prototypes/blender/generated/unity-validation-2026-09-08/unity-validation.json) | 6FBXのSHA-256、取込・再取込時のGUID／配置／参照／幾何／材質、4枚のGPU描画、共通コントローラー処理 | 3資産のみ。物理入力、Player FPS、表示試作と合算した負荷、全牌種、製品キャラクター品質は未検証 |

2026-09-15には保存画像13枚を目視し、2件のPlayerレポートの件数・errors・解像度・
測定値の形式、収録PNG9枚の寸法を読み直した。Blender側のPNG4枚とFBX6本は
既存のVitestで記録SHA-256との一致も再検査した。過去のUnity未導入記録は履歴として残す。
これらは保存証跡の再確認であり、新たなUnity／Blender実行や性能の再測定ではない。

## このレビューで実行した軽量検証

リポジトリルートで、Node 26.7.0／pnpm 10.33.0を使用した。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec vitest run --project unit src/test/blender-asset-study.test.ts src/test/unity-display-contract.test.ts src/test/unity-display-csharp-contract.test.ts
python3 -m unittest discover -s prototypes/blender -p test_compare_builds.py
pnpm exec eslint src/test/blender-asset-study.test.ts src/test/unity-display-csharp-contract.test.ts
pnpm typecheck
pnpm check
git diff --check
```

結果はVitest 3ファイル21件、Python 3件、対象ESLint、TypeScript、Biome 491ファイル、差分検査が成功。
READMEの履歴見出しリンク修正後には、Blender対象10件を再実行して成功を確認した。
Unity EditorとBlenderの実体は存在する。`dotnet`はこのシェルに無く、.NETチェックは再実行していない。
ネイティブ実装・fixture・アセットを変更していないため、既存のUnity実行結果を再利用した。
TypeScriptの検査をC#コンパイルや実描画の代用とはしない。

## 後続で追加する検証

| 変更・採用の対象 | 必要な追加検証・担当 |
|---|---|
| C#復元・表示契約・描画の変更 | [Unity README](../../prototypes/unity-display/README.md)の実JsonUtility検査と変更対象のPlayer検証。描画変更時は2解像度のPNG／遷移を再採取 |
| FBX・材質・インポーター・カメラの変更 | [Blender README](../../prototypes/blender/README.md)の再取込／寸法／参照／実描画検証。生成器変更時はBlender再生成・幾何比較も実行 |
| 実対局の状態・合法操作・復元との接続 | #1177。固定fixtureを実エンジンの結果へ置き換え、秘匿境界・操作・再接続対象範囲を確認 |
| ブラウザ向け方式・本番ルートへの組み込み | #1179。対象ブラウザ／端末、起動・解放・失敗時復帰、ビルドと配布を検証。macOS Standaloneの成功を流用して完了にしない |
| 製品素材と軽量化 | #1180。必要牌種、可読性、メッシュ／材質、権利証跡を確認。物理入力と端末負荷は#1181と連携 |
| 公開前の統合受け入れ | #1181、#725／ADR-0006。認証済みexact-head Previewと正確なProduction deployment／canonical URLの検証、#1175の素材権利判断を維持 |

#818／#1165の旧い「Unity未導入」を新たな導入タスクとして繰り返さず、上記の未達条件へ進む。
本資料の追加や試作修正の反映だけで、親Issue・本番3D化・素材権利・release条件を完了扱いにしない。
