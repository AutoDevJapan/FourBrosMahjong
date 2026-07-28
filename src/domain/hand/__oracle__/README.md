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

したがって:

- **検出できる**: 片側だけのリグレッション(どちらか一方を壊す変更)。
- **検出できない**(`definition-oracle.ts` 導入前): 列挙側の**共通欠陥**
  — 例えば「ある塔子形を両方が取りこぼす」設計上の誤り。両者が同じ列挙構造を
  共有しているため、同じ誤りを同じように犯し、照合は緑のまま通る。

この死角を埋めるのが `definition-oracle.ts` です。向聴数の定義

> 向聴数 = min(和了形 W にわたって)「W を完成させるために追加で必要な牌数」− 1

を、和了形 W の側を全列挙して直接計算します。手牌側の分解を一切行わないため、
探索構造が本体実装と完全に独立します。

**適用範囲**: 副露数 1..3 のみ。門前 13 枚は和了形が約 1,300 万通りに爆発するため
現実的ではありません(副露手は面子が固定されるぶん探索が激減し、`meldCount = 1` でも
33 万通り程度で全列挙できる)。門前手は引き続き `shanten-oracle.ts` との照合が担当します。

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
