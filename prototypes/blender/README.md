# Blender → Unity 3Dアセット試作（#1165）

Blender 5.2.0 LTSで制作・保存・FBX書き出し・再読み込みまで実行した、卓／五筒／粗悪品の簡略静止モデル。#818のUnity表示試作と独立して確認できる。**Unityでのコンパイル・取り込み・実画面確認は未実施**（2026-09-07、ユーザーからEditor／Hub未導入と確認）。

![Blenderでレンダリングした卓・牌・人物](generated/blender-preview.png)

## 成果物

| ファイル | 内容 |
|---|---|
| `generated/fourbros-study.blend` | 編集可能なBlenderシーン。名前付きメッシュ・UV・材質・照明・カメラを含む |
| `generated/MahjongTable.fbx` | 幅94cm、天板高さ約78cmの卓 |
| `generated/TilePin5.fbx` | 幅26mm、長さ36mm、厚さ約18.5mmの五筒。牌面はメッシュ形状 |
| `generated/SoakuhinStudy.fbx` | 高さ約180cm、黒髪・黒い上着・赤いラインの人物試作 |
| `generated/manifest.json` | バージョン、寸法、ポリゴン数、材質パレット、出典ハッシュ、生成時間 |
| `generated/revision/` | 保存済み`.blend`を開き、フェルトだけ緑→青に変更した再書き出し版 |
| `generated/fbx-validation.json` | 基準版＋改訂版の計6FBXをBlenderへ実際に再読み込みした検証結果 |
| `generated/tile-detail.png` | 五筒の牌面の実レンダー |
| `../unity-display/Assets/FourBrosBlenderStudy/` | Unity用取り込み・材質再適用・シーン作成・カメラ／牌移動スクリプト。未実行 |

## 再生成

リポジトリルートから実行する。既存の出力や手動編集を上書きしないよう、生成先は**空のディレクトリ**を指定する。既存成果物は読み込みだけで確認でき、再生成は不要。

```sh
# macOSの例。別環境ではBlenderの実行ファイルパスを変更する。
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup --python-exit-code 1 \
  --python prototypes/blender/build_assets.py -- \
  --output prototypes/blender/validation-local/baseline --render

# 保存した実ファイルを開き、フェルトを変更して再保存・FBX再書き出し
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup --python-exit-code 1 \
  --python prototypes/blender/revise_assets.py -- \
  --baseline prototypes/blender/validation-local/baseline \
  --output prototypes/blender/validation-local/revision

/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup --python-exit-code 1 \
  --python prototypes/blender/verify_fbx.py -- \
  --baseline prototypes/blender/validation-local/baseline \
  --revision prototypes/blender/validation-local/revision \
  --report prototypes/blender/validation-local/fbx-validation.json
```

コミット済み成果物だけを再検証する場合、最後のコマンドのbaseline/revisionを`prototypes/blender/generated`とその`revision`へ変更し、reportだけ`validation-local/`へ出す。成功条件は終了コード0と`PASS: 3 assets`。失敗時は`--python-exit-code 1`で非ゼロ終了する。

## Unity側での確認手順（未実施）

対象候補はmacOS Editor、Built-in Render Pipeline、Unity 2022.3.62f2（#818と共通）。実行後にEditorの正確な版を記録する。URP/HDRPのシェーダー変換は対象外。FBXはUnityが主にサポートするモデル形式のため採用した（[Unity公式](https://docs.unity3d.com/2022.3/Documentation/Manual/ImportingModelFiles.html)）。

1. Unity Editorのインストールとライセンス認証を済ませる。#818と#1165の両変更を含むcheckoutで`prototypes/unity-display`を開く（Unityプロジェクト設定は#818側で追加）。
2. `Assets/FourBrosBlenderStudy/`のスクリプトがコンパイルされ、`FourBros > Blender Study`メニューが現れることを確認する。#1165単独の場合は空の3D Built-inプロジェクトへこのAssetsサブフォルダーをコピーしてもよい。
3. `Edit > Project Settings > Player > Active Input Handling`を`Input Manager (Old)`または`Both`にする。
4. `FourBros > Blender Study > 1 Import baseline`を実行する。リポジトリ配下のUnityプロジェクトなら`prototypes/blender/generated`を自動検出する。外部プロジェクトならフォルダーを選ぶ。
5. `2 Build asset preview scene`を実行する。既存の開いているシーンは保持し、追加シーンを固有名で保存する。プレビューシーンだけを開いてPlayし、右ドラッグで周回、ホイールでズーム、Spaceで牌を200msで移動させる。
6. 人物の正面・卓の上面・五筒の牌面が正しく向いているか、1 Unity unit＝1mの寸法かを確認する。材質はmanifestのパレットからStandard材質へ明示的に割り当てる。BlenderとUnityの照明・色管理による差も確認する。
7. Playを終了し、各モデルのTransformとFBXのGUIDを記録する。`3 Reimport blue felt revision`を実行し、フェルトだけ青に変わり、モデル参照・配置が保持されるか確認する。スクリプトは`.meta`を残し、既存GUIDの不一致をエラーにする。
8. Unityのスクリーンショット／短い録画、Consoleエラー、Profilerのフレーム時間・メモリ、実機／画面解像度を記録する。Blenderの証跡をUnityの証跡として扱わない。

`.blend`にある人物・卓の横並び配置は撮影用。FBXはアセットごとに原点へ戻して書き出す。BlenderはZ-up、FBXはY-up／forward -Z、単位はm。Unityでの最終軸変換は手順6で未検証。

## 実測と品質判断

| アセット | メッシュ数 | 三角形数 | FBX容量 | UV付きメッシュ |
|---|---:|---:|---:|---:|
| 卓 | 18 | 1,656 | 90,572 bytes | 18 |
| 五筒 | 12 | 2,056 | 85,884 bytes | 12 |
| 人物 | 86 | 11,228 | 470,924 bytes | 86 |

全メッシュにUVを作成している。画像テクスチャは0 bytesで、単色材質とメッシュの牌面を使う。UVはパーツごとの自動展開で、全身を1枚のアトラスにまとめた状態ではない。元画像をテクスチャとして貼り付けていない。

Blenderで基準／改訂FBXを各3種読み込み、バウンディングボックス（許容誤差10µm）、三角形数、メッシュ数、UV、法線、材質名、改訂前後のオブジェクト名を確認した。改訂比較は各メッシュのワールド座標の全頂点と面の接続も比較する。基準／改訂ともFBXの色が対応manifestに一致し、改訂版ではFeltの色だけ変わり、他の色と形状は変わらないことを確認した。全体移動・内部頂点変形・manifestとの色不一致を検出する負の検証も各アセットで実行した。

人物の正面シルエット・黒髪・黒／赤の服装は確認できるが、元絵の顔つき・刺繍・布の質感の再現度は低く、本番キャラクター品質には達していない。リグ・ウェイト・待機動作は未実装。五筒は拡大画像で識別できるが、実ゲームのカメラ距離での読みやすさはUnityで確認が必要。116メッシュをそのまま使うため、材質統合・メッシュ統合・牌面アトラスによる軽量化を本番前に検討する。

基準版の制作＋CPUレンダーの1実行は約15秒（`manifest.json`）。これはスクリプト実行時間であり、設計・実装・レビューを含む制作総時間でもUnityのフレーム時間でもない。Astraの利用トークン／課金額はこの実行環境から取得できないため未計測。Unityの負荷・入力遅延・ビルド容量は未測定。

## 判定と残りの作業

**Blender制作とFBX書き出しはGo。Unity連携の完了判定は保留、本番採用はNo-Go。**

- [x] 卓・牌・キャラクター1体の編集元とFBXを保存した。
- [x] `.blend`を編集した改訂版を再書き出しし、Blender再読み込みで比較した。
- [x] レンダー・ハッシュ・寸法・三角形数・実行手順を保存した。
- [ ] Unityのコンパイル、取り込み、カメラ操作、牌移動を実画面で確認する。
- [ ] Unityで再取り込み時の配置・参照・材質を検証する。
- [ ] Unity側の録画と負荷測定を保存し、#818の表示シーンと合わせてGo／No-Goを更新する。

後続の分割案: 全牌種の牌面／アトラス化、残り3キャラクター、顔・衣服の品質改善、リギング／待機動作、Unity性能測定。表示・演出・4人回しの契約は#818、ルール・点数・合法性は既存server/domainに置く。

## 出典・制作記録

ユーザー指示: 「Astraを用いてBlenderとUnityを連携」「#818、#1165を開発」。本試作はその範囲でAstraがPythonとC#を作成し、Blender CLIを実行した。MCP接続は使っていない。手動のBlender GUI編集なし。AIによる画像生成サービスも使用していない。

人物の参考: `documents/assets/characters/originals/p0-soakuhin-character-sheet.png`。画像を目視し、色・髪・服の特徴を簡略形状にした。胸の円形花模様は幾何形状の仮意匠で、元の刺繍の複製ではない。参照画像のSHA-256はmanifestに記録。利用根拠・未確認の権利情報は[既存CREDITS](../../documents/assets/characters/CREDITS.md)を継承し、この試作で新たな再配布ライセンスは付与しない。卓・牌の形状は今回のスクリプトで作成。OSS／Majsoul由来のモデル・画像・音声は取り込んでいない。

`/godd-a/dev`はローカルコマンド定義を読み、MCPサーバー起動を試したが`GODD_LICENSE_KEY is required`で終了した。GoDD自体の実行成功とはせず、計画→実装→検証→品質確認→文書化を手動で実施した。
