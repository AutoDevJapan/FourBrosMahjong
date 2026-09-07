# #818 Unity表示プロトタイプ実装記録

2026-09-07 JST。基準commit `43bb819`。既存の表示契約・Webリファレンスと過去の
テキストスパイクを再利用し、`prototypes/unity-display` に表示専用C#プロジェクトを追加した。
手順・ファイル構成・FBX接続口は [プロジェクトREADME](../../prototypes/unity-display/README.md) を参照。

## 判定

**最小プロトタイプのコードレビュー・実Unity検証へ進める。製品採用はNo-Goを維持する。**
ユーザーは#818/#1165の実装を依頼し、Unity Hub/Editorが未インストールであることを確認した。
Unityを起動・インストール・認証・ビルドしたとは扱わない。今回追加したのは、
実行可能な表示コア、Unity向け描画コード、再生成可能な1シーンのEditor入口と検証手順である。
生成済み`.unity`やUnityスクリーンショットはまだない。

| 項目 | 選定・結果 |
|---|---|
| 最初の対象 | macOS Unity Editor / macOS Standalone。現作業端末と同じOSで表示を先に検証するため |
| 固定候補版 | Unity **2022.3.62f2**, revision `7670c08855a9`。既存2022.3候補を再現可能に固定。[公式リリース](https://unity.com/releases/editor/whats-new/2022.3.62f2)に存在とrevisionを確認。実行確認済み版・最新推奨版・製品採用ではない |
| OSS側の2019.1.8f1 | 採用せず。古いPrefab/アセット依存を導入しない新規表示コードとする |
| 外部パッケージ | なし。Unity同梱IMGUI/JSON/Physics/TextRenderingモジュールだけを明示 |
| 牌・卓 | 自作コードによる単色キューブと英数字TextMesh。既存キャラクター原本・OSS Assetsの流用なし |
| 実行済み環境 | macOS ARM64、隔離した一時ディレクトリの.NET SDK **8.0.424**。表示コアのみ |
| 未実行環境 | Unity Editor/Runtime、Unity C# APIコンパイル、JsonUtility、実機描画、Standalone/WebGL/iOS/Android |

## 実装した範囲

既存fixtureから4回転×前後＋連荘/東4→南1×前後の**12状態**を読み込む。
player IDの物理位置はfixtureの`slotShape`に固定し、席風・抜け番・点数は各入力値から表示する。
Unity側に親流れ・連荘・点数・ルールの導出コードは置いていない。

河は6列/4列を切り替え、横向きリーチ牌の幅を考慮して隣接牌と間隔を取る。
手牌は自家のみ牌面を受け取り、他家は枚数だけから裏面を表示する。
ツモ/置換200ms、決定的な配牌遅延、鳴き後整列、打牌末尾追加の短い位置補間を用意した。
9種の演出（既存8種＋北抜き）は、コミット済み表示snapshotのeffect IDから表示する。
演出は文字バナーであり、フルアニメーション・音声・スクリーンリーダー通知の完成品ではない。

表示ゲートは同一roomの同値/古いversionを拒否し、不正な入力ではwatermarkを進めない。
初回・room切替・復元時は過去のeffect/牌入場を再演出しない。
UIには固定version sequence再生と、現在のsnapshotをJSON往復で復元する操作を置いた。
これはメモリ内の表示復元であり、オンライン認証・resume・保存永続化の実装ではない。

`IDisplayAssetProvider` / `OptionalModelAssets`をFBX注入口とし、未割当ならプリミティブを使う。
#1165のBlender出力と専用Editorプレビューは別レーンの成果物で、#818単独の依存にしない。
寸法・原点・軸の整合やFBX取り込み成功はUnity上で別途確認が必要。

## 実施済み検証

リポジトリルートで実行したコマンド（`dotnet`は一時SDKの実行ファイル）:

```bash
dotnet run --project prototypes/unity-display/Tests/DisplayContractChecks.csproj -- documents/fixtures/unity-display-contract.json
git diff --check
```

結果: **237 assertions passed**。実際の`DisplayContract.cs`と`FixtureScenarios.cs`を
.NET 8でコンパイル・実行した。独立したJSによるC#ロジックの模倣テストではない。

- 12状態の座席投影、4人全員の抜け番、点数のplayer ID紐付け、他家の牌面非公開
- fixture指定の演出・手牌遷移の網羅、200ms、北抜き・鳴き後の表示例
- 4/6列の河座標、捨て順、リーチ横向きと隣接牌の非重複、ツモ牌の追加間隔、4方向角度
- `41 apply → 42 apply → 41 ignore → 42 ignore → 43 apply`
- 同一effect IDの重複抑止、リロードの静的復元、room切替、明示restore
- schema違い、抜け番の風/北、他家牌面、重複player/position、null牌の拒否、拒否後の正常復帰

`git diff --check`は成功。C#チェックは同じコードをEditorメニューからも実行できるが、
今回の.NET実行ではパーサーに`System.Text.Json`を使っている。
**Unity APIのコンパイル、JsonUtilityの解析、GameObject配置・回転、文字・演出の描画は未確認**。
Unityの代用品としてAPIスタブを作ってコンパイル成功とすることも行っていない。
Web実装を変更していないため、既存WebテストをUnity成果として再掲しない。

## 受け入れ条件の残り

| #818の条件 | 今回の到達点 | 完了に必要な確認 |
|---|---|---|
| プラットフォーム/版/環境/理由 | macOS、2022.3.62f2候補と未実行状態を記録 | 実際に起動した版・OS・ハードウェアを追記 |
| 河・手牌・向き・演出 | 描画コード・再生成シーン入口・純粋座標テストあり | Unityで起動し12状態と操作表を確認、スクリーンショット/短い録画 |
| 全席回転・局替わり・復元 | fixtureとC#状態投影/ゲートの実行テスト成功 | 実GameObjectの再配置と過去演出抑止を録画確認 |
| SSOT維持 | 表示のみ。ルール・点数・席回転計算・通信なし | 本番adapter追加時にも境界を維持 |
| 権利境界 | 新規コード/プリミティブ/Unity同梱機能に限定、第三者Assetsコピーなし | 任意FBXと本番素材の権利根拠・配布条件を別途レビュー |
| 証跡・負荷・コスト | 手順、検証結果、未達を記録 | Unity画面証跡、入力遅延、frame time、memory、build size |
| Go/No-Go | 本番No-Go、実Unity検証へ進める | 上記ゲートを実証してから製品採用を判断 |

実機記録にはcommit、Unityの正確な版、OS/CPU/GPU、解像度、使用アセットを含める。
固定操作表を再生してConsoleの例外ゼロ、河/手牌の欠落・重複・オーバーラップなしを確認し、
ProfilerでCPU/GPU frame time、GC、メモリを記録する。ボタン入力から次の表示frameまでの
遅延は録画/計測で測り、ビルドログのサイズと一緒に記録する。推測値は埋めない。

既存の8.5–17人日は全スパイクの計画レンジのままで、今回の実績値ではない。
追加の計画目安は、環境・ライセンス・対象端末が揃った後のUnityコンパイル/描画調整と
証跡作成1–3人日、性能/入力/ビルド確認1–2人日。今後の表示契約変更1回あたりの
追随レビュー/fixture更新/Unity再検証は0.5–1人日を仮置きする。実測工数でも確約でもなく、
不具合規模・端末数・権利確認の待ち時間は含めない。

後続の分割は既存計画の`unity/assets-rights`、`unity/performance`、`unity/transport`、
`unity/release-gate`を維持する。今回#818を完了として閉じず、最初にこのプロジェクトの
Unity実行・生成シーンの画面証跡を取る。重複する新規Issueは作成していない。
