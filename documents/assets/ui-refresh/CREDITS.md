# UI refresh design-reference originals

Issue #712 のUI刷新で参照する6画面の原本です。プロジェクトownerからローカルファイルの提供とリポジトリへの取り込み依頼を受け、2026-08-27に無改変で収録しました。`manifest.json` のSHA-256・寸法・bytesを原本同一性の基準とします。

## 収録ファイル

| ID | repository file | 提供時の元ファイル名 | 対応route | 寸法 | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | ---: | --- |
| lobby | `originals/lobby.png` | `四兄弟麻雀 ①ロビー（トップページ）.png` | `/` | 1200×890 | 1,082,111 | `c269e446bdcd891b000268dd0b1f4527e01926a4e32b65afaa490efaa78e3410` |
| rules | `originals/rules.png` | `四兄弟麻雀 ②ルール説明画面.png` | `/rules` | 924×890 | 496,238 | `e92f8d69408948d307e4f55db688d8fdc0fed4ad264cb363036e3080da73d5c0` |
| settings | `originals/settings.png` | `四兄弟麻雀 ③設定画面.png` | `/settings` | 920×890 | 392,235 | `0ac5dfb6ba5e6fca5422b3a66e12649dea96335059ba2c60cdc3873e8d9b066b` |
| game | `originals/game.png` | `四兄弟麻雀 ④対局画面（対局中）.png` | `/game` | 1384×1110 | 1,284,760 | `2ad46fb73a2311fbb15e4cc44126be071c0830768da2691e5d307f8a702a489d` |
| result | `originals/result.png` | `四兄弟麻雀 ⑤結果画面（半荘終了）.png` | `/game/result` | 740×1110 | 615,256 | `c2189583de709ea7ee65fed3721ff09c25a108ebb563bb2e235a128d1165beba` |
| history | `originals/history.png` | `四兄弟麻雀 ⑥戦績画面.png` | `/history` | 920×1110 | 551,176 | `22c7708f9c4dfc218ef95e0c52a92ecf5abccba56dd0ab94247b89ae82d75f3d` |

合計は4,421,776 bytesです。各ファイルはGitHubの100 MiB単体ファイル上限を下回ります。

## 提供元・権利状態

- 提供元: project ownerが指定したローカルDownloads内の6ファイル。
- 利用・リポジトリ収録・再配布の根拠: project ownerからの明示的な採用・取り込み依頼。
- 法的権利者、project ownerが第三者へ許諾できる権限、固有のライセンス条件は独立には確認できていません。この記録は権利保証ではありません。
- 権利上の疑義や権利者からの申告があった場合は、公開・再利用を停止してproject ownerへ確認します。

## 利用境界

- これらは完成仕様やruntime assetではなく、デザインリファレンス原本です。`public/`へ複製せず、アプリから読み込まず、画面の背景画像として使用しません。
- ファイル名先頭の①〜⑥と画像上部の英語画面名は資料注釈です。アプリUIには含めません。
- 画像内の牌、点数、順位、日時、version等は例示であり、固定値・テストデータ・ゲーム仕様にしません。
- 実装時はIssue #712記載の仕様優先順位と補正方針に従い、スクリーンショットをそのままトレースしません。
- 原本を再圧縮・変換・上書きしません。派生物が必要な場合は別ファイルとして来歴と処理内容を記録します。

## 検証

repository rootから次を実行すると、manifestのpath・SHA-256・寸法・bytesとPNG原本を照合できます。

```bash
node scripts/verify-ui-refresh-assets.mjs
```
