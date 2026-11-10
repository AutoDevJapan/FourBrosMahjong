# 四兄弟キャラクターアセット

Issue #711 でユーザーが提供ファイルを指定し、このプロジェクトでの採用・リポジトリ収録を明示的に依頼したものです。取り込み時にデザインの描き直しは行っていません。

## 公開・再配布の条件

プロジェクト提供者は2026-11-07に、この4点と派生画像の一般公開・再配布を許可しています。これらは提供されたデザイン画像であり、別に手描きの原画があることを示しません。
公開リポジトリへの収録および画像の再配布が可能です。自作コードのMIT Licenseとは別の画像に対する公開・再配布許諾であり、実在人物・番組・商標の公認や権利の譲渡を意味しません。
以下のSHA-256は提供ファイルの同一性と派生関係を確認するための値です。

| player ID | UI名 / 色 | 提供画像 | リポジトリ内提供画像 | SHA-256 |
| --- | --- | --- | --- | --- |
| `p0` | 粗悪品 / 赤 | `粗悪品 - キャラデザ.png` | `originals/p0-soakuhin-character-sheet.png` | `ef6c81eb0ce02dbc5227d3320f61c760527214eea1ecd8e7e42cd88dbb4aebbf` |
| `p1` | 竜二 / 青 | `竜二 - キャラデザ.png` | `originals/p1-ryuji-character-sheet.png` | `5a02f954603f5b211fd8f670e2f8e503bccc3a8d7a926be58ed46015514101bf` |
| `p2` | マサキ / 黄 | `マサキ - キャラデザ.png` | `originals/p2-masaki-character-sheet.png` | `ce218809a3ec175d875228e807332a2190d82f3b76cf81e744a2073759b05b0c` |
| `p3` | 糸瓜 / 緑 | `糸瓜 - キャラデザ.png` | `originals/p3-hechima-character-sheet.png` | `bcdad1e1faf55e6aab426d7b372e947d13d45c30de887f6d7956eaa6dd78aca5` |

## 実行時ポートレート

各提供画像の正面立ち絵を同じ条件で機械的に切り出しました。提供画像左上を基準に `x=0, y=110, width=220, height=420` でクロップし、AVIF quality 70へ変換しています。UIでは縦横比を維持して縮小表示します。

- 変換ツール: macOS `sips-316`
- 注意: AVIF encoderの出力はツールversionで変わり得ます。下記SHAは `sips-316` で再生成し一致することを確認した値です。

再生成command（リポジトリルートで実行）:

```sh
regenerate_portrait() {
  source_path="$1"
  output_path="$2"
  work_dir="$(mktemp -d)"
  crop_path="$work_dir/crop.png"
  sips --cropToHeightWidth 420 220 --cropOffset 110 0 "$source_path" --out "$crop_path"
  sips --setProperty format avif --setProperty formatOptions 70 "$crop_path" --out "$output_path"
  rm -R "$work_dir"
}

regenerate_portrait documents/assets/characters/originals/p0-soakuhin-character-sheet.png public/characters/p0-soakuhin-portrait.avif
regenerate_portrait documents/assets/characters/originals/p1-ryuji-character-sheet.png public/characters/p1-ryuji-portrait.avif
regenerate_portrait documents/assets/characters/originals/p2-masaki-character-sheet.png public/characters/p2-masaki-portrait.avif
regenerate_portrait documents/assets/characters/originals/p3-hechima-character-sheet.png public/characters/p3-hechima-portrait.avif
```

| 実行時アセット | 寸法 | サイズ | SHA-256 |
| --- | ---: | ---: | --- |
| `public/characters/p0-soakuhin-portrait.avif` | 220×420 | 15,772 bytes | `ff7584b9342fe27c724bbc3302eaefdbd96c2d3ff6fc4be1f08c378eab6eab76` |
| `public/characters/p1-ryuji-portrait.avif` | 220×420 | 15,183 bytes | `d536fa1986fa14f11834de343227ba1a18c5ab321c58301d01beca4778295b37` |
| `public/characters/p2-masaki-portrait.avif` | 220×420 | 18,516 bytes | `ef9c361183bdd0c72769d129e293d45a4dae90530a5d48fc08ebb4c22bb349f3` |
| `public/characters/p3-hechima-portrait.avif` | 220×420 | 14,124 bytes | `a96c4556eb2e19f5b6e17705cf9567ab55b3df90a4f382644060855abdd65b50` |

ユーザー向け表示では、`糸瓜` に読み仮名を付けません。
