# ブラウザ3D盤面

実対局の状態と合法操作は既存のDomainとGameProviderが所有する。native WebGL2の
表示層はローカル表示adapterの公開DTOだけを使い、山・seed・他家の手牌・認証値を読まない。
Unity試作の保存済み実証と、通常のブラウザで動くこのrendererは別の成果である。

## 実行と素材

対象はWebGL2が利用できるWindowsの現行ChromeとChromium。狭幅は320pxから確認する。
新しい実行依存を追加せず、面取り付きの立体牌と卓、既存CC0牌SVG30点を使う。
27正規牌面と裏面、黒5の防御用素材、赤5を区別する。人物画像と牌のCREDITSを保持する。
人物4体の新しいモデルと動作は別の素材境界であり、portraitの表示を4体完成とは扱わない。

通常の`/game`がrendererを所有し、オンライン画面と固定fixture試作は既存の表示を使う。
全テクスチャのupload・非ゼロ描画寸法・初回draw・GLエラーなしの後だけreadyとなる。
15秒の読み込み期限、非対応、context loss、shaderや素材の失敗は明示して2D表示へ戻し、
同じProviderと保存済みジャーナルを保つ。描画失敗で対局ルールを停止しない。

## 入力と寿命

canvasの牌は選択の後、ネイティブbuttonで打牌を確定する。リーチ宣言牌も既存候補だけを使う。
既存のDOM手牌・ActionPanelをキーボードと読み上げ、タッチ操作に保持する。
確定版が変われば選択を捨て、古いsession・generation・revisionと二重入力をadapterで拒否する。
初回・復元では過去の演出を再生しない。

publish、resize、選択と素材読み込み完了のときだけ描画する。静止盤面の常時RAFはない。
canvas backing bufferはDPR2、4096pxとdriver上限の小さい方まで。CSSサイズは制限しない。
hostはResizeObserverとwindow resizeを所有し、画面遷移・StrictMode・失敗時に購読と
GPU資源、画像callback、期限timerを解放する。描画ループを増設しない。

## 受入と配布

機能受入は実3D起動、ポインター選択・確定、キーボード打牌、CPU応答、全席回転、
保存復元、半荘結果と戦績、320px、light/dark、context lossの2D継続を確認する。
素材の全対応表は独立期待値で検証し、同じ最終ソースの型・lint・依存境界・CIと
独立レビューを通す。画素テストとGPU寿命のdriver doubleを混同しない。

測定条件は固定seedとviewport、ブラウザ版、commitを記録する。最初の性能予算は
ローカルwarm起動5秒以内、操作後の応答100ms以内、静止時の連続drawなし、
backing bufferとGPU textureの総量64MiB以内とする。機能テスト成功だけで予算達成とはしない。
人物統合後は合計の負荷と描画時間を再測定する。

新しい画面・人物の完成形は原本との比較画像で確認し、未確認候補を承認済みとしない。
配備はmainから既存Productionだけ。PR/CIのlocalhost検証は稼働環境に含めない。
PWAは既存のcontent-hash付きchunkとビルド版SWを使い、更新時の旧ページ保護を保つ。
rollbackは直前の検証済みProductionのコードへ戻し、ブラウザ保存を削除しない。
