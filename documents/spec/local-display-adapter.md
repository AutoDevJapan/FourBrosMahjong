# ローカル対局の表示アダプター境界（#1177）

この文書は TypeScript の表示 DTO・入力ガード・差し替え可能な transport の契約を定める。
ローカル対局のWebGL2 consumer、素材・入力・失敗時の2D継続は
[ブラウザ3D盤面](./browser-3d-display.md)で定め、ここではrenderer側のルール計算を追加しない。
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
暗槓の両端の伏せ牌はnullとし、表を描く内側2枚だけを牌DTOで渡す。

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
実対局の演出cueと自家ツモ位置の加法的な投影は、末尾の「確定イベントのcue追補」を参照する。
局決着の詳細な牌移動は、このcue列だけで補完しない。

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
Provider 配下の `GameBoard` は `render3D` が有効なとき `GameTable3D` をmountし、
そのcomponentがこのhookでportを接続する。通常のローカル`/game`は盤面3Dを選択し、
人物3Dは別の `renderCharacters` が有効な場合だけ接続する。
`connectDisplayPort` を子の layout effect から直接接続・refresh すると、
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
正式hookはunsupported providerに対してportを生成・購読せず、不要な描画資源を確保しない。
WebSocket、server version、再接続・resume・secret の処理を追加・変更しない。
オンライン接続を完了扱いせず、後続で既存 snapshot.version と reconnect 境界を設計する。

## 検証・完了の範囲

- 純粋 unit: 深い allowlist、他家/抜け番の秘匿、席順保持、公開河/副露/結果、合法候補の写像。
- transport unit: 同版/古い版、session 変更、restore、unknown/malformed intent、重複、選択確認、破棄、fake controls。
- Provider component: 実操作と revision、同 tick 二重入力、no-op、history 更新、復元、新半荘、古い metadata の同期失効。
- React host component: 実 Provider + StrictMode の両 setup、fresh port、同版無再送、2D との同 tick 競合、host だけの解除/無効化、Provider unmount、transport/reporting 失敗とリソース解放。
- 既存関連 unit/component、対象 lint/format、typecheck を分割実行する。

このadapterの検証だけで #1177 全体、#1179 runtime、#1180 素材、#1181の統合受け入れや
Productionの3D完成とはしない。通常ルートの描画・実操作・素材・保存復元・性能は、
同じ候補のrenderer検証と既存Prdでの受け入れへ対応付ける。
配備は既存Prdだけとし、localhost・CIの検証と分ける。追加Editor/moduleは導入していない。

## 確定イベントのcue追補

`GameProvider`は、1回の`applyGameAction`を`capturePresentationEvents`で同期的に包み、
engineの成立箇所から記録した非秘密のscalarイベントだけを取得する。
最終viewの差、名前、席、点差から動作を推測しない。
engineが返した`next !== state`だけを採用し、同じsessionRefの更新で
`displaySource`・engine・journal・presentationを一緒に確定する。
保存schema・判定・山・乱数・得点・CPUの同期進行は変えず、演出完了を待たない。

| kind | 記録する成立箇所・actor |
|---|---|
| deal | 次局の配牌後、着席3人それぞれの固定playerId |
| draw | 通常/嶺上/北抜き補充の取得成功時、その取得者。牌面は記録しない |
| discard | 人間/CPUの打牌を実際の手牌・河へ反映した時、その打牌者 |
| riichi | 宣言牌へのロンがなく、供託が確定した時の宣言者。宣言牌ロンでは出さない |
| pon / kan | 副露を反映した時の鳴いた人。暗槓/加槓は槍槓解決後の成立時のみ |
| kita | 実際に北を抜き補充できた人。CPUの配牌北・連続補充北も順に記録 |
| tsumo / ron | 和了の成立時の和了者。CPU和了・槍槓ロンも同じ経路 |
| draw-round / round-end | 流局/局終了時の着席3人それぞれ。四槓散了も含む |

CPUの中間動作も、同じ同期操作内で発生した順を維持する。
例えばCPUのポンと直後の打牌は、最終viewの河から消えていても列に残る。
各eventは`{seq, actorId, kind, roundKey}`のみで、seqは1操作内で1から連番。
roundKeyは半荘内の実開始局カウンター`roundsPlayed`由来の`round-N`で、連荘でも変わる。
次局への操作が抜け番中の1局全体を同期実行した場合も、局内の全イベントを同じrevisionへ載せる。

DTOのローカル生成値は`roundKey`・`cues`・`cueStatus: {overflow, dropped}`を持つ。
各cueは`{id,actorId,kind,sessionId,generation,revision,roundKey}`で、
idは`generation:revision:seq`。同realmのgenerationと同sessionのrevisionにより一意となる。
既存character controllerのCharacterCueと構造互換で、rendererへの型依存をdomainへ加えない。
旧fixture/受信側との互換のため基底DisplayEnvelopeでは追補フィールドをoptionalとし、
`createDisplayEnvelope`が返すLocalDisplayEnvelopeでは必須とする。
presentationのsourceがDTOのsession/generation/revisionと違う場合は投影を拒否する。

recorderは通常OFFで、明示的な1回のpublicActionの間だけ動く。
外部observer callbackは実行しないため、observerの例外・再入がゲーム判定へ入らない。
各publicAction入口で記録をリセットし、no-op・例外は公開しない。
入れ子capture、同capture内の2個目のpublicActionは実操作前に拒否する。
記録sinkへ渡す値は非秘密scalarと採用済みbooleanのみで、state/hand/山の参照を渡さない。
元のengine例外はそのまま伝播し、finallyでrecorderを解除する。
上限は1024件で、超過時はゲーム判定を中断せず、追加記録だけを止め、欠落数とoverflowを返す。
overflow付きの列を、全演出取得済みや製品完成の根拠にしてはならない。

初回・journal復元・newGameの初期化では記録を有効にせず、cuesは空。
途中revisionへ接続した新transportもrestoreとして空にする。
同版再送の抑止は既存connectDisplayPortが担う。
履歴保存だけの再描画・古いcontrols・同tick二重入力・StrictMode再setupは新cueを作らない。
unmount後のretained controlsも同期active guardで無効になる。

自家の`drawnIndex`は、selectViewが従来どおりsortした公開self hand内の、
実ツモ牌の位置を指す。既存DOMの手牌順や操作は変更しない。
同じTile実体が複数位置に共有されても、sort前に末尾へ加えたツモの最後のidentity位置を使う。
ツモ表示がない時はnull。他家/抜け番には牌面もdrawnIndexも渡さない。
暗槓両端null・他家handCount・未開示裏ドラの既存boundaryを保つ。

この追補は確定イベントの受け渡しまでであり、controller側の順次再生・割込み・
round変更時の演出や実ブラウザの見た目の完成を保証しない。
新UIの本番反映には既存の画像確認を保持する。
