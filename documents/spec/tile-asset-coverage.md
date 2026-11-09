# 本番牌素材のカバレッジ台帳（#1180 の部分実装）

`src/components/prototype/tileAssetCoverage.ts` は、必要な牌面と保存済み native study の供給境界を示す純粋な TS 台帳である。3D renderer、素材 loader、公開 wire ID、権利承認、卓やキャラクターの本番供給を定義・実装しない。アプリの route / 2D 描画 / engine には接続していない。

## 正規集合と供給状態

`buildTileAssetCoverage()` は `domain/tiles/tileSet.ts` の `buildTileSet()` が返す山から同一牌種を除き、`components/common/tileImage.ts` の `resolveTileFace()` へ渡す。牌種集合・赤5規則・2D 素材カタログはここへ複製しない。

| 区分 | 台帳の行数 | 山の枚数 | 現状 |
| --- | ---: | ---: | --- |
| 萬子 1・9 | 2 | 8 | 既存 2D SVG に対応 |
| 筒子 1–9（5 は全て赤） | 9 | 36 | `Pin5-Dora` を使用、黒 `Pin5` は正規集合外 |
| 索子 1–9（5 は全て赤） | 9 | 36 | `Sou5-Dora` を使用、黒 `Sou5` は正規集合外 |
| 東南西北白發中 | 7 | 28 | 北はこの 7 種に含む。抜き北も同じ牌面 |
| 裏面 | 1 | 0 | `Back`、`tile: null`。牌種でも追加の山牌でもない |
| 合計 | 28 | 108 | 正規 27 面＋裏面。native binding は全 28 行で未供給 |

`id` は既存 SVG の拡張子なし名を借りた**内部台帳キー**にすぎない。3D の採用方式や外部 protocol の安定 ID にはしない。正規牌の SVG が fallback になる、複数牌種が同じ SVG 名になる、表向き牌が `Back` に対応する、既存カタログから裏面が欠ける場合は生成時に失敗する。

`native: "not-supplied"` は「この台帳に本番で利用できる native binding を登録していない」の意味である。`prototypes/blender/generated/TilePin5.fbx` と revision の代表牌 study は実在するが、全牌面の意味対応・採用 renderer の import・通常カメラの可読性を満たす本番供給へ昇格させてはいない。裏面の binding も本台帳には未登録である。この台帳へ別の供給状態を記入しても guard は受け入れない。

ブラウザ内で生成する geometry と既存 CC0 SVG を使う renderer の供給状況は、この保存済み study 用の `native` fieldでは表さない。実 renderer の texture 一覧・牌面写像・geometry・ロード／再生成・通常カメラ・性能の検証を別に対応付ける。台帳の全28行が `not-supplied` であることから、別途実装中のブラウザ3D素材も未供給と判断しない。UI6点と派生画像の公開・再配布は提供者の2026-11-07許可に基づき、各CREDITSの条件を保持する。既存牌SVGは `public/tiles/CREDITS.md` のCC0を保持する。

## guard と既存検証の分担

`validateTileAssetCoverage(entries)` は型付きローカル台帳と SSOT から再導出した期待値を比較し、不整合の `id` / `reason` 一覧を返す。外部 JSON や renderer message の parser ではない。順序は問わないが、ID の欠損・重複・正規外、牌フィールド・SVG・供給状態の不一致を拒否する。牌の全フィールドを SSOT が作った値と比較するため、赤の規則を表示側で再実装しない。

空の問題一覧 `[]` は**台帳の整合**だけを示し、3D 素材の準備完了を意味しない。`Back` に顔付き `tile` や顔 SVG を割り当てる誤りは検出するが、FBX の形状・裏面に焼き込まれた顔・shader・Renderer/material-slot の実際の対応を検査するものではない。

- 新しい `tileAssetCoverage.test.ts`: 27 面＋裏面と 108 枚の区別、北の一意性、全行の SVG 写像・配信カタログ・ファイル実在、全 native 未供給、欠損・二重 ID・黒5・萬2–8・赤写像・裏表誤割当の negative を確認する。
- `tileImage.test.ts`: 正規全 27 面の入力（suit / rank / isRed）と期待 SVG 名を test-only の literal 表で固定する。期待値を resolver / production catalog / SSOT から再生成しない独立 oracle とし、たとえば `Pin2` と `Pin4` の写像入替を検出する。SSOT との整合を確認する台帳 guard だけでは、mapper と台帳が同時に誤る入替を検出できないため、この独立 oracle と組み合わせる。既存の赤5専用・防御的な黒5・fallback 回帰も保持する。防御的 2D カタログを本番の正規山牌集合と取り違えない。
- 既存 `tileSet.test.ts` / `tile.test.ts` / `tile-factory.regression.test.ts`: 正規山・赤の SSOT と、表示側を含む重複実装防止を維持する。
- 既存 `blender-asset-study.test.ts`: 保存済み試作の manifest / hash / 寸法等の整合を検査する。今回の guard とは独立し、native の再起動・再取り込みを代替しない。

## #1180 の残りの受入条件

本番卓と全牌種の素材供給、サイズ・単位・pivot・UV・法線・material-slot、採用 renderer への供給／再生成、通常 PC / 狭幅 mobile カメラでの可読性、性能予算と実測、素材の出典・利用条件、全キャラクターまたは具体的な後続分割は、実 renderer 側の最終版で別途検証する。既存 Unity / Blender study と #1177 / #1179 の表示境界を保持し、この台帳だけで #1180 全体や 3D 本番化を完了扱いしない。

`prototypes/blender/README.md` の今後の牌面制作案は本作業で正規 27 面＋裏面へ訂正する。別途レビュー済みの PR #1190 (`a2016818cf9d0b2f5f8d667e5c8554bc36303097`) にも同じ旧文言があるため、統合時にこの訂正を保持する。今回 PR #1190 の branch や保存済み native 成果は変更しない。
