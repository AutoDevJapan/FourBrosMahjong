# Unity display prototype — #818

自作の単色3Dプリミティブと文字を使う、表示専用の最小Unityプロジェクト。既存の
`documents/fixtures/unity-display-contract.json` を直接読み、4方向の河、リーチ牌横置き、
手牌のツモ間隔、3着席＋1抜け番、局替わり、演出・再表示を確認する。
ゲームクライアント、サーバー接続、ゲームルールの移植ではない。

**状態:** C#ソース、シーン生成手順、表示コアのテストを用意した段階。
Unity Hub/Editorはこの環境にインストールされておらず、Unityコンパイル・実行・描画・
ビルド・性能検証は未実施。Web画面や.NETテストをUnity実行証跡として扱わない。
最新の実施結果・残条件は [検証記録](../../documents/guides/unity-display-prototype.md) を参照。

## 開く・再生する

1. 候補版 **Unity 2022.3.62f2**（revision `7670c08855a9`）でこのディレクトリを開く。
   新規テンプレートを重ねて作成しない。macOS Editor/Standaloneを最初の検証対象にする。
   このpinは再現用候補であり、実行確認済み版・製品採用・最新版の主張ではない。
2. インポート/コンパイルが完了したら `Four Bros > Build display scene` を実行する。
   リポジトリのfixtureを検査・コピーし、`Assets/Generated/DisplayPrototype.unity` と
   単色マテリアルを生成する。初回の空シーンや既存作業シーンは保存確認後に切り替わる。
3. Playを押す。Gameビューを1440×1000程度にし、左パネルで各ケースを選ぶ。
   最初は俯瞰カメラ。`Tilt camera` で高さ・厚みを確認できる。
4. `Four Bros > Validate display contract` で、Unityの`JsonUtility`経由の同じ表示コア検証を実行する。
5. macOS向けビルドモジュールがある場合、`Four Bros > Build macOS prototype` で
   `Builds/DisplayPrototype.app` を生成する。起動後の見た目・操作を別途確認する。

`Assets/Generated/` は使い捨てで、シーン生成・ビルドごとに再生成される。
ここでの手編集やFBX割当を残したい場合はシーンを `Assets/Scenes/` などへ別名保存する。
候補版以外で開く際は、バージョン差と生成されたProjectSettings/package lockをレビューする。
外部UPM/Asset Storeパッケージは不要。manifestはEditor同梱のIMGUI、JSON、Physics、TextRendering
モジュールのみ。TextMeshとIMGUIの英数字ラベルで日本語フォントの追加を避けている。

## 表示と操作のチェック

| 操作 | 確認すること |
|---|---|
| 各`before`/`after`ボタン（12状態） | fixtureの全4回転・連荘・東4→南1。物理位置はplayer IDに固定、席風と抜け番だけ入力どおり更新。抜け番に河/手牌/席風なし |
| `River wrap` | 6列/4列の折り返し、捨て順、7枚目の赤い横向き牌、同じ河内と隣席の河との非重複 |
| `draw`/`replacement`（手牌欄） | 自家の最後の牌だけ追加の0.28単位の隙間。fixture指定の200msで入場 |
| `deal`/`meld` | index依存の配牌遅延／短い横移動。鳴き後の枚数・別置き牌の除去は固定表示例。鳴き合法性の判定なし |
| 9種のeffectボタン | discard、riichi、pon、kan、kita、tsumo、ron、draw、roundEnd。確定snapshotのeffect IDから1度だけ表示。kitaは当該プレイヤーのnorth表示も更新 |
| `discard` | 固定河に1枚追加、同一局の末尾追加時だけ入場。再度同じ表示内容を選んでも河全体を再演出しない |
| `Restore current snapshot` | 選択中の状態/点数/牌を保持し、演出・入場を再生しない（メモリ内JSON往復。認証resumeではない） |
| `Replay fixture version sequence` | `41:apply 42:apply 41:ignore 42:ignore 43:apply` をパネルとConsoleに表示 |
| 他家の手牌 | 牌面データを受け取らず、枚数だけから青い裏面を表示。FBXに牌面があっても裏面には使わない |

固定牌は既存Web見本に対応する文字付き図形で、合法な局の再現・牌山生成ではない。
河の折り返しは比較用の手動4/6列切替で、Web CSSの自動レスポンシブと同一ではない。
演出は文字と位置補間の見本であり、音声、Animator、アクセシビリティ通知、全鳴き面子、
ドラ・精算結果、実ゲームの入力・ネットワークは未実装。

## 境界と構成

- `DisplayContract.cs`: 表示DTO、入力検査、room/versionゲート、イベント重複抑止、純粋な座標計算。
- `FixtureScenarios.cs`: 既存fixtureの席・持ち点をそのまま12状態へ投影。席回転・点数・局進行の計算なし。
- `UnityDisplayPrototype.cs`: プリミティブ描画、200ms位置補間、IMGUI操作、復元。
- `OptionalModelAssets.cs`: 任意のFBX/Prefabを注入する`IDisplayAssetProvider`。
- `Assets/Editor/DisplaySceneBuilder.cs`: fixture検査、単一シーン生成、macOSビルド。
- `Assets/Editor/DisplayContractChecks.cs`: 実際のC#表示コアを検証する共通テスト。

`DisplaySnapshot` は試作用投影であり、既存 `OnlineSnapshot` JSONを直接渡せるものではない。
本番adapterはサーバー/Domainが確定したslot・牌表示・点数・演出IDを渡す。
`Apply` 後のsnapshotは呼出元で変更しない。schema/slot/秘匿境界検査はversion更新より先に行う。
同一roomの同値以下は無視し、room切替や初回・restoreでは過去演出を抑止する。
effect IDはroom内で一意とし、局替わりでも消費済みIDを再演出しない。新しいIDの演出は局替わり時も表示する。
transport、token、合法手、山、向聴、点数、フリテンの責務はここへ渡さない。

## 任意FBXとの接続（#1165）

基本シーンはFBXがなくても動く。任意で権利確認済みFBXを `Assets/Models/` へコピーし、
ラッパーPrefabを作ってルートの`OptionalModelAssets`に割り当てる。
`tile`/`table`はローカル原点中心・単位立方体の範囲（X幅/Y高さ/Z奥行き）、
`character`は足元原点、上+Y、正面-Z、高さ約1単位を想定する。
既存のモデルpivot/scale/向きを変更する必要がある場合は、Prefabの子Transformで補正する。
ランタイムに`.blend`を読む機構や外部Blender起動は追加していない。

並列作業#1165の予定出力は `prototypes/blender/generated/{MahjongTable,TilePin5,SoakuhinStudy}.fbx`。
元モデルはメートル単位で、卓の幅約0.94m/高さ0.78m、牌は0.026×0.036×0.018m、
人物は約1.8m。自動的に単位立方体になるとは限らないため、インポート後のRenderer.boundsを
確認してPrefab内で寸法・pivotを合わせる。アセットの実寸評価には#1165の専用プレビューを使う。
#1165はこのプロジェクトの`Assets/FourBrosBlenderStudy/`へ専用プレビューを追加する。
両変更を取り込むと、`FourBros > Blender Study`メニューでFBXの取り込みと実寸プレビューを
実行できる。#818単独ではこの追加メニューはなく、表示fixtureの試作は独立して動く。

この試作の座標単位は視認性のための任意単位で、実寸卓の物理シミュレーションではない。
リーチは注入したtileの親Transformを90度回す。文字ラベルはモデルと独立して追加する。
外部モデルにはスクリプト/Collider/マテリアル依存があり得るので、割当後のConsoleと描画は
プリミティブ検証とは別の証跡にする。

## UnityなしのC#検証

リポジトリルートから、.NET 8 SDKがある環境で実行する。NuGetテストパッケージは不要。

```bash
dotnet run --project prototypes/unity-display/Tests/DisplayContractChecks.csproj -- documents/fixtures/unity-display-contract.json
git diff --check
```

このコンソール検証は本番と同じ`DisplayContract.cs`/`FixtureScenarios.cs`をコンパイルする。
全12状態、4人の抜け番、点数ID保持、4/6列の河座標の席間を含む非重複、隙間、全演出/遷移、
version sequence、別room、初回/復元/局替わり時の重複effect、入力拒否後のwatermark不変を検査する。
河の検査は描画側も直接使う`DisplayLayout.RiverOnBoard`を通し、通常時と打牌追加後の回転済み牌の境界を比較する。
パーサーは.NET側では`System.Text.Json`なので、Unityの`JsonUtility`の検証はEditor側で必要。
`UnityEngine`依存コードのコンパイルを代用するものではない。

このC#検証は**CIでは実行されない**（`.github/workflows/ci.yml` に`dotnet`は無い）。
そのためC#の宣言とfixture・Web実装の乖離は、`src/test/unity-display-csharp-contract.test.ts`
（.NET不要、`pnpm test`に載る）が別途固定する。検査対象は
`DisplayValidation.EffectKinds` / `TransitionKinds` と、契約の `kinds` / `unityOnlyKinds` /
`transitionKinds` / `drawEntranceDurationMs`、Web側の `GameEffectKind` /
`HAND_ANIMATION_DURATION_MS`。C#のコンパイル・実行の代用ではない。

`kita`（北抜き・ガリ）はC#の`EffectKinds`にあるが、Web側`gameEffect`には演出実装が無い。
契約では `unityOnlyKinds` として分離している。Unity側の `UnityDisplayPrototype` には
`kita` ボタンと共通の文字演出、`FixtureScenarios` には北枚数の更新が実装済み。
Editor上の実描画検証と専用表現の検討は未完了で、Web側には比較用の演出見本が無い。

インストール済みUnityのCLIでの後続検証例（今回未実行）:

```bash
UNITY_EDITOR=/Applications/Unity/Hub/Editor/2022.3.62f2/Unity.app/Contents/MacOS/Unity
"$UNITY_EDITOR" -batchmode -quit -projectPath "$PWD/prototypes/unity-display" -executeMethod FourBros.Display.Editor.DisplaySceneBuilder.Validate -logFile /tmp/unity-818-validate.log
"$UNITY_EDITOR" -batchmode -quit -projectPath "$PWD/prototypes/unity-display" -executeMethod FourBros.Display.Editor.DisplaySceneBuilder.BuildMac -logFile /tmp/unity-818-build.log
```

生成/ビルドの成功だけで視認性・操作遅延・実機負荷を合格扱いしない。
実機、Unity版、commit、解像度を記録し、上の操作表の画面/録画とProfiler計測を添付する。

## 素材と参照

追加したC#・配置・文字列はこのIssue向けの新規実装。OSSのC#/Prefab/Animationや
Majsoul画像・音声・フォント、既存キャラクター/UI原本はコピーしていない。
プリミティブ、Unlit/Color、組込みフォントはUnity同梱機能を利用する。
任意FBXと本番素材の権利確認・配布判断は別途必要。

- [Unity 2022.3.62f2公式リリース](https://unity.com/releases/editor/whats-new/2022.3.62f2): pin/revisionの根拠。
- [JsonUtility.FromJson](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/JsonUtility.FromJson.html): field形式のDTO。
- [BuildPipeline.BuildPlayer](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/BuildPipeline.BuildPlayer.html): 明示的なEditorビルド入口。
- [既存OSSテキスト調査/権利境界](../../documents/guides/unity-display-feasibility.md)。OSS再調査・コピーは今回実施していない。
