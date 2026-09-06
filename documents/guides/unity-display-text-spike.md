# Unity版 対局演出テキスト・スパイク（Issue #818）

## 目的と結論

このガイドは、Unity Editorや新規アセットを使わずに、既存Web実装からUnity表示へ切り出せる最小の仕様スライスを記録する。既存の[実現性ガイド](./unity-display-feasibility.md)と[Web表示リファレンス](./unity-display-reference.md)を補足するもので、Unityプロジェクトや本番移行を開始する承認ではない。

| 記録項目 | 値 |
|---|---|
| 対象Issue | [#818](https://github.com/AutoDevJapan/FourBrosMahjong/issues/818) |
| 検証日 | 2026-09-07 JST |
| 基準HEAD | `58be92851b6e74a4f8f12adba25abf489a90ed40` (`origin/main`) |
| 作業範囲 | この新規ガイド1ファイルのみ。既存実装・素材・外部設定は変更しない |
| Unity実行 | 未実施。Unity Editor/Hub/Runtimeは起動していない |

現時点の判定は次のとおりとする。

| 対象 | 判定 | 根拠 |
|---|---|---|
| Web実装から表示契約を切り出すテキストスパイク | Go | `GameViewState`、表示fixture、既存テストがある |
| 権利確認済み仮素材を使う最小1シーン | 条件付き Go | Unity環境・素材の利用条件・対象端末が未確定 |
| Unityを既存Web版の代替として本番移行 | No-Go | Unity実行、性能、入力遅延、ビルド、権利証跡が未検証 |

このスライスでは、C#・Prefab・Animation・Unity package・第三者asset・Majsoul由来素材を追加しない。ルール計算やサーバー設定も変更しない。

## 参照したrepo-local証拠

| ID | 参照 | このスパイクで確認できること |
|---|---|---|
| E1 | `src/domain/game/viewTypes.ts` `GameViewState` | 4方向slot、卓情報、ドラ、結果を表示値として受ける型の境界 |
| E2 | `src/domain/game/gameView.ts` `selectView` | engine状態から表示値へ写像する場所。席割り・ルール計算をUnityへ複製しない |
| E3 | `src/components/game/Discards.tsx` | 河の順序、折り返し、リーチ宣言牌の横置き、追加時cue |
| E4 | `src/components/game/hand-animation/handAnimation.ts` と `HandTileAnimation.tsx` | `deal` / `draw` / `replacement` / `meld` と決定的なツモ演出 |
| E5 | `src/components/game/effects/gameEffect.ts` と `EffectOverlay.tsx` | 打牌、リーチ、鳴き、和了、流局等の表示専用effect |
| E6 | `documents/fixtures/unity-display-contract.json` と `src/test/unity-display-contract.test.ts` | version sequence、4局の席回転、表示ケース、負の契約 |
| E7 | `src/domain/online/types.ts`、`src/components/online/onlineServerMessage.ts`、`OnlineLobby.tsx` | `OnlineSnapshot.view`、version、currentTurn、入力/transportとの境界 |
| E8 | `docs/四兄弟麻雀ルール.md`、`documents/spec/`、`documents/adr/0003-engine-state-ownership.md` | ルールと状態所有権をserver/domain側に残す根拠 |
| E9 | `documents/assets/characters/CREDITS.md`、`documents/assets/ui-refresh/CREDITS.md` | リポジトリ内素材も権利未確認であり、許諾の根拠にならないこと |

確認用コマンドはリポジトリルートで実行する。結果にはコミットSHA、日時、コマンド、件数を添える。

```bash
node -e 'JSON.parse(require("fs").readFileSync("documents/fixtures/unity-display-contract.json", "utf8")); console.log("fixture: valid")'
pnpm exec vitest run --project unit src/test/unity-display-contract.test.ts
pnpm exec vitest run --project component src/components/prototype/UnityDisplayReference.test.tsx
pnpm exec playwright test --project=chromium e2e/unity-display-reference.spec.ts
pnpm check
pnpm lint
pnpm typecheck
```

これらはWeb表示契約の証拠であり、Unity Runtimeの実行証拠ではない。

今回のlocal結果（基準HEADからこの文書だけを追加した状態）は次のとおりである。

| 検証 | 結果 |
|---|---|
| fixture JSON parse | 成功（schemaVersion 1、rotation 4、visual 4） |
| Unity契約 unit | 1 file / 6 tests passed |
| Unity表示リファレンス component | 1 file / 2 tests passed |
| Unity表示リファレンス Chromium E2E | 1 passed |
| Biome `pnpm check` | 477 files checked、成功 |
| ESLint `pnpm lint` | 成功 |
| TypeScript `pnpm typecheck` | 成功 |
| Markdown専用lint | 専用実行ファイル/設定なし。末尾空白チェックと`git diff --check`で代替 |

## 最小表示契約（提案、未凍結）

Unityへ渡す最小入力は、`OnlineSnapshot` 全体ではなく、次の表示用投影とする。

```text
UnityDisplaySnapshot {
  schemaVersion: number       // 表示契約の版。fixtureのschemaVersionとは別に管理する
  snapshotVersion: number     // 同じroom内の適用順序
  phase: GamePhase
  view: GameViewState         // slots / tableInfo / dora / result
  currentTurn: PlayerId|null  // 表示上の手番。合法性は判定しない
  roundSummary: DisplaySummary|null
}
```

`view`の内容は、`self / left / across / right` の4物理slot、着席3人＋抜け番1人、牌の` suit / rank / isRed`、河、鳴き、北抜き数、点数、卓情報、ドラ、結果である。自家の牌面と他家の手牌枚数を混同しない。抜け番は`seatWind`を持たず、点数はプレイヤーIDに紐付けて表示する。

Unity側の責務は投影・レイアウト・アニメーション・アクセシブルな表示だけとする。次は渡さず、またはUnityで再計算しない。

- `pending`、合法な打牌・鳴き・リーチの判定、向聴、フリテン、ドラ翻、点数、精算、席割り、局進行
- `EngineState`、牌山、RNG、認証token、resume credential、WebSocket実装
- `OnlineCredentials` とsession token。表示fixtureへ秘密値を入れない

同一roomでは、表示adapterが最後に適用したversionより小さいsnapshotを捨てる。同値は再演出せず、必要なら接続状態等の同値更新だけを再描画する。roomが変わったらversion比較をリセットする。現行Webの`isStaleOnlineSnapshot`は同一roomの古いversionを拒否する境界であり、Unityの演出重複抑止とは別層として扱う。

## 最小検証マトリクス

Unity実行前は「Web/fixtureで確認済み」と「Unityで未確認」を分けて記録する。未実施を成功として扱わない。

| ID | 固定入力 | 合格条件 | 現時点 |
|---|---|---|---|
| R1 河 | `river-wrap-and-riichi` | 捨て順を保ち、狭幅で折り返し、リーチ牌だけ横置き。追加1枚以外で入場cueを出さない | Web/fixture確認。Unity画面は未確認 |
| H1 手牌 | `hand-deal-draw-replacement-meld` | 配牌・ツモ・北抜き/槓の置換・鳴き整列を分類し、ツモ入場200msと決定的delayを保つ | Web/fixture確認。Unity画面は未確認 |
| E1 演出 | `major-effects` | `discard`、`riichi`、`pon`、`kan`、`tsumo`、`ron`、`draw`、`roundEnd`を確定済み表示状態から一度だけ導出。和了/流局はassertive | Web/fixture確認。Unity画面は未確認 |
| S1 席 | `bench-warmers` と4回転 | 4slot、3着席＋1抜け番、抜け番に風なし。親流れ4局、連荘据え置き、東4→南1、点数のID紐付けを維持 | fixture/型テスト確認。Unity画面は未確認 |
| V1 version | `41 → 42 → 41 → 42 → 43` | 同一roomの適用結果が`41 apply / 42 apply / 41 ignore / 42 ignore / 43 apply`。room切替で初期versionを受け入れる | fixture/型テスト確認。Unity adapterは未実装 |
| P1 再表示 | 最新snapshotを新しい表示adapterへ投入 | リロード相当で静的表示は復元し、過去の河cue/effectを再演出しない | Web実装の意図を確認。Unity Runtimeは未確認 |
| Q1 権利 | 仮素材一覧と根拠を添付 | 全画像・音声・フォント・Prefab付属素材について利用・改変・再配布・商用条件を確認。1点でも未確認ならNo-Go | 未達 |
| F1 実行 | 対象端末・ビルドを固定 | スクリーンショット/短い録画、入力遅延、frame time、memory、build sizeを同一シナリオで記録 | 未達。Unity Editor/端末なし |

### Unityを使えるようになった後の1シーン手順

1. 対象をmacOS Editor/Standaloneの1種に限定し、Unity 2022.3 LTS系のパッチを固定する。これは低コストな表示確認の候補であり、採用済み製品版ではない。
2. 権利確認済みまたは自作の単色・図形の仮素材だけで、4slot、河、手牌、卓情報、effect overlayを配置する。
3. 上表R1/H1/E1/S1/V1/P1を固定fixture順に再生し、各ID、commit SHA、Unity版、端末、画面解像度を証跡に記録する。
4. `schemaVersion`不一致、古いversion、空slot、抜け番への`seatWind`、他家の牌面、未許諾assetを拒否できることを確認する。
5. F1の測定値と、実装・保守工数を記録してからGo/No-Goを更新する。

この手順を満たすまで、WebのPlaywright結果や固定fixtureをUnity画面の代用証拠にしない。

## 権利・OSS境界

| 対象 | このスパイクの扱い | Go条件 |
|---|---|---|
| OSSのC#・Prefab・Animation | 挙動理解の参考に留め、コピーしない | 再利用する場合は対象commit、LICENSE、変更履歴、配布範囲を個別に記録 |
| OSS付属の画像・音声・フォント・Prefab素材 | 使用しない | コードのOSSライセンスとは別に利用・改変・再配布権を確認 |
| Majsoul由来素材 | 取り込まない | 権利者と用途・再配布・商用条件を書面で確認できた場合のみ別判断 |
| 現行リポジトリのキャラクター/UI原本 | 仮素材として流用しない | `CREDITS.md`の未確認状態を解消し、根拠を記録 |
| 新規の仮素材 | 自作の図形・単色・テキストに限定 | 作者、作成日、利用条件、ハッシュを証跡へ記録 |

SHA-256、Issueの取り込み指示、MIT表記だけでは権利許諾の証明にならない。未確認の素材が1点でもあれば、表示が正しくても本番Goにはしない。

## Go / No-Goゲートと後続分割

本スパイクのGoは「表示仕様を次の担当へ渡せる」という意味に限る。本番移行のGoにはしない。

後続作業は、承認後に次の独立Issueへ分ける。

1. `unity/prototype`: Unity版・対象OS・1シーン・仮素材・fixture再生・画面証跡。
2. `unity/assets-rights`: 素材台帳、出典、利用/改変/再配布/商用条件、未確認時の差替え。
3. `unity/performance`: 固定シナリオで入力遅延、frame time、memory、build sizeを計測。
4. `unity/transport`: `OnlineSnapshot` のtransport、認証、再接続、resume。表示契約とcredentialsを分離する。
5. `unity/release-gate`: Web版との仕様差、対象端末、保守負荷、公開判断を再レビューする。

次のどれかが残る場合はNo-Goを維持する。

- Unity側にルール・合法性・点数・席割りの複製がある
- version/room境界が不明、または再表示で過去演出を再生する
- 河・手牌・4slotのいずれかが固定fixtureを満たさない
- 権利根拠のないasset、Majsoul由来素材、未承認のpackageを使う
- 実機の入力遅延・負荷・build sizeを測らずに製品採用を判断する

現行の計画工数 `8.5–17人日` は既存の実現性ガイドにある、Editor準備・最小プロトタイプ・性能・権利確認を含む仮置きであり、この文書のrepo-localテキストスパイクの確定見積りではない。今回の変更で新規課金、外部設定、デプロイ、Actionsの追加実行は発生させない。

## 既知の制約

- Unity Editor、Unity Hub、実Unity Runtime、WebGL/ネイティブbuild、対象端末、入力遅延・性能計測は未実施。
- `GameViewState`はTypeScriptの表示型であり、この文書の`UnityDisplaySnapshot`は提案であって、公開wire schemaとして凍結していない。
- Webの既存リファレンスはUnity Runtimeではない。スクリーンショットやPlaywright成功をUnityの証跡に昇格させない。
- in-app Browserと`godd-a`はこの作業では使わず、既存のrepo-local資料とCLI/ローカルテストを代替証拠とする。
- `documents/guides/README.md`は既存レーンとのファイル重複を避けるため変更しない。このファイル自身がガイドの入口である。
