# `__oracle__/` — テスト専用の検証オラクル

⚠️ **本ディレクトリのモジュールを本番コードから import しないこと。**
`.dependency-cruiser.cjs` のレイヤールールでは検出できない(同じ `src/domain/` 内のため)。

`src/domain/game/ai.ts` の `shanten()`、`src/domain/hand/{decompose,tenpai}.ts` の
`isCompleteHand()` / `decomposeStandard()` / `waitingTiles()` の正しさを、
別実装との突き合わせで担保するためのものです(issue #138)。

## 何がどこまで独立しているか(#392)

「独立参照実装」という言葉は**強すぎる**ため、実態を明記します。

| オラクル | 対応する本体実装 | 独立性の実態 |
| --- | --- | --- |
| `shanten-oracle.ts` の `enumerateSuitProfiles` | `game/ai.ts` の `suitFrontier` | **探索構造は同型**(再帰の分岐順まで)。独立しているのは最終式とパレート枝刈りの有無だけ |
| `agari-oracle.ts` の `decomposeMeldsOnly` | `hand/decompose.ts` の `extractMentsuAll` | **同型**(分岐順まで) |
| `agari-oracle.ts` の `isSevenPairs` | `hand/decompose.ts` | **完全同一** |
| `shanten-oracle.ts` の七対子・国士の向聴式 | `game/ai.ts` | **完全同一** |
| `definition-oracle.ts` の `shantenByDefinition34` | `game/ai.ts` の `shanten()` | **列挙を一切行わない**(和了形の側を全列挙し「手牌との最大重なり」から距離を直接算出) |
| `definition-oracle.ts` の `standardFormsByDefinition34` | `hand/decompose.ts` の `decomposeStandard()` | **列挙を一切行わない**(和了形の側を列挙し「手牌と完全一致する形」を集める) |
| `definition-oracle.ts` の `waitingIndicesByDefinition34` | `hand/tenpai.ts` の `waitingTiles()` | **列挙を一切行わない**(「手牌をちょうど1枚超過して覆う和了形」の超過牌が待ち) |
| `definition-oracle.ts` の `isSevenPairsByDefinition34` / `isThirteenOrphansByDefinition34` | `hand/decompose.ts` の `decomposeSevenPairs()` / `decomposeThirteenOrphans()` | **向きが逆**(本体は手牌側を走査して枚数を数える。こちらは特殊形の側を列挙して手牌との重なりを見る) |

したがって:

- **検出できる**: 片側だけのリグレッション(どちらか一方を壊す変更)。
- **検出できない**(`definition-oracle.ts` 導入前): 列挙側の**共通欠陥**
  — 例えば「ある塔子形を両方が取りこぼす」設計上の誤り。両者が同じ列挙構造を
  共有しているため、同じ誤りを同じように犯し、照合は緑のまま通る。

この死角を埋めるのが `definition-oracle.ts` です。向聴数の定義

> 向聴数 = min(和了形 W にわたって)「W を完成させるために追加で必要な牌数」− 1

を、和了形 W の側を全列挙して直接計算します。手牌側の分解を一切行わないため、
探索構造が本体実装と完全に独立します。

**適用範囲**:

- `shantenByDefinition34`(向聴)は副露数 1..3 のみ。向聴は「最も近い和了形」を求めるため
  和了形を**全通り**見る必要があり、門前 13 枚は約 1,300 万通りに爆発します
  (副露手は面子が固定されるぶん探索が激減し、`meldCount = 1` でも 33 万通り程度)。
  門前手は引き続き `shanten-oracle.ts` との照合が担当します。
- `standardFormsByDefinition34`(分解)と `waitingIndicesByDefinition34`(待ち)は
  「手牌と一致する形 / 1枚だけ足りない形」しか要らないため、可容な枝刈り
  (`waste = Σ max(0, W[i] − hand[i])` が上限を超えた枝を捨てる)が効き、
  **副露数にも門前かどうかにも依存せず** 1 手あたり 0.01〜0.02ms 程度で終わります
  (#390 / #429)。当初は「副露経路向け」と限定していましたが、#429 で
  `groupsNeeded = 4`(門前 13/14 枚)にも適用範囲を広げました。
- ただし上記2つは**標準形(4面子1雀頭)のみ**を扱います。門前手では七対子・国士も
  成立し得るため、それらは `isSevenPairsByDefinition34` /
  `isThirteenOrphansByDefinition34` /`menzenWaitingIndicesByDefinition34`
  が別途カバーします(#429)。前者2つは「特殊形の側を列挙して手牌との重なりを見る」
  ため、本体の「手牌側を走査して枚数を数える」実装とは向きが逆で、
  `agari-oracle.ts` の `isSevenPairs`(本体と完全同一)の死角を埋めます。

## 副露(`melds ≠ []`)経路のカバレッジ(#390)

`cross-validation.test.ts` は長らく `melds` に全箇所で `[]` を渡しており、
`decomposeStandard` / `isCompleteHand` / `waitingTiles` の**副露経路が未検証**でした。
現在は `generator.ts` の `randomMeldedHand`(ポン/明槓/暗槓を含む副露 1〜4 組)で
生成した手を、上記2つの定義ベースオラクルと照合しています。

照合が空回りしないよう、テスト側で以下のカバレッジを**アサーションとして固定**しています
(過去にジェネレータが多重分解の手を一度も生成せず、ガードが実際に検出した経緯があります):

- 和了形になる手の割合 / テンパイ手の割合
- 分解が一意に定まらない手(`111222333p` 型・`22334455p` 型)の件数
- 多面待ちの件数 / 明槓・暗槓が出現した件数

なお副露3組(門前5枚)・4組(門前2枚)は分解が**構造上常に一意**、副露4組の待ちは
**常に単騎1種**であるため、これらは「0であること」を積極的に固定しています。

## 門前(`melds = []`)経路のカバレッジ(#429)

#390 の時点では、門前 13/14 枚の分解・待ちは依然 `agari-oracle.ts` とだけ突き合わせて
いました。`decomposeMeldsOnly` は本体 `extractMentsuAll` と分岐順まで同型なので、
**列挙側の共通欠陥は素通り**します。実際 PR #427 で両方に同じ
「刻子が取れたら順子を試さない」欠陥を注入したところ、門前14枚の分解照合は緑のまま通り、
副露経路の定義ベース照合だけが検出しました。

#429 でこの空白を埋め、門前 13/14 枚も定義ベースオラクルと照合しています
(`cross-validation.test.ts` の「クロス検証: 門前手の分解・待ち(定義ベース / #429)」)。

- 手牌の 1/4 は `generator.ts` の `randomAmbiguousMenzenHand`(`111222333p` 型 =
  刻子3組 ⇔ 順子3組)。乱択(`randomStructuredHand`)だけでは多重分解の手が
  20,000 手に 100 件強しか現れず、刻子 ⇔ 順子の読み替えを踏むかどうかが運任せになるため。
- 七対子・国士はランダム生成では事実上出ないので、和了形とその1枚不足を
  **決め打ちで総当たり**して照合しています(七対子 27×(1+7) 手 / 国士 13×(1+13) 手)。

欠陥注入の実測(両側に同じ欠陥を入れた場合):

| 注入した共通欠陥 | 既存の門前照合(`agari-oracle` 相手) | #429 の定義ベース門前照合 |
| --- | --- | --- |
| 刻子が取れたら順子を試さない | 14枚・13枚とも**緑**(素通り) | 14枚が **red** |
| 順子の開始位置から 7 を落とす(789 を作らない) | 14枚・13枚とも**緑**(素通り) | 14枚・13枚とも **red** |

## 参照ライブラリとのアンカー(再現手順)

`shanten-oracle.ts` / `agari-oracle.ts` は、MIT ライブラリ
[MahjongRepository/mahjong](https://github.com/MahjongRepository/mahjong) の
**アルゴリズム構造を読解して独自に再実装**したものです(コードは流用していません)。

初期の正しさは、同ライブラリとの大量ランダム照合でアンカーしました:

- ライブラリ: `mahjong`(PyPI) — `Shanten().calculate_shanten()` /
  `HandDivider().divide_hand()` を使用
- 設定: `is_three_player=True`(サンマ)
- 手牌: 本リポジトリの `__oracle__/generator.ts` と同じ牌種構成(萬子は 1・9 のみ)で
  ランダム生成した **12,478 手**(同一牌 4 枚使いの手は除外 — 下記の既知差分クラスのため)
- 結果: shanten / 標準形分解 / 和了判定 / 待ち牌のすべてで全一致

**この照合はオフラインで実施され、CI からも手元からも再実行できません**(Python 実行環境と
当該ライブラリがリポジトリの依存に入っていないため)。したがって「どちらが正しいか」を
再判定する手段としては使えません。回帰検出は以下が担います:

1. `oracle.test.ts` — オラクル自身の既知手による挙動固定。
2. `cross-validation.test.ts` — 本体実装との突き合わせ(共通欠陥には無力)。
3. `cross-validation.test.ts` の定義ベース照合 — 列挙側の共通欠陥を検出。

再実行が必要になった場合は、`pip install mahjong` のうえ `generator.ts` と同じ牌種構成で
手牌を生成し、`Shanten().calculate_shanten(tiles_34, use_chiitoitsu=..., ...)` と
本オラクルの出力を突き合わせてください。

### 既知の差分クラス(#143)

同一牌の **4 枚すべてが手牌にある**「デッドウォール待ち」の向聴は、牌残量を見ない
理想化(本作 `ai.ts` と各オラクルが共通で採用)により参照ライブラリと ±1 差が出ます。
本作の実装とオラクルは同じ理想化を共有するため、リポジトリ内の照合では全手で一致します。
