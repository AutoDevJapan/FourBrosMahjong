import {
  OKA,
  RETURN_POINTS,
  STARTING_POINTS,
} from "@/domain/scoring/settlement";

interface RuleItem {
  /** セクション内でもURL共有・監査に使える変更に強いID。 */
  readonly id: string;
  readonly label?: string;
  readonly body: string;
}

interface RuleSection {
  /** URL fragmentへ使う、表示文言から独立した安定ID。 */
  readonly id: string;
  readonly heading: string;
  readonly defaultOpen: boolean;
  readonly items: readonly RuleItem[];
}

/**
 * `docs/四兄弟麻雀ルール.md` と採用済み仕様をまとめた表示用SSOT。
 * 6セクション・29項目の構成を維持し、スクリーンショット内の要約で上書きしない。
 */
export const RULE_SECTIONS = [
  {
    id: "rule-basic-format",
    heading: "1. 基本形式",
    defaultOpen: true,
    items: [
      {
        id: "rule-basic-format-sanma",
        label: "三人打ち(サンマ)",
        body: "萬子の2〜8を抜いた三人麻雀を基本とする。関西式三人打ち(関西サンマ)に近いルール。",
      },
      {
        id: "rule-basic-format-rotation",
        label: "四人回し",
        body: "メンバーは4人いるため、1人が抜け番になり交代で打つ「四人回し」で進行する。抜け番の人は休憩・観戦する。",
      },
      {
        id: "rule-basic-format-hanchan",
        label: "東南戦",
        body: "東場・南場で回す。",
      },
      {
        id: "rule-basic-format-soshii",
        label: "ソシー",
        body: "金銭は賭けず、勝敗の可視化のために独自通貨「ソシー」を用いる。",
      },
    ],
  },
  {
    id: "rule-tiles-and-dora",
    heading: "2. 使用牌・ドラ牌",
    defaultOpen: true,
    items: [
      {
        id: "rule-tiles-and-dora-tile-set",
        label: "牌構成",
        body: "萬子の2〜8を抜いた、三人打ち標準の牌構成。",
      },
      {
        id: "rule-tiles-and-dora-all-red-five",
        label: "オール赤5",
        body: "5は各色すべて赤ドラ(5筒×4・5索×4の計8枚)。関西サンマ流の「オール赤5」。",
      },
      {
        id: "rule-tiles-and-dora-kita",
        label: "ガリ(北抜きドラ)",
        body: "北は抜きドラ「ガリ」として扱う。人間は自分の手番で北を持っているときに「北抜」を任意に選び、北を1枚ずつ場に晒して嶺上牌を補充できる。北を抜かずに保持したり、通常どおり打牌したりしてもよい。リーチ後に北抜できるのは、その手番でツモった北だけで、リーチ前から手牌にある北は抜けない。CPUは北を自動で抜く。和了時は抜いた北1枚ごとにドラ1枚として加算する。",
      },
    ],
  },
  {
    id: "rule-progress",
    heading: "3. 進行ルール",
    defaultOpen: false,
    items: [
      {
        id: "rule-progress-calls",
        label: "鳴き",
        body: "チー不可(三人打ちのためポン・カンのみ)。",
      },
      {
        id: "rule-progress-open-tanyao",
        label: "喰いタン・後付け",
        body: "なし(ナシナシ寄りの先付けルール)。喰い替えもなし。",
      },
      {
        id: "rule-progress-renchan",
        label: "連荘",
        body: "東場・南場ともに親はテンパイで連荘。",
      },
      {
        id: "rule-progress-honba",
        label: "本場",
        body: "積み棒(本場)あり。",
      },
      {
        id: "rule-progress-four-kans",
        label: "四槓散了",
        body: "複数家にまたがって4組目のカンが成立した場合は途中流局。1人だけの4槓は四槓子の和了機会を残す。途中流局は親継続・本場+1で、リーチ棒は持ち越す。",
      },
      {
        id: "rule-progress-riichi-sticks",
        label: "供託・ダブロン",
        body: "リーチ棒は供託扱い。ダブロン等が発生した場合は上家取り。",
      },
      {
        id: "rule-progress-riichi-established",
        label: "リーチの成立",
        body: "リーチは宣言牌がロンされず通った時点で成立する。宣言牌がロンされた場合はリーチ不成立となり、1,000点は供託しない。",
      },
      {
        id: "rule-progress-furiten-riichi",
        label: "フリテンリーチ",
        body: "あり(ただしツモ和了のみ可)。",
      },
      {
        id: "rule-progress-chankan",
        label: "槍槓(チャンカン)",
        body: "あり(加槓牌へのロン=横取り)。国士無双テンパイの他家に限り、暗槓に対しても槍槓ロンできる。",
      },
      {
        id: "rule-progress-riichi-ankan",
        label: "リーチ後の暗槓",
        body: "ツモ牌での暗槓に限り、待ちが変わらず、その4枚が全ての和了形で暗刻として確定している場合のみ可。送り槓・七対子テンパイでの暗槓は不可。",
      },
    ],
  },
  {
    id: "rule-scoring-and-dora",
    heading: "4. 点数・ドラ(サイコロ連動)",
    defaultOpen: true,
    items: [
      {
        id: "rule-scoring-and-dora-no-fu",
        label: "符計算なし",
        body: "符計算は行わず、翻数ベースの簡易計算。",
      },
      {
        id: "rule-scoring-and-dora-dice",
        label: "ドラめくり(サイコロ連動)",
        body: "開門位置を決めるサイコロの出目で表ドラ枚数が変動する。通常の出目→表ドラ1枚、ゾロ目→2枚、6のゾロ目(6・6)のみ→3枚。リーチ時の裏ドラも同じ枚数分乗る。",
      },
      {
        id: "rule-scoring-and-dora-inflation",
        label: "打点インフレ",
        body: "オール赤5・ガリ・複数ドラめくりが重なり、満貫以上の和了が頻発しやすい。",
      },
    ],
  },
  {
    id: "rule-settlement-and-soshii",
    heading: "5. 精算・祝儀(ソシー)",
    defaultOpen: true,
    items: [
      {
        id: "rule-settlement-and-soshii-starting-points",
        label: "配給原点・返し",
        body: `1人${STARTING_POINTS.toLocaleString("ja-JP")}点持ち(4人合計${(STARTING_POINTS * 4).toLocaleString("ja-JP")}点)、${RETURN_POINTS.toLocaleString("ja-JP")}点返し。`,
      },
      {
        id: "rule-settlement-and-soshii-settlement",
        label: "ソシー精算",
        body: `最終持ち点から${RETURN_POINTS.toLocaleString("ja-JP")}点を引いた素点に順位ウマを加え、1位にはオカ${OKA.toLocaleString("ja-JP")}を加算する。オカは4人分の配給原点と返しの差額合計。`,
      },
      {
        id: "rule-settlement-and-soshii-uma",
        label: "ウマ",
        body: "+10 / +5 / -5 / -10。",
      },
      {
        id: "rule-settlement-and-soshii-yakuman-bonus",
        label: "役満祝儀",
        body: "全員から1000(ソシー換算)。先着1名のみ・数え役満は対象外。責任払い(パオ)あり。",
      },
      {
        id: "rule-settlement-and-soshii-all-last",
        label: "オーラス条件",
        body: "オーラスで親が3万点を超えてトップの場合はそこで終了(和了やめ・テンパイやめ相当)。",
      },
      {
        id: "rule-settlement-and-soshii-bankruptcy",
        label: "トビ",
        body: "いずれかのプレイヤーの持ち点がマイナスに達した時点で半荘は即終了。",
      },
      {
        id: "rule-settlement-and-soshii-chombo",
        label: "チョンボ",
        body: "供託扱い(暫定運用)。",
      },
    ],
  },
  {
    id: "rule-special-elements",
    heading: "6. 名物要素(ルール外)",
    defaultOpen: false,
    items: [
      {
        id: "rule-special-elements-introduction",
        label: "開幕自己紹介",
        body: "毎回恒例の自己紹介(つかみ)が名物。",
      },
      {
        id: "rule-special-elements-24-hours",
        label: "24時間麻雀",
        body: "特別企画として24時間麻雀が複数回開催されている。",
      },
    ],
  },
] as const satisfies readonly RuleSection[];

export const RULE_ITEM_COUNT = RULE_SECTIONS.reduce(
  (count, section) => count + section.items.length,
  0,
);
