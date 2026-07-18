/**
 * 対局画面(`/game`)の**表示専用**型定義(スペック6 6.8節)。
 *
 * ここで定義する型は「UIが値を受け取って表示する」ための箱に過ぎない。
 * 席割り当て・抜け番順・場/親ローテーション・ツモ配分・ウマ割当
 * (`質問リスト.md` Q9〜Q13)の**決定ロジックは一切含めない**。
 * これらの値は将来ドメイン層(スペック4)が算出し props として流し込む。
 *
 * 型名・構造はスペック4のドメインモデル(`domain-model.md`)に対応させつつ、
 * UI 表示に必要な最小限に絞った表示用ビューモデルとする。
 */

/** 牌のスート(スペック4 `Suit`)。字牌は `honor`。 */
type Suit = "man" | "pin" | "sou" | "honor";

/**
 * 牌1枚の表示データ(スペック4 `Tile` に対応)。
 *
 * - `man`(萬子)はサンマでは rank ∈ {1, 9} のみだが、表示側では制約しない。
 * - `honor`(字牌)の rank は 1〜7(東=1・南=2・西=3・北=4・白=5・發=6・中=7)。
 * - `isRed` はオール赤5(5筒・5索は常に赤)。表示は色ではなく形状差+`aria-label`で伝える(スペック5 5.2.1)。
 */
export interface TileData {
  readonly suit: Suit;
  readonly rank: number;
  readonly isRed?: boolean;
}

/**
 * 卓上の物理スロット(4方向)。四人回しでは常に3人着席+1人抜け番。
 * レイアウトはスペック6 6.4.3: 自家=下段 / 上家=左 / 対面=上 / 下家=右。
 */
export type SeatPosition = "self" | "left" | "across" | "right";

/** 席風(表示用)。抜け番は席を持たない(スペック4 `Seat`)。 */
export type SeatWind = "east" | "south" | "west";

/** 局中プレイヤーの状態フラグ(色のみに依存させないアイコン/テキスト併記の元データ)。 */
interface PlayerStatus {
  /** 親(ディーラー)か。 */
  readonly isDealer?: boolean;
  /** 現在の手番か。 */
  readonly isCurrentTurn?: boolean;
  /** リーチ宣言済みか。 */
  readonly hasDeclaredRiichi?: boolean;
}

/**
 * 着席プレイヤーの表示データ。
 *
 * `hand` は自家のみ牌面(表向き)を渡す。他家は牌の内容を伏せ、`handCount`(枚数)のみ表示する
 * (スペック6 6.4.2)。どちらを使うかは `PlayerArea` が `isSelf` で切り替える。
 */
export interface SeatedPlayerView {
  readonly name: string;
  /** 持ち点(素点)。ソシー換算は結果画面の責務(スペック6 6.4.2)。 */
  readonly points: number;
  /**
   * 直近のツモ/放銃等による点差(表示専用)。ツモ配分ロジック(Q12)には関与せず、
   * 与えられた数値を符号付きで表示するだけ(スペック6 6.8)。
   */
  readonly pointsDelta?: number;
  readonly seatWind: SeatWind;
  readonly status?: PlayerStatus;
  /** 自家の手牌(表向き)。他家では未使用。 */
  readonly hand?: readonly TileData[];
  /** 他家の伏せ手牌の枚数。自家では未使用。 */
  readonly handCount?: number;
  /** 副露(ポン・カン)。晒した面子を全員分表示する。 */
  readonly melds?: readonly MeldView[];
  /** 公開された抜き北(ガリ)の枚数。全員が常時確認できる公開情報。 */
  readonly kitaCount: number;
  /** 河(捨て牌)。着席3人分表示する。 */
  readonly discards: readonly TileData[];
}

/** 副露1組の表示データ(スペック4 `Meld`)。 */
export interface MeldView {
  /** 副露種別(ポン/カン)。 */
  readonly type: "pon" | "kan";
  /** 構成牌。暗槓は伏せ表示にするため `concealed` を併せて参照する。 */
  readonly tiles: readonly TileData[];
  /** 暗槓か(伏せ表示)。ポン・明槓は false。 */
  readonly concealed: boolean;
}

/** 抜け番(休み)プレイヤーの表示データ(スペック4 `Round.benchWarmer`)。 */
export interface BenchPlayerView {
  readonly name: string;
  /** 抜け番中は変化しない持ち点(スペック4 不変条件)。 */
  readonly points: number;
}

/**
 * 1スロットの表示内容。着席 or 抜け番の判別付きユニオン。
 * どの実プレイヤーがどのスロットに座り誰が抜け番かの決定は Q9・Q10 の責務であり、
 * UI はこの割り当て結果を受け取るだけ(スペック6 6.4.1)。
 */
export type SlotContent =
  | { readonly kind: "seated"; readonly player: SeatedPlayerView }
  | { readonly kind: "bench"; readonly player: BenchPlayerView };

/** スロット位置 → 表示内容 のマッピング(スペック6 6.4.1)。4枠のうち1枠が `bench`。 */
type SlotMap = Readonly<Record<SeatPosition, SlotContent>>;

/**
 * 卓中央の情報(スペック6 6.4.2 `TableInfo`)。
 * 場/局/オーラス判定ロジックは Q11 の責務。UI は与えられた値を表示するのみ(スペック6 6.8)。
 */
export interface TableInfoData {
  /** 場風。 */
  readonly roundWind: "east" | "south";
  /** 局数(1〜)。 */
  readonly handNumber: number;
  /** 本場。 */
  readonly honba: number;
  /** 供託(リーチ棒)本数。 */
  readonly riichiSticks: number;
  /** 開門サイコロ2個の出目。 */
  readonly dice: readonly [number, number];
  /** 出目から決まった表ドラ表示枚数。 */
  readonly doraCount: number;
}

/** ドラ表示(スペック6 6.4.2 `DoraIndicator`)。 */
export interface DoraData {
  /** 表ドラ表示牌(1〜3枚。枚数はサイコロ出目由来だが UI は結果を受け取るのみ)。 */
  readonly indicators: readonly TileData[];
  /** 裏ドラ表示牌。リーチ和了時のみ開示するため、対局中は枚数ぶん伏せて表示する。 */
  readonly uraIndicatorCount?: number;
  /** 開示済みの裏ドラ表示牌(リーチ和了の局終了時のみ非空)。 */
  readonly uraIndicators?: readonly TileData[];
}

/**
 * 結果画面(`/game/result`)の1プレイヤー分の表示データ(スペック6 6.2 / 6.8, スペック3 3.3)。
 *
 * ソシー精算 = ①素点 + ②順位ウマ + ③役満祝儀(スペック3 3.3)。ここに並ぶのは**表示専用の値**であり、
 * 順位の決定・素点(オカ配分)・ウマ割当(`質問リスト.md` Q13)・祝儀判定などの**計算ロジックは一切含めない**。
 * これらの値は将来ドメイン層(スペック3/4)が算出し、確定済みの結果として流し込む(スペック6 6.8)。
 */
export interface ResultPlayerView {
  readonly name: string;
  /** 最終順位(1〜)。順位決定ロジックは含めず、与えられた値を表示するのみ。 */
  readonly rank: number;
  /** ① 素点(1点=1ソシー、スペック3 3.3①)。 */
  readonly rawScore: number;
  /** ② 順位ウマ(スペック3 3.3②)。数値の割当ロジック(Q13)は含めない。 */
  readonly uma: number;
  /** ③ 役満祝儀(スペック3 3.3③)。 */
  readonly bonus: number;
  /**
   * ソシー合計(= rawScore + uma + bonus、スペック3 3.3)。
   * UI では計算せず、確定済みの合計値を受け取って表示する(スペック6 6.8)。
   */
  readonly soshiiTotal: number;
}

/**
 * 半荘終了時の結果ビュー(スペック6 6.2)。`GameProvider` が保持し `/game/result` が読む。
 * `players` は最終順位(`rank` 昇順)で並んだ確定済みの内訳。
 */
export interface GameResultView {
  readonly players: readonly ResultPlayerView[];
}

/**
 * 対局画面全体のビューモデル。`GameProvider` がブラウザメモリ内に保持し、
 * `/game` ⇄ `/game/result` で共有する(スペック6 6.5 / 6.9)。
 */
export interface GameViewState {
  readonly slots: SlotMap;
  readonly tableInfo: TableInfoData;
  readonly dora: DoraData;
  /**
   * 半荘終了時の結果ビュー(スペック6 6.2 / 6.8)。半荘終了まで結果は未確定のため `null`。
   * `/game/result` はこの値を `useContext` 経由で読み取り、`null` の場合は未確定として扱う。
   */
  readonly result: GameResultView | null;
}
