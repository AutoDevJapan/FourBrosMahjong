# 四兄弟麻雀 (Four Brothers Mahjong)

関西式の三人打ちをベースに、4人が抜け番を交代しながら遊ぶブラウザ麻雀です。コンピューターとひとりで対局するほか、ルームコードを使って友人とオンラインで対局できます。本作は粗品 Official Channel「ギャンブル四兄弟」の麻雀企画を題材にした非公式のファン作品です。

- **[ゲームを開く](https://four-bros-mahjong.vercel.app/)**
- **[公式Wiki](https://github.com/AutoDevJapan/FourBrosMahjong/wiki)**で、対局の始め方、ルール、戦績、オフラインでの遊び方を確認できます。

<a name="技術スタック"></a>
<a name="セットアップ"></a>
<a name="コマンド一覧"></a>
<a name="ディレクトリ構成"></a>
<a name="コンポーネントテストvitest--testing-library"></a>
<a name="構成要素"></a>
<a name="コンポーネントテストの書き方例"></a>
<a name="e2e-テストplaywright"></a>
<a name="ブラウザバイナリのインストール初回のみ"></a>
<a name="実行"></a>
<a name="ci-での実行に関する注意"></a>
<a name="ドキュメント"></a>
<a name="ブランチ保護main"></a>
<a name="開発時の注意"></a>
<a name="オンライン対戦の設定"></a>

## 開発

起動やテストの手順は[Wikiの開発ガイド](https://github.com/AutoDevJapan/FourBrosMahjong/wiki/%E9%96%8B%E7%99%BA%E3%82%AC%E3%82%A4%E3%83%89)、実装と運用の資料は[ドキュメント一覧](docs/README.md)を参照してください。仕様の未確定事項は[質問リスト.md](質問リスト.md)にあります。

ブラウザテストを初めて実行する前に、Playwright用のChromiumとWebKitを用意します。

```sh
pnpm exec playwright install chromium webkit
```

## ライセンスと公開範囲

AutoDevJapanが権利を持つ自作コードは[MIT License](LICENSE)で提供します。依存ライブラリ、第三者素材、人物の氏名・肖像・キャラクター、番組名や商標の権利をMITで許諾するものではありません。

提供を受けたキャラクターデザイン画像4点・UIデザイン画像6点と派生画像は、提供者の許可により一般公開・再配布できます。牌素材のCC0表記と各素材の利用条件は、同梱ファイルを参照してください。 [牌素材](public/tiles/CREDITS.md) · [キャラクター画像](documents/assets/characters/CREDITS.md) · [UI画像](documents/assets/ui-refresh/CREDITS.md)

自作コードや提供画像の公開は、製品名・番組・出演者による公認を意味しません。
