# ローカル対局の表示アダプター境界（#1177・先行実装）

対象は TypeScript の表示 DTO・入力ガード・差し替え可能な transport の契約まで。
Unity/C# renderer、WebGL、CSP、Editor 導入、公開 3D 化は変更しない。
既存 `documents/fixtures/unity-display-contract.json` の Unity 試作 v1 とは別の
`four-bros-mahjong/local-display` version 1 を用い、既存 C# がそのまま読めるとは扱わない。

## 所有者と公開する情報

| 情報 | 正本・入力 | DTO へ出す範囲 |
|---|---|---|
| 座席・抜け番・持ち点 | `GameProvider` → `selectView` → `GameViewState.slots` | 4 物理位置、playerId、名前、点・点差、着席者の席風と公開状態。位置を再計算しない |
| 手牌 | 同上 | `self` かつ viewer の手牌のみ。他家は `handCount` だけ。抜け番には手牌・河・席風を出さない |
| 河・副露・北抜き | 同上 | 現在の河順とリーチ表示フラグ、公開副露、北抜き枚数。鳴かれて消えた河を復元しない |
| フリテン | self の表示状態 | self にだけ理由を出す。他家の同名フィールドは渡さない |
| 卓情報・ドラ | `GameViewState.tableInfo/dora` | 公開済み表示値。裏ドラ牌面は playing 中に渡さない |
| 結果 | `GameViewState.result` | gameEnd 時の確定済み内訳だけ。計算しない |
| 操作候補 | `GameContextValue.pending/phase/playerId/isHost` | 既存 can*・候補牌・禁止牌・locked の結果から表示 option を作る。ルール判定関数を追加しない |
| engine・山・seed・journal・認証 | アダプターの入力外 | 渡さない。型だけに頼らず、各ネストを明示的に新規オブジェクトへ写す |

`self.playerId === viewer`、4 人の一意性、3 着席・1 抜け番、着席の席風一意性を
検査する。入力不整合時は投影を拒否し、位置の推測・他家牌面の補完をしない。
牌値は既存表示を写し、得点・リーチ・副露・赤牌等のルールを renderer 側へ移さない。
牌 DTO は domain Tile ではなく `{suit, rank, red}`。`red` は既存 `isRedDora` の
表示判定結果であり、controls へ戻すのは牌種だけ。既存 controls の factory 正規化を維持する。

## session/revision の正本

`GameProvider` の内部 session に小さな読み取り専用 `displaySource` を加える。
初期化（journal 復元を含む）と新しい半荘で新しい sessionId・revision 0 を発行する。
sessionId はこの JavaScript realm の生存中だけ一意な非秘密の識別子で、seed・時刻・
プレイヤー名から作らず、永続化・認可・オンラインの roomId に使用しない。
ページ破棄で transport も破棄することを前提とする。
同じrealmで単調増加するgenerationも保持し、過去sessionのIDを全件保存せず、
最後に採用したgenerationだけで退役済みsessionを拒否する。

`applyGameAction` が新しい engine を返して採用された箇所で revision を 1 増やし、
engine/journal と同じ `sessionRef` 更新へ載せる。CPU の同期進行を含め、既存 UI に
公開される一つの確定遷移が一つの revision となる。React render 回数、effect 実行回数、
storage 保存・履歴再試行・拒否された no-op では増やさない。
新しい半荘は sessionId を替える。入力時にも同期 metadata を照合できる窓口を用意する。
Provider の unmount でこの窓口は無効になり、古い callback から操作できない。

各 transport 接続の最初・別 session の最初は `restore`、以後は `live`。
同 session の同版・古い版は再送しない。復元時に過去の操作や演出を再生しない。
今回の DTO は effect/手牌遷移 cue を含めない。CPU 中間演出、ツモ牌の分離、
局決着の詳細演出は既存 view に情報がないため後続 #1177 に残す。

## 入力と transport

`DisplayPort` は `publish(envelope)` / `onIntent(listener)` / `dispose()` の小さな契約。
ホストは現在の表示入力と既存 controls を読み、runtime からは unknown として受ける。
新 dependency・ブラウザ API・Unity API は不要。fake port で双方向を検査する。

intent は protocol/version・requestId・sessionId・revision（期待する確定版）・optionId と種別だけ。
生の GameAction・任意牌・playerId・メソッド名を実行しない。optionId は同 snapshot 内
でのみ有効。牌を使う操作は select → confirm、他の操作は action とし、版更新で選択を捨てる。
各版の requestId 重複、古い session/版、未知 option、選択なし confirm、追加フィールドを拒否する。
無効な要求は履歴枠を消費しない。選択は直近128件のrequestIdを保持し、
何度選び直しても確認操作が締め出されない。選択自体は対局を進めず、
実操作の二重実行は確定版・同期source・送信待機の検査で拒否する。
一度 controls を呼んだ版からの追加操作は拒否し、次の確定 snapshot を待つ。
ただしローカル controls は同期確定なので、呼び出し後も版が変わらなければ
`not-committed` として待機を解除する。history 再描画で旧 controls が拒否された場合も
永久待機にせず、新しい request と現在の controls で選択からやり直せる。
controls が確定前に例外を投げた場合も選択・待機を解放し、元の例外は呼び出し元へ伝える。
例外より前に確定版が進んだ場合は古い入力の拒否を維持する。

操作先は既存 controls の discard/riichi/tsumogiri/tsumo/ron/pon/kan/kita/ankan/kakan/
passRon/nextRound/newGame に限定する。候補の根拠は既存 Pending の can*、riichiTiles、
ankanTiles、kakanTiles、forbiddenDiscards、locked。最終採用・副作用は既存 engine に委ねる。
controls は void のため receipt は `dispatched` であり `accepted` ではない。
採用済みの盤面は次の確定 snapshot でのみ表示する。

## React host の接続順序・失敗境界

React 側の正式な窓口は `useLocalDisplayPort(createPort, onError)`。
Provider 配下の host が使う契約であり、既存 `GameBoard` はまだこの hook や renderer を
mount しない。`connectDisplayPort` を子の layout effect から直接接続・refresh すると、
StrictMode の再 setup では子が先、Provider の活性化が後になるため初期配信を失う。
hook は確定した context と最新の error handler を layout effect で保持し、全 layout
setup の後の passive effect で port を生成・接続・refresh する。初回と StrictMode の
再 setup はそれぞれ fresh port へ `restore` を一度送り、以後は確定 context 更新を反映する。
同版や history 保存だけの更新では port を作り直さず、snapshot も再送しない。

`createPort` は安定した関数（必要なら `useCallback`）で、呼ばれるたびに新しい所有 port を
返す。render 中に作った単一 port や、すでに dispose した port を factory から再利用しない。
factory が port を返す前に失敗した場合の部分リソース解放は factory の責務。
`null` は表示接続を無効化する。factory の変更・無効化・host の取り外し時は layout cleanup
で binding を同期 close する。Provider が残っていても、passive cleanup までの隙間に
古い listener から操作できない。既存の binding は close を先に確定し、unsubscribe と
port dispose を行う。非同期 dispose の完了待ちや二重 cleanup で旧 listener を復活させない。
Provider 自身の同期 source 失効は遅延せず、そのまま維持する。

factory・subscribe・publish の例外ではその接続を閉じ、取得済み port を解放して
`onError({stage, error})` へ通知する。unsubscribe と dispose の失敗も別々に通知し、
後の解放失敗で先の例外を隠さない。自動 retry はせず、host の明示的な factory 変更または
再 mount が再接続の境界。`onError` の変更自体は再接続理由にせず最新の確定 handler を使う。
非同期 dispose の失敗は host の取り外し後にも通知し得るため、handler はその状態でも
報告できること。handler は例外を投げない契約だが、壊れた handler の例外も元の失敗と共に
console error へ残し、表示 transport の失敗で既存 2D Provider を取り外さない。
controls 自体の例外を呼び出し元へ伝える既存 intent 契約は変えない。

## オンライン・未対応時の境界

先行版はローカルだけ。OnlineGameProvider は displaySource を持たず、アダプターは
unsupported として DTO/操作を出さない。既存 2D UI/controls はそのまま残す。
WebSocket、server version、再接続・resume・secret の処理を追加・変更しない。
オンライン接続を完了扱いせず、後続で既存 snapshot.version と reconnect 境界を設計する。

## 検証・完了の範囲

- 純粋 unit: 深い allowlist、他家/抜け番の秘匿、席順保持、公開河/副露/結果、合法候補の写像。
- transport unit: 同版/古い版、session 変更、restore、unknown/malformed intent、重複、選択確認、破棄、fake controls。
- Provider component: 実操作と revision、同 tick 二重入力、no-op、history 更新、復元、新半荘、古い metadata の同期失効。
- React host component: 実 Provider + StrictMode の両 setup、fresh port、同版無再送、2D との同 tick 競合、host だけの解除/無効化、Provider unmount、transport/reporting 失敗とリソース解放。
- 既存関連 unit/component、対象 lint/format、typecheck を分割実行する。

この先行実装だけで #1177 全体、#1179 runtime、#1180 素材、#1181 受け入れ、
公開 Preview/Production の 3D 完成とはしない。追加 Editor/module 導入はユーザー判断で保留。
