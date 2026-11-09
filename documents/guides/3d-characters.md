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

`material.texture` は `textures/p0-reference.jpg` 等のrepository source keyである。配信にはNext static importのcontent hash付きURLを対応させ、PWAにも同じURLを使う。
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

`produce-review` は4体のGLB、CPU比較、manifestとsource hashesを保存する。GLBは19joints・13clips・JPGを内包し、各ボーンのrest/bindとquaternionの規約を保持する。
`serve-review` は127.0.0.1:43196で原本・候補texture・比較bundleだけを配信し、Nextのビルドを変更しない。`capture-review` はインストール済みPlaywrightのChromiumを使い、原本と候補の前・横・背面・着席俯瞰、draw/call/和了の画像と動画を保存する。比較用viewerの机と椅子は寸法確認用である。

```powershell
pnpm exec vitest run --project unit src/components/game/characters3d/characters.test.ts src/components/game/characters3d/fittings.test.ts src/components/game/three/characterProjection.test.ts
pnpm exec tsc --project documents/guides/3d-characters-tsconfig.json
```

自動テストは個別形状、skin/bind、UV、材質、clip、cue復元・重複拒否、補間、GLB構造と参照を確認する。GLBの構造テストだけで第三者loaderへの再取り込み成功とはしない。

## 品質の受入

4体合計約4.5万三角形・29surfaceで、各体12,000三角形以下、1texture/体を目安とする。材質は顔・髪・衣服・装飾を個別に保持する。
原本との比較、通常盤面での人物識別・牌面・得点・操作の可読性、全4席回転、320〜393px、reduced motion、関節・衣服の貫通、長時間性能は統合時の受入である。
隔離したsoftware WebGLの画像・テスト成功を、hardware性能・本人の外見承認・Productionでの受入へ代用しない。
