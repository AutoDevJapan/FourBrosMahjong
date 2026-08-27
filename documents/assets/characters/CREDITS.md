# 四兄弟キャラクターアセット

Issue #711 でユーザーから提供され、リポジトリへの収録権限がある前提で採用した原本です。AIによる再生成・描き直しは行っていません。

| player ID | UI名 / 色 | 提供原本 | リポジトリ内原本 | SHA-256 |
| --- | --- | --- | --- | --- |
| `p0` | 粗悪品 / 赤 | `粗悪品 - キャラデザ.png` | `originals/p0-soakuhin-character-sheet.png` | `ef6c81eb0ce02dbc5227d3320f61c760527214eea1ecd8e7e42cd88dbb4aebbf` |
| `p1` | 竜二 / 青 | `竜二 - キャラデザ.png` | `originals/p1-ryuji-character-sheet.png` | `5a02f954603f5b211fd8f670e2f8e503bccc3a8d7a926be58ed46015514101bf` |
| `p2` | マサキ / 黄 | `マサキ - キャラデザ.png` | `originals/p2-masaki-character-sheet.png` | `ce218809a3ec175d875228e807332a2190d82f3b76cf81e744a2073759b05b0c` |
| `p3` | 糸瓜 / 緑 | `糸瓜 - キャラデザ.png` | `originals/p3-hechima-character-sheet.png` | `bcdad1e1faf55e6aab426d7b372e947d13d45c30de887f6d7956eaa6dd78aca5` |

## 実行時ポートレート

各原本の正面立ち絵を同じ条件で機械的に切り出しました。原本左上を基準に `x=0, y=110, width=220, height=420` でクロップし、AVIF quality 70へ変換しています。UIでは縦横比を維持して縮小表示します。

| 実行時アセット | 寸法 | サイズ | SHA-256 |
| --- | ---: | ---: | --- |
| `public/characters/p0-soakuhin-portrait.avif` | 220×420 | 15,772 bytes | `ff7584b9342fe27c724bbc3302eaefdbd96c2d3ff6fc4be1f08c378eab6eab76` |
| `public/characters/p1-ryuji-portrait.avif` | 220×420 | 15,183 bytes | `d536fa1986fa14f11834de343227ba1a18c5ab321c58301d01beca4778295b37` |
| `public/characters/p2-masaki-portrait.avif` | 220×420 | 18,516 bytes | `ef9c361183bdd0c72769d129e293d45a4dae90530a5d48fc08ebb4c22bb349f3` |
| `public/characters/p3-hechima-portrait.avif` | 220×420 | 14,124 bytes | `a96c4556eb2e19f5b6e17705cf9567ab55b3df90a4f382644060855abdd65b50` |

ユーザー向け表示では、`糸瓜` に読み仮名を付けません。
