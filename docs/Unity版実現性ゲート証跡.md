# Unity版実現性ゲート証跡（2026-09-06）

対象: [Issue #818](https://github.com/AutoDevJapan/FourBrosMahjong/issues/818)

この文書は、Unity Editorを実行できない環境で行った、#818の現在状態に対する限定監査の証跡である。既存の[表示専用の実現性ガイド](../documents/guides/unity-display-feasibility.md)を置き換えず、今回確認できたrepo-local証拠と、Unity実行前に残る判定ゲートを分離して記録する。

## 判定

**条件付き No-Go（本番移行） / 条件付き Go（権利確認後の最小プロトタイプ）** とする。

- Web側の表示契約、3人着席+1人抜け番の4物理スロット、親流れ、連荘、東4→南1、表示演出の対応は、fixture・既存実装・ローカルテストで確認できる。
- Unity Editor/Runtime、C#・Prefab・Animationの実行、対象端末の性能、入力遅延、録画、WebGLまたはネイティブビルド、素材の利用・改変・再配布権は、この環境では確認できない。
- したがって、この証跡だけを根拠に本番移行や第三者素材の取り込みを開始しない。Unity環境と権利証跡がそろった場合に限り、仮素材を使った1シーンの短時間プロトタイプへ進む。

## 検証メタデータ

| 項目 | 値 |
|---|---|
| 検証日 | 2026-09-06 JST |
| 検証基準コミット | `28eee10b57d42039fce5359f0998cbfe00ebab79` |
| 対象ブランチ | `codex/auto-cycle-202609051700-a` |
| Unity-native成果物 | リポジトリ内に `.cs` / `.unity` / `.prefab` / `.anim` / `ProjectVersion.txt` なし |
| Unity Hub / Editor / Runtime | 利用不可・未実行 |
| in-app Browser | 利用不可。Web確認はローカルPlaywrightへフォールバック |
| 外部環境の変更 | なし。Unity package、素材、Vercel/Railway設定、認証情報を追加していない |

## 確認できたrepo-local証拠

| 対象 | 確認結果 | ここから言えないこと |
|---|---|---|
| `documents/fixtures/unity-display-contract.json` | `snapshotVersion=42`、`41 → 42 → 41 → 42 → 43` の適用/無視sequence、4局の親流れ、連荘・東4→南1、河・手牌・演出・抜け番の表示ケースを収録 | Unity上の表示・実行結果 |
| `src/test/unity-display-contract.test.ts` | version巻き戻し抑止、4回転、点数のプレイヤー紐付け、表示専用の視覚ケースを機械検証 | WebSocket transport、認証、resume、Unity C#の挙動 |
| `src/app/prototype/unity-display` と `e2e/unity-display-reference.spec.ts` | Web上で4スロット、3人着席+1人抜け番、主要8演出、親流れ表を確認するリファレンス | Unity Runtime、WebGLビルド、実機性能 |
| `documents/guides/unity-display-feasibility.md` | ルール/点数/フリテンのSSOTをserver/domainに残し、Unityを表示・演出に限定する境界を記録 | 実装承認、採用Unity版、外部環境の準備完了 |

### ローカル実行結果

依存関係を `pnpm install --frozen-lockfile` で専用worktree内に準備した。lockfileやソースは変更していない。

```text
pnpm exec vitest run --project unit src/test/unity-display-contract.test.ts
1 file / 6 tests passed

pnpm exec vitest run --project component src/components/prototype/UnityDisplayReference.test.tsx
1 file / 2 tests passed

pnpm exec playwright test --project=chromium e2e/unity-display-reference.spec.ts
1 passed
```

Playwrightの結果は、Webリファレンスが表示契約を説明どおりに描画できることの証拠であり、Unityの画面証拠ではない。in-app Browserが使えないため、ローカルChromiumを使用した。

## OSS参照の境界

対象OSSは [ArcturusZhang/Mahjong のコミット `c833d787146210f55e2ceec2cfcded40ecf53a4d`](https://github.com/ArcturusZhang/Mahjong/tree/c833d787146210f55e2ceec2cfcded40ecf53a4d) に固定して、次の存在とテキスト上の手掛かりだけを読み取った。

- [`ProjectSettings/ProjectVersion.txt`](https://github.com/ArcturusZhang/Mahjong/blob/c833d787146210f55e2ceec2cfcded40ecf53a4d/ProjectSettings/ProjectVersion.txt) は `2019.1.8f1` を示す。これは参照OSSの値であり、採用Unity版ではない。
- 対象C#は [`PlayerRiverManager.cs`](https://github.com/ArcturusZhang/Mahjong/blob/c833d787146210f55e2ceec2cfcded40ecf53a4d/Assets/Scripts/GamePlay/Client/View/PlayerRiverManager.cs)、[`PlayerHandManager.cs`](https://github.com/ArcturusZhang/Mahjong/blob/c833d787146210f55e2ceec2cfcded40ecf53a4d/Assets/Scripts/GamePlay/Client/View/PlayerHandManager.cs)、[`PlayerEffectManager.cs`](https://github.com/ArcturusZhang/Mahjong/blob/c833d787146210f55e2ceec2cfcded40ecf53a4d/Assets/Scripts/GamePlay/Client/View/PlayerEffectManager.cs)、[`PositionManager.cs`](https://github.com/ArcturusZhang/Mahjong/blob/c833d787146210f55e2ceec2cfcded40ecf53a4d/Assets/Scripts/GamePlay/Client/View/SubManagers/PositionManager.cs) に存在する。河の折り返し・リーチ牌の回転、手牌/ツモ用Transform、演出配列、席方向の投影を読む手掛かりにはなるが、Unity Editorでの参照解決や実行確認ではない。
- 関連Prefab/Animationのパスも同commitのtreeに存在するが、Prefab依存関係の解決、再生、画面結果は未確認である。
- OSSの [`LICENSE`](https://github.com/ArcturusZhang/Mahjong/blob/c833d787146210f55e2ceec2cfcded40ecf53a4d/LICENSE) はコードのMIT表記である。一方、[`README.md`](https://github.com/ArcturusZhang/Mahjong/blob/c833d787146210f55e2ceec2cfcded40ecf53a4d/README.md) はゲーム内リソースをMajsoulから取得すると記載しており、MIT表記だけでは画像・音声・フォント・Prefab付属素材の利用・改変・再配布権を確認できない。

今回、OSSコード・Prefab・Animation・Majsoul由来素材をコピーしていない。将来のプロトタイプでも、自作または利用条件を独立確認した仮素材だけを使用する。

## 受け入れ条件の状態

| 条件 | 状態 | 根拠 / 未達理由 |
|---|---|---|
| 対象プラットフォーム・採用Unity版・実行環境を確定 | 未達 | OSS値は `2019.1.8f1` の参照値のみ。Unity Editorと対象端末がない |
| 最小シーンで河・手牌・主要演出を確認 | 未達 | Webリファレンスは確認済みだが、Unity sceneは未作成・未実行 |
| 3人着席+1人抜け番、全ローテーション、局替わり、リロードを確認 | 部分達成 | fixtureとWeb表示は確認済み。Unity Runtimeでの局替わり/再読込は未確認 |
| Unityを表示・演出に限定し、ルールSSOTを維持 | repo-local達成 | 表示契約と負の契約を文書・fixture・テストに記録。Unity実装は未作成 |
| OSSコードと第三者アセットのライセンス境界を確認 | 部分達成 | OSSコードのMIT表記とリソース取得元は確認。第三者素材の許諾は未確認 |
| スクリーンショット/録画、入力遅延、端末負荷、ビルドサイズを記録 | 未達 | Unity Editor、実機、ビルドが利用不可 |
| Go/No-Goと後続Issue分割案を明記 | 達成 | 条件付きNo-Goと、prototype / transport / performance / assetsの分離を既存ガイドに記録 |

## 再開条件と次の作業

1. Unity Hub/Editor、ライセンス、対象OS/端末、採用パッチ版を用意し、`ProjectVersion.txt` と依存packageを記録する。
2. 権利確認済みの仮素材だけで1シーンを作り、固定fixtureの4回転、連荘、東4→南1、リロード相当の再適用を再生する。
3. 河の折り返し、リーチ牌横置き、手牌のツモ間隔、席方向、主要8演出のスクリーンショットまたは短い録画を残す。
4. 対象端末で入力遅延、フレーム時間、メモリ、ビルドサイズを同一シナリオで測定する。
5. 素材ごとに利用・改変・再配布・商用利用の根拠を記録する。許諾がない素材は採用しない。
6. transport / 認証 / 再接続 / resume は表示契約と分離した後続Issueで設計し、Unityへルール計算や合法性判定を複製しない。

上記の外部ゲートが満たされるまで、#818はOPENのまま、本番移行はNo-Goとする。
