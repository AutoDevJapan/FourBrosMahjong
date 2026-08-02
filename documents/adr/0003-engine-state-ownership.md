# ADR-0003: engine 公開アクションの state 所有権契約(入力は使い捨て)

## Status

Accepted

## Date

2026-08-03

## Context

[issue #453](https://github.com/AutoDevJapan/FourBrosMahjong/issues/453) で、`declareRiichi(state, tile)` が成立経路で入力 `state.hand` をその場で書き換えることが報告された。`EngineState` の外側は `{ ...state }` で複製される一方 `hand` は新旧 state で同一参照のままなので、返り値を捨てても呼び手の `state` が変化する。

```
input.hand.riichi[east]: false -> true   // declareRiichi 呼び出しだけで変化
result.hand === input.hand: true         // hand は共有参照
input.points.p0=35000  result.points.p0=34000   // 点棒は返り値側にしか反映されない
```

問題は「破壊的であること」自体よりも、**呼び手の state が中途半端な状態で残る**ことにある。上の例で呼び手が持つのは「リーチ宣言済みフラグは立っているが、供託も点棒も未反映」という、エンジンが本来作らない組み合わせである。

実害は #450 の調査中に出た。`declareRiichi` の返り値を捨てて元 state から進行を続けるドライバが、局が終わらず同一局で 500 巡以上ツモ切りを続けた。症状が「テストが終わらない/遅い」として現れるため flaky と誤認されやすく、原因追跡に時間が掛かった。

### 実態: `EngineState` は不変値ではない

`hand` を in-place で更新するのは `declareRiichi` 固有の逸脱ではなく engine 全体の書き方である(例: `s2.hand.ippatsu[seat] = true`)。さらに `EngineState` は `{ ...state }` では複製されない**可変リソースを 3 つ**抱えている。

| リソース | 実体 | いつ変化するか |
|---|---|---|
| `hand.wall` | `Wall` クラス(`src/domain/wall/wall.ts`) | ツモ・嶺上補充のたびに内部配列を消費 |
| `state.rng` | `createSeededRng` のクロージャ(`src/domain/random/rng.ts`) | 局開始(`beginRound` のサイコロ・山構築)で前進 |
| `state.ledger` | `SoshiiLedger` クラス(`src/domain/scoring/settlement.ts`) | 役満祝儀の確定・終局精算で内部 Map を更新 |

加えて `HandState` は全フィールドが in-place 更新される。したがって「返り値を使わなければ入力は不変」は、engine 単体で提供できる保証ではない。

### 既存コードは既に破壊的である前提で書かれている

UI 層の `src/components/game/GameProvider.tsx` は「engine は Wall/RNG を含め入力を可変更新する」ことを明記した上で、React Strict Mode で再実行され得る関数型 updater を避け、同期 `sessionRef` 上で 1 回だけ遷移する構造になっている。journal 再生(`gamePersistence.ts`)も `createGame` から線形に再適用する。つまりアプリ側は既に使い捨て契約で書かれており、破壊性が現に依存されているのはこの 1 点だけ:

- **非合法手は入力 state を同一参照のまま返す**(純粋な no-op)。#105 の喰い替え no-op テストと、UI の `nextEngine === engine` による journal 記録抑止がこれに依存する。

## Decision

1. **公開アクションの入力 `EngineState` は使い捨てとする**(engine が所有権を取る)。遷移が起きたとき、有効な後続 state は**返り値だけ**である。入力 state はその場で不定になる。
2. **非合法手の no-op は入力を同一参照で返し、state を消費しない。** 遷移が起きていないので、続けて別のアクションを呼べる。
3. **契約違反(消費済み state を再びアクションへ渡すこと)は即座に失敗させる。** `EngineStateConsumedError` を投げ、どのアクションが古い state を受け取ったかをメッセージに含める。
4. 実装は `src/domain/game/engine.ts` の `publicAction` ラッパに集約する。遷移を起こした入力 state を `WeakSet` に記録し、再投入時に投げる。**公開アクションは必ずこのラッパを通して定義する**(`export const discard = publicAction("discard", discardImpl)`)。
5. **分岐を試したい場合は state を複製せず、`createGame(seed)` から操作列を再生する。** journal 再生(`gamePersistence.ts`)と同じ手法で、決定性(同じ seed + 同じ操作列 → 同じ進行)がこれを保証している。

## Options Considered

### Option A: 入力を不変にする(公開アクションで `hand` を複製する) — 不採用

`hand` を複製しても `hand.wall` は同一の `Wall` インスタンスのままなので、`pump` 中の AI のツモで呼び手側の山だけが減る。すると呼び手の state は「手牌は元のまま・山だけ進んだ」= **牌の保存則(場と山で常に 108 枚)が破れた**状態になり、そこから進行すると同じ牌が二度配られる。フラグの不整合(現状の壊れ方)は観測すれば気付けるが、こちらは静かに進行するぶん**元の欠陥より危険**である。

完全な不変性には `Wall` / `SoshiiLedger` の複製と `Rng` の複製が要る。前 2 者はクラスなので `clone()` の追加で済むが、`Rng` は `createSeededRng` のクロージャで内部状態を露出しておらず、インターフェース変更なしには複製できない。いずれも engine の外(`src/domain/wall` / `src/domain/scoring` / `src/domain/random`)であり、engine 単体では閉じない。

### Option B: 使い捨て契約を文書化するだけ — 不採用

#453 の実害は破壊性そのものではなく、**違反が無症状のまま進行し、別の症状(局が終わらない・テストが遅い)に化ける**ことだった。文書を足しても、次に同じ書き方をした人が同じ調査コストを払う。

### Option C: 使い捨て契約 + 違反の即時検出 — 採用

契約を Option B のとおり明文化したうえで、違反を実行時に落とす。#453 の再現ドライバは、500 巡のツモ切りではなく最初の state 再投入で `EngineStateConsumedError` を受け取る。

## Consequences

### 良い点

- 契約違反が「静かに壊れて進む」から「その場で例外」に変わる。メッセージにアクション名が入るので、原因追跡が調査ではなくスタックトレースの一読で済む。
- 挙動は正しい呼び出し(返り値だけを使う線形利用)に対して完全に不変。`WeakSet` なので参照が切れた state は自動的に外れ、長い半荘でも保持コストが増えない。
- `publicAction` を通すという 1 つの規約で、将来の公開アクションにも契約が自動的に掛かる。掛け忘れは `engine.state-ownership.test.ts` の構造ガードが落とす。

### トレードオフ・リスク

- **今まで黙って壊れていた経路は、これから例外を投げる。** UI 上の正当な再利用経路が残っていれば対局中のクラッシュになる。想定経路(React Strict Mode の効果 2 回実行 / journal 復元・再生 / 同一レンダー中の連続イベント)はいずれも state を線形に扱っており、ユニット・コンポーネント・E2E の全スイートで例外が出ないことを確認している。
- 読み取りは制限しない(下記)。したがって検出は「再投入」に限られる。

## この決定で解決しないこと

保証範囲を過大に読まないために、残る穴を明記する。

- **消費済み state を読むだけのコードは、依然として中途半端な値を読む。** #453 が挙げた「リーチのフラグは立っているが点棒・供託は未反映」はまさにこれで、返り値を捨てて `input.hand.riichi[seat]` を読むコードは今も誤った組み合わせを観測する。`WeakSet` が捕まえるのは**再びアクションへ渡した**場合だけである。この値そのものは `engine.state-ownership.test.ts` が assert して固定してあり、直す決定ではなく**受け入れた仕様**として扱う。
- **破壊性そのものは残る。** `EngineState` は不変値ではない。局面の分岐探索(同一 state から複数の合法手を試して比べる)は今後もできない。必要なら Decision 5 のとおり `createGame` から再生する。
- **`Wall` / `Rng` / `SoshiiLedger` の共有も残る。** 新旧 state はこれらを共有し続ける。
- **AI 内部の評価経路は対象外。** AI は公開アクションを経由せず engine 内部で完結するため、この契約は掛からない(掛ける必要もない)。

## 関連

- issue [#453](https://github.com/AutoDevJapan/FourBrosMahjong/issues/453)(本 ADR の発端)、[#450](https://github.com/AutoDevJapan/FourBrosMahjong/issues/450)(実害が出た調査)、[#105](https://github.com/AutoDevJapan/FourBrosMahjong/issues/105)(no-op 同一参照契約)
- 実装: `src/domain/game/engine.ts` の `publicAction` / `EngineStateConsumedError`
- 回帰テスト: `src/domain/game/engine.state-ownership.test.ts`
- 契約に依存する呼び出し側: `src/components/game/GameProvider.tsx`、`src/components/game/gamePersistence.ts`
