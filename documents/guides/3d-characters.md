# 四兄弟3D候補の素材と再供給

`src/components/game/characters3d/` は [#1196](https://github.com/AutoDevJapan/FourBrosMahjong/issues/1196) のモデル・リグ・動作を供給する。外見は未承認候補で、通常対局の人物表示は既定で無効である。
表示名と色は `src/domain/game/characters.ts`、外見は人物原本4枚の前・横・背面を基準とする。自作コードのMIT Licenseと、画像の [CREDITS](../assets/characters/CREDITS.md) を保持する。

## 表示との接続

```ts
const model = createCharacterModel("p0");
const pose = sampleCharacterPose(model, "seated-idle", seconds);
const batches = projectCharacterGeometry(model, pose);
```

頂点はexpanded triangleの `xyz / normal xyz / uv`、32-byte stride。骨格はmetres・Y-up・正面+Z・立位両足間の床面原点である。
19ボーン、最大4skin influences、13clipを同じ編集元から生成する。UVはrest poseで固定し、姿勢の更新中に再投影しない。CPUのlinear blend skinningはGPUへ渡す頂点を生成するだけで、WebGL・DOM・React・timerを所有しない。

`createCharacterController()` は公開 `DisplayEnvelope` を使う。
`publish(frame, frame.cues ?? [], frame.roundKey ?? "round-0", seconds)` → `sample(seconds, reducedMotion)` → `projectCharacterSurfaces(actors)` → `runtime.setCharacters(surfaces)` の順に接続する。
actor IDは確定cueから受け、名前・席・点数差で宣言者を推測しない。初回とrestoreの過去cueは再生しない。live新局のdealは再生し、同版・旧世代・重複IDは拒否する。
同じactorは配列順、異なるactorは並行。新revisionでは以前の動作を破棄し、ゲーム進行を演出の終了で待たせない。actorごと最大1024件、合計再生時間4秒へ圧縮し、overflow batchは待機同期する。大量cueが全て視覚的に区別できる保証はない。

GPU buffer、24fps以下の時計1つ、visibility/reduced motion、寿命と失敗時の2D継続は [ブラウザ3D表示仕様](../spec/browser-3d-display.md) に従う。

## Textureと補完

`material.texture` は `textures/p0-reference.jpg` 等のrepository source keyである。配信にはNext static importのcontent hash付きURLを対応させる。通常人物表示が無効の間はこの4枚をPWAの必須precacheへ加えず、人物を通常導線で有効化する変更に合わせてオフライン用の供給・予算・受入を追加する。既存portraitや牌のprecacheは保持する。
4枚の派生JPGは1536×1536 atlas。原本画像と袖・頭部の切り出し領域、encoder版、元と出力のSHAは `textures/provenance.json` に記録する。原本は上書きしない。
原本で手が隠す衣服、見えない袖裏、首・手・耳・髪の奥行きは候補として補完している。これらを提供者が承認した完成デザインと扱わない。

## 再供給と比較

repository rootから、成果保存先と既存の専用browser profileを指定する。保存先とprofileは利用環境の所有・保持方針に沿って用意する。

```powershell
$env:CHARACTER_REVIEW_OUTPUT='<artifact-directory>'
$env:CHARACTER_REVIEW_PROFILE='<existing-review-profile>'
pnpm exec tsx src/components/game/characters3d/produce-review.ts
pnpm exec tsx src/components/game/characters3d/serve-review.ts
pnpm exec tsx src/components/game/characters3d/capture-review.ts
```

`produce-review` と `serve-review` は、固定した原本4枚とtracked texture4枚・provenanceのID・パス・SHA・容量を検証し、読み取った同じbytesを使う。比較の開始では画像やprovenanceを再生成・上書きしない。`produce-review` は4体のGLB、CPU比較、manifestとsource hashesを保存する。GLBは19joints・13clips・JPGを内包し、各ボーンのrest/bindとquaternionの規約を保持する。
`serve-review` は127.0.0.1:43196で検証済み原本・候補texture・比較bundleだけを配信し、Nextのビルドを変更しない。`capture-review` はインストール済みPlaywrightのChromiumを使い、原本と候補の前・横・背面・着席俯瞰、draw/call/和了の画像と動画を保存する。actor切替完了と要求actor/clip、時刻0を確認してから再生し、時間・描画回数の増加とpause後2フレームでの不変をそれぞれ検証する。比較用viewerの机と椅子は寸法確認用である。

### 書出しファイルの再取り込み

native TypeScriptモデルが編集元で、GLBは交換用の書出し形式である。編集元の意図した変更を通常の差分で確認し、`produce-review`を新規出力へ実行した後、その実GLB4点を比較viewerへ読み戻せる。

```powershell
$env:CHARACTER_REVIEW_GLB_DIRECTORY='<directory-containing-p0.glb-through-p3.glb>'
$env:CHARACTER_REVIEW_OUTPUT='<separate-review-output>'
pnpm exec tsx src/components/game/characters3d/serve-review.ts
# 別のshellで、上記と同じoutputと既存profileを指定してcapture-reviewを実行する。
```

指定directoryの固定名4点を、起動前に同じhandleから32MiB以下で読み検証する。ID・原本出典・19joints・材質slot・埋込JPG・13clipsを確認し、geometry、UV、weights、bind、channel/samplerの時間値と補間をファイルから使う。外部画像や別bufferの取得は行わない。対応は本製品exportの非indexed/非圧縮subset、LINEARのtranslation・morphとrotationのSLERPに限り、未対応形式をsourceモデルへ黙って置き換えない。JPEGは8MiB以下・2048px以下、JSONは2MiB以下、accessorの総component数も制限する。元のGLBやtracked素材は書き換えず、比較中の破棄・pause/reduced motionを既存viewerと共有する。

骨格の互換範囲は既存19ボーンと親子関係、bind時に回転・scaleを持たない本exportの規約である。各ボーンのlocal translationを親から累積してrest pivotを求め、inverse-bindの全16成分がidentityとそのpivotの逆平行移動に絶対誤差`1e-5`以内で一致することを確認する。これは元のpivot座標へ固定する検査ではない。pivotを編集した場合も、対応するinverse-bindを再生成して書き出せば受理する。geometry・UV・weights・材質・clipの編集も対応subset内で読み戻す。ボーンの追加・削除、bind時の回転・scale、別のglTF拡張を用いる編集はこのreaderの対象外なので、対応形式へ再書出しするかreaderを別途拡張してから検証する。

位置とmorphは単位metreの各成分についてweight 0・1の両端が`[-5,5]`内であることを確認する。法線はbaseとmorph後が各成分`[-1,1]`（誤差`1e-4`）、差分も2以下（同誤差2倍）とし、clipのmorph weightは`[0,1]`に限る。LINEAR補間の途中もこの範囲に入り、巨大な有限入力がFloat32投影で非有限になることを防ぐ。これは元の形状やmorph値への固定ではなく、上記範囲内の編集を受理するための寸法・方向契約である。

この経路は同じ`projectCharacterGeometry`を使う比較WebGL rendererへの再取り込みであり、通常の対局routeへGLBを読み込む機能ではない。TypeScriptモデルの編集→GLB書出し→実ファイル読戻し→比較表示を検証しても、本人の外観採用、通常routeでの4人の統合、実機性能やProduction受入の完了にはしない。元のsource表示へ戻す場合は`CHARACTER_REVIEW_GLB_DIRECTORY`を解除してserverを再起動する。

textureの再生成が必要なら、別の新規出力を明示する。

```powershell
$env:CHARACTER_TEXTURE_OUTPUT='<new-texture-directory>'
pnpm exec tsx src/components/game/characters3d/bake-textures.ts
```

全原本の検証と4枚のencodeが完了してから、新規ディレクトリへ4画像を書き出す。manifestは`provenance.complete.json`へ全量を書いて閉じた後、同じディレクトリのhard linkで`provenance.json`として原子的に公開する。既存先は上書きせず、書込み途中の失敗・中断では最終名`provenance.json`のない不完全な新規出力だけが残り、tracked一式は保持する。最終名を完成markerとして扱い、読取側は引き続き全件の妥当性を検証する。hard link非対応の出力先では公開を失敗として扱い、非原子的な代替へ切り替えない。tracked一式への同期はこの比較・再生成コマンドには含めず、変更画像とprovenanceをまとめて通常の差分確認・レビューへ渡す。

```powershell
pnpm exec vitest run --project unit src/components/game/characters3d/characters.test.ts src/components/game/characters3d/fittings.test.ts src/components/game/three/characterProjection.test.ts
pnpm exec tsc --project documents/guides/3d-characters-tsconfig.json
```

自動テストは個別形状、skin/bind、UV、材質、clip、cue復元・重複拒否、補間、GLB構造と参照を確認する。GLBの構造テストだけで第三者loaderへの再取り込み成功とはしない。

## 品質の受入

4体合計約4.5万三角形・29surfaceで、各体12,000三角形以下、1texture/体を目安とする。材質は顔・髪・衣服・装飾を個別に保持する。
原本との比較、通常盤面での人物識別・牌面・得点・操作の可読性、全4席回転、320〜393px、reduced motion、関節・衣服の貫通、長時間性能は統合時の受入である。
隔離したsoftware WebGLの画像・テスト成功を、hardware性能・本人の外見承認・Productionでの受入へ代用しない。
