# #818 実Unity Player証跡 — 2026-09-08 JST

Unity 2022.3.62f2 / macOS 26.2 / Apple M2 / Metalで実行した結果。
PNGはPlayerのend-of-frameで`Texture2D.ReadPixels`が取得した実フレームをそのまま収録した。
Web画面、Unity APIスタブ、AI画像生成による代替画像ではない。
実行手順・制約・Go/No-Goは[検証記録](../../guides/unity-display-prototype.md)を参照。

`runtime-1440.json`と`runtime-960.json`は各6,954 assertions、44 PNG、errors 0の
成功レポート。生成されたJSONの空白のみBiomeで整形した。値は生レポートと同じ。
レポートの`screenshots`は各実行で生成した全44枚を示す。ここには次の9枚を抜粋している。

| 収録PNG | 元の出力ファイル | 観点 |
|---|---|---|
| `board-1440.png` | 1440: `case-00-columns-6.png` | 全席・自家手牌・裏牌・河6列・リーチ牌横置き |
| `bench-1440.png` | 1440: `case-01-columns-6.png` | 席ローテーション後、自家が抜け番 |
| `east4-1440.png` | 1440: `case-10-columns-6.png` | 東4の局替わり前 |
| `south1-1440.png` | 1440: `case-11-columns-6.png` | 南1への局替わり後、持ち点の保持 |
| `river4-1440.png` | 1440: `case-00-columns-4.png` | 河4列、隣席との分離 |
| `kita-1440.png` | 1440: `effect-kita.png` | 北抜きバナーとnorth枚数 |
| `restored-1440.png` | 1440: `restored-kita.png` | JSON復元でnorth=1を保持、過去のバナー抑止 |
| `tilted-1440.png` | 1440: `tilted.png` | 傾斜時の形状。裏牌側面が帯に見える制約も記録 |
| `board-960.png` | 960: `case-00-columns-4.png` | 小画面の盤面収まりと文字の可読性限界 |

測定はDevelopmentビルド、vSync=1、180フレーム／状態切替30回。
入力時間は合成した操作ハンドラ呼出しからCPU end-of-frameまでであり、物理入力・GPU完了・
ディスプレイ走査を測った値ではない。メモリはUnity Profiler値で、OSプロセスRSSではない。
Playerビルドレポートのサイズは214,623,897 bytes。元のビルドと全PNGは作業時に
worktree外へ保存し、この9枚と2件のレポートはリポジトリにも残した。
