import { expect, type Locator, type Page, test } from "@playwright/test";
import { advanceUntil } from "./helpers/gameDriver";

/**
 * 非テキストコントラスト(WCAG 1.4.11)の実描画監査(#388 / スペック5 5.2.4)。
 *
 * ## なぜ必要か
 *
 * #388 まで、この破綻を検出できる仕組みがリポジトリに**存在しなかった**:
 *
 * - `src/app/globals.contrast.test.ts` は生のトークン同士しか比べられず、
 *   `border-foreground/25` のような**不透明度修飾子を評価できない**
 *   (#388 で `composite()` を入れて修飾子付きも測れるようにしたが、それは
 *   「あらかじめ列挙した組み合わせ」しか見ない)
 * - `e2e/a11y.spec.ts` の axe は `color-contrast`(テキストのみ)であり、
 *   **1.4.11 の非テキストコントラストは axe に実装がない**
 *
 * 本スペックは実際に描画された色を DOM から採取し、**列挙に頼らず**全ページの
 * 対話コントロールの境界線を機械的に検査する。新しいコントロールを足しても
 * 自動的に検査対象へ入る。
 *
 * ## 判定
 *
 * 対象は「境界線が可視な対話コントロール」。境界線色はそれ自体が半透明でありうるため
 * 要素自身の背景へ合成し、さらに**要素の外側の背景**(祖先の背景を不透明になるまで合成)
 * との比を測って 3:1 以上を要求する。無効化されたコントロールは 1.4.11 の対象外
 * (inactive user interface components)なので除外する。
 */

/** 非テキストコントラストの要求値(WCAG 1.4.11 / spec 5.2.4)。 */
const MIN_RATIO = 3;

type Theme = "ライト" | "OSダーク" | "手動ダーク";

interface Screen {
  readonly path: string;
  readonly heading: string;
  /**
   * クライアント描画が終わった目印。
   *
   * `<h1>` はサーバ側の静的な殻に含まれるため、見出しの可視化だけでは
   * **クライアントアイランドが未描画のまま監査してしまう**(`/game` は `mounted` になるまで
   * 「対局を準備しています…」のプレースホルダで、盤面の対話要素が 1 つも存在しない)。
   * 実際にこれで手牌が丸ごと監査から漏れていたため、画面ごとに待つ対象を明示する。
   *
   * クライアントアイランドを持つ画面(`/game` の盤面、`/history` の一覧、`/game/result`)では
   * **サーバ側の殻に含まれる要素を指してはならない**(待ちにならず穴が残る)。
   * 静的な画面(`/`・`/rules`・`/settings`)は SSR 済みで hydration により構造が変わらないため、
   * ここでの `ready` は「監査対象が描画済みであること」の明示に留まる。
   */
  readonly ready: (page: Page) => Locator;
  /**
   * 実際に比を測れた枠の数の下限。
   *
   * この監査の失敗モードは常に「静かに 0 件」で、違反ゼロのアサートだけでは
   * **測定が崩壊しても緑のまま**になる(実際 `/rules` は 6 件中 2 件、`/history` は 0 件しか
   * 測れていなかった)。画面ごとに下限を固定して、取りこぼしそのものを回帰対象にする。
   */
  readonly minMeasured: number;
}

const LOBBY: Screen = {
  path: "/",
  heading: "四兄弟麻雀",
  ready: (page) => page.getByRole("link", { name: /対局を開始/ }),
  minMeasured: 4,
};

const HISTORY: Screen = {
  path: "/history",
  heading: "戦績",
  // `MatchHistoryList`(Client)の描画完了を待つ。ヘッダのリンクはサーバ側の殻にあり待ちにならない。
  ready: (page) =>
    page.getByText(/保存された戦績はまだありません|新しい順に表示/).first(),
  // 空の戦績では枠を持つ対話コントロールがほぼ無い。件数のある状態は状態駆動ケースで測る。
  minMeasured: 0,
};

const GAME: Screen = {
  path: "/game?seed=0",
  heading: "対局画面",
  ready: (page) =>
    page
      .getByRole("listbox", { name: "自家の手牌" })
      .filter({ visible: true })
      .first(),
  // 内訳: 自家手牌 14 枚 + ヘッダの「ロビーへ戻る」1。配牌枚数を変える変更を入れると
  // ここも動くので、赤くなったら「取りこぼし」か「仕様変更」かを内訳で切り分けること。
  minMeasured: 15,
};

const RESULT: Screen = {
  path: "/game/result",
  heading: "対局結果",
  ready: (page) => page.getByRole("link", { name: /対局画面へ/ }).first(),
  minMeasured: 2,
};

const SCREENS: readonly Screen[] = [
  LOBBY,
  {
    path: "/rules",
    heading: "ルール説明",
    ready: (page) => page.getByRole("group").first(),
    minMeasured: 6,
  },
  {
    path: "/settings",
    heading: "設定",
    ready: (page) => page.getByRole("radio").first(),
    // 内訳: 対局者名の入力 4 + 保存/既定名に戻す 2 + テーマ選択カード 3 + 「戦績を見る」1。
    // ラジオ入力自体は UA 描画で CSS 枠を持たないため測定対象にならない。
    minMeasured: 10,
  },
  HISTORY,
  GAME,
  RESULT,
];

/** 戦績 1 件ぶんの保存データ(`matchHistory.ts` の保存形式)。 */
const HISTORY_FIXTURE = {
  version: 1,
  entries: [
    {
      seed: 12345,
      finishedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
      players: [
        {
          name: "一郎",
          rank: 1,
          rawScore: 30,
          uma: 20,
          bonus: 0,
          soshiiTotal: 50,
        },
        {
          name: "二郎",
          rank: 2,
          rawScore: 5,
          uma: 10,
          bonus: 0,
          soshiiTotal: 15,
        },
        {
          name: "三郎",
          rank: 3,
          rawScore: -10,
          uma: -10,
          bonus: 0,
          soshiiTotal: -20,
        },
        {
          name: "四郎",
          rank: 4,
          rawScore: -25,
          uma: -20,
          bonus: 0,
          soshiiTotal: -45,
        },
      ],
    },
  ],
};

/**
 * 結果確定まで到達させる seed。`e2e/a11y.spec.ts` の状態駆動監査と同じ値で、
 * ドライバ標準戦略(先頭牌打牌・スルー)で半荘終了まで進むことが確認済み。
 */
const SEED_RESULT = 1;

/**
 * 確定済み `/game/result` の測定件数フロア。
 * ヘッダの「ロビーへ戻る」+ フッタの「戦績を見る」「ロビーへ戻る」の 3 件。
 * 「もう一半荘」は塗り(`bg-foreground`)で枠を持たず、境界が地色差で伝わるため対象外。
 */
const RESULT_CONFIRMED_MIN_MEASURED = 3;

/** 戦績 1 件があるときの `/history` の測定件数フロア(`<details>` カード + 「戦績をすべて削除」)。 */
const HISTORY_WITH_ENTRY_MIN_MEASURED = 2;

/** 削除確認 UI の測定件数フロア(カード + 「削除する」+「キャンセル」)。 */
const HISTORY_DELETE_CONFIRM_MIN_MEASURED = 3;

/**
 * 段階②(320px)の `/game` の測定件数フロア。
 * 段階①の内訳(自家手牌 14 + ヘッダの「ロビーへ戻る」1)に「全体盤面」ボタンが 1 件加わる。
 */
const GAME_NARROW_MIN_MEASURED = 16;

/**
 * 監査テーマ。配色トークンはライト/ダークの 2 系統だが、ダークは「OS 追従」と「手動選択」で
 * 別々の CSS スコープに二重定義されている(`globals.css`)。片方だけ更新する事故を検出するため
 * 両方走らせる(`e2e/a11y.spec.ts` の全画面監査と同じ 3 テーマ)。
 */
const THEMES: readonly Theme[] = ["ライト", "OSダーク", "手動ダーク"];

/**
 * 状態駆動シナリオで使うテーマ(`e2e/a11y.spec.ts` の `STATE_DRIVEN_THEMES` と同方針)。
 * OS ダークは手動ダークと同一のトークン値なので、配色検証としては重複する。
 */
const STATE_DRIVEN_THEMES: readonly Theme[] = ["ライト", "手動ダーク"];

interface Offender {
  readonly label: string;
  readonly border: string;
  readonly background: string;
  readonly ratio: number;
}

/** 指定テーマで画面を開く(`e2e/a11y.spec.ts` の `openScreen` と同じ経路)。 */
async function openScreen(
  page: Page,
  screen: Screen,
  theme: Theme,
): Promise<void> {
  if (theme === "OSダーク") {
    await page.emulateMedia({ colorScheme: "dark" });
  } else if (theme === "手動ダーク") {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("theme", "dark");
      } catch {
        // localStorage 不可環境ではダーク適用を諦める(監査はライト相当で走る)。
      }
    });
  }
  await page.goto(screen.path);
  await expect(
    page.getByRole("heading", { level: 1, name: screen.heading }),
  ).toBeVisible();
  await expect(screen.ready(page)).toBeVisible();

  // テーマが実際に適用されたことを確かめる。これが無いと `ThemeToggle` の保存キーや
  // `layout.tsx` の初期化スクリプトが変わったときに、「手動ダーク」の 6 ケースが
  // **黙ってライトを二重に測るだけ**になり、ダーク側トークンの回帰が無音で消える。
  const root = page.locator("html");
  if (theme === "手動ダーク") {
    await expect(root).toHaveAttribute("data-theme", "dark");
  } else {
    // OS ダークは `:root:not([data-theme])` 経路。手動選択の属性が付いていてはいけない。
    await expect(root).not.toHaveAttribute("data-theme", /.*/);
  }
}

/** `collectOffenders` の戻り値。 */
interface AuditResult {
  /** `minRatio` 未満だったもの(合格分は失敗メッセージを膨らませるだけなので返さない)。 */
  readonly offenders: readonly Offender[];
  /** 実際に比を測れた枠の数。監査が静かに 0 件へ落ちる失敗モードを検出するために使う。 */
  readonly measured: number;
}

/** 実描画された対話コントロールの境界線コントラストを採取する。 */
async function collectOffenders(
  page: Page,
  minRatio: number,
): Promise<AuditResult> {
  return page.evaluate((min) => {
    /*
     * 色の解決は **canvas への実描画**で行う。`getComputedStyle` が返す色は
     * `color-mix()` 由来だと `color(srgb …)` や `oklab(…)` 等になり、`rgb()/rgba()` 前提の
     * 文字列パースでは読めない。読めない色を「対象外」として飛ばすと、**まさに検出したい
     * 不透明度修飾子つきの枠が静かに監査から抜け落ちる**(実際にそうなっていた)。
     * canvas に重ね塗りしてピクセルを読めば、CSS のどの色構文でも合成後の実色が得られる。
     */
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null) throw new Error("canvas 2D コンテキストを取得できない");

    type RGB = [number, number, number];

    /** `base` の上に `layers` を下から順に重ね塗りし、合成後の sRGB を返す。 */
    const paint = (layers: readonly string[], base: RGB): RGB => {
      ctx.globalCompositeOperation = "copy";
      ctx.fillStyle = `rgb(${base[0]}, ${base[1]}, ${base[2]})`;
      ctx.fillRect(0, 0, 1, 1);
      ctx.globalCompositeOperation = "source-over";
      for (const layer of layers) {
        ctx.fillStyle = layer;
        ctx.fillRect(0, 0, 1, 1);
      }
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    };

    /**
     * canvas がその色文字列を解釈できたか。
     *
     * 解釈できない値は `fillStyle` への代入が**無視される**(直前の値が残る)。この性質を使い、
     * 異なる番兵を置いてから代入し、結果が一致するかで判定する。文字列の見た目で
     * 「透明」を判別しようとすると、Tailwind の α 修飾子が `color-mix(…, transparent)` へ
     * コンパイルされる都合で正当な透明色を誤検出するため、構文には依存しない。
     */
    const parsesAsColor = (color: string): boolean => {
      ctx.fillStyle = "#000000";
      ctx.fillStyle = color;
      const fromBlack = ctx.fillStyle;
      ctx.fillStyle = "#ffffff";
      ctx.fillStyle = color;
      return fromBlack === ctx.fillStyle;
    };

    /**
     * 色の不透明度(0〜1)。黒地と白地に置いた結果の差から求める。
     *
     * canvas が解釈できない色は「完全に透明」と同じ数値になる。それを黙って 0 として扱うと
     * **検査対象から静かに抜け落ちる**(この監査が避けたい失敗モードそのもの)ため、
     * 解釈できなかった場合は明示エラーにする。
     */
    const alphaOf = (color: string): number => {
      if (!parsesAsColor(color)) {
        throw new Error(
          `canvas が解釈できない色を無音で除外しかけた: ${color}`,
        );
      }
      const onBlack = paint([color], [0, 0, 0]);
      const onWhite = paint([color], [255, 255, 255]);
      return 1 - (onWhite[0] - onBlack[0]) / 255;
    };

    const linearize = (channel: number): number => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (rgb: RGB): number =>
      0.2126 * linearize(rgb[0]) +
      0.7152 * linearize(rgb[1]) +
      0.0722 * linearize(rgb[2]);
    const ratio = (a: RGB, b: RGB): number => {
      const la = luminance(a);
      const lb = luminance(b);
      const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
      return (hi + 0.05) / (lo + 0.05);
    };

    /** `start` から祖先を遡り、不透明な層に達するまでの背景色を下→上の順で集める。 */
    const backgroundLayers = (start: Element | null): string[] => {
      const layers: string[] = [];
      for (let el = start; el !== null; el = el.parentElement) {
        const color = getComputedStyle(el).backgroundColor;
        const alpha = alphaOf(color);
        if (alpha <= 0.004) continue;
        layers.unshift(color);
        if (alpha >= 0.996) break;
      }
      return layers;
    };

    const describe = (el: Element): string => {
      const name =
        el.getAttribute("aria-label") ??
        (el.textContent ?? "").trim().slice(0, 24);
      return `<${el.tagName.toLowerCase()}> ${name || "(名前なし)"}`;
    };

    /** 可視な枠(4辺のいずれか)を持つか。 */
    const visibleBorder = (style: CSSStyleDeclaration): boolean =>
      (["Top", "Right", "Bottom", "Left"] as const).some(
        (side) =>
          Number.parseFloat(style[`border${side}Width`]) > 0 &&
          style[`border${side}Style`] !== "none" &&
          style[`border${side}Style`] !== "hidden" &&
          alphaOf(style[`border${side}Color`]) > 0.004,
      );

    /**
     * その対話コントロールの境界を描いている要素を返す。
     *
     * **枠の持ち主がコントロール自身とは限らない**:
     * - ロビーのメニューは `<li>` が枠を持ち、中の `<a>` は `border-width: 0`(祖先側)
     * - 自家手牌の `li[role="option"]` は枠を持たず、中の牌 `<span>` が枠を持つ(子孫側)
     * - 開閉コントロールの `<summary>` の枠は、必ず親 `<details>` が描く(構造的に確定)
     *
     * `<summary>` 以外は「そのコントロールの見た目上の境界」を、自身 → 祖先 → 子孫の順に
     * **矩形がほぼ一致するもの**へ限定して探す。一致条件が無いと、枠を持たないテキストリンクが
     * 無関係な祖先コンテナの装飾枠を自分の境界として拾い偽陽性になる(実測で「ロビーへ戻る」が
     * 1.37:1 と誤検出された)。祖先側はさらに「その祖先が他の対象コントロールを含まないこと」を
     * 課し、複数コントロールをまとめる装飾カードを個々の境界と取り違えないようにする。
     */
    // 「ほぼ同じ矩形」の許容量。インライン整形文脈の行間で数 px ずれるため相対比で見る。
    const COVERAGE = 0.85;
    const borderOwner = (
      el: Element,
      targets: Set<Element>,
    ): Element | null => {
      // `<details>` は開くと `<summary>` より遥かに背が高くなり、矩形一致条件では必ず弾かれる。
      // 枠と開閉コントロールの対応は DOM 構造で確定しているため、矩形を条件にしない。
      // (これが無いと `/rules` の既定展開セクション 4/6 が丸ごと未測定になっていた)
      if (el.tagName === "SUMMARY") {
        const details = el.parentElement;
        if (details === null || details.tagName !== "DETAILS") return null;
        if (visibleBorder(getComputedStyle(el))) return el;
        return visibleBorder(getComputedStyle(details)) ? details : null;
      }

      const base = el.getBoundingClientRect();
      if (base.width <= 0 || base.height <= 0) return null;
      const covers = (node: Element): boolean => {
        const rect = node.getBoundingClientRect();
        return (
          rect.width >= base.width * COVERAGE &&
          rect.height >= base.height * COVERAGE
        );
      };
      const containedIn = (node: Element): boolean => {
        const rect = node.getBoundingClientRect();
        return (
          rect.width <= base.width / COVERAGE &&
          rect.height <= base.height / COVERAGE
        );
      };
      /**
       * その祖先が自分以外の対象コントロールを含んでいたら、共有の装飾枠とみなす。
       * `contains` は自分自身にも真を返すため、`node` 自身と `el` は候補から除く。
       */
      const wrapsOtherControls = (node: Element): boolean => {
        for (const target of targets) {
          if (target === el || target === node) continue;
          if (node.contains(target)) return true;
        }
        return false;
      };

      if (visibleBorder(getComputedStyle(el))) return el;
      for (
        let node = el.parentElement;
        node !== null && node !== document.body;
        node = node.parentElement
      ) {
        if (!containedIn(node)) break;
        if (wrapsOtherControls(node)) break;
        if (visibleBorder(getComputedStyle(node))) return node;
      }
      for (const node of el.querySelectorAll("*")) {
        if (!covers(node)) continue;
        if (visibleBorder(getComputedStyle(node))) return node;
      }
      return null;
    };

    const selector = [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "summary",
      '[role="button"]',
      '[role="link"]',
      '[role="option"]',
      "label",
    ].join(", ");

    const offenders: {
      label: string;
      border: string;
      background: string;
      ratio: number;
    }[] = [];
    const seen = new Set<Element>();
    /** 実際に比を測れた枠の数。0 に落ちる=監査が静かに壊れた、を検出するために返す。 */
    let measured = 0;

    const candidates = [...document.querySelectorAll(selector)];
    const targets = new Set(candidates);

    for (const el of candidates) {
      // ラベルは内部にフォーム部品を持つもの(クリック可能なカード)だけを見る。
      if (
        el.tagName === "LABEL" &&
        el.querySelector("input,select,textarea") === null
      ) {
        continue;
      }
      // 1.4.11 は無効化されたコントロールを対象外にする。
      if (
        el.matches(":disabled") ||
        el.getAttribute("aria-disabled") === "true"
      ) {
        continue;
      }
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (
        (el as HTMLElement).offsetParent === null &&
        style.position !== "fixed"
      ) {
        continue;
      }

      const owner = borderOwner(el, targets);
      if (owner === null || seen.has(owner)) continue;
      seen.add(owner);

      const ownerStyle = getComputedStyle(owner);
      // 背景は border-box まで描かれるため、枠色は「祖先の背景 → 自分の背景 → 枠」の順に重なる。
      const outsideLayers = backgroundLayers(owner.parentElement);
      const outside = paint(outsideLayers, [255, 255, 255]);

      // 4 辺のうち可視な辺の最小比を採る(下線型の入力など 1 辺だけの枠も検査対象にする)。
      let worst: { ratio: number; color: RGB } | null = null;
      for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
        if (!(Number.parseFloat(ownerStyle[`border${side}Width`]) > 0))
          continue;
        if (ownerStyle[`border${side}Style`] === "none") continue;
        if (ownerStyle[`border${side}Style`] === "hidden") continue;
        const color = ownerStyle[`border${side}Color`];
        if (alphaOf(color) <= 0.004) continue;
        const composited = paint(
          [...outsideLayers, ownerStyle.backgroundColor, color],
          [255, 255, 255],
        );
        const r = ratio(composited, outside);
        if (worst === null || r < worst.ratio)
          worst = { ratio: r, color: composited };
      }
      if (worst === null) continue;
      measured += 1;

      if (worst.ratio < min) {
        const fmt = (c: RGB) => `rgb(${c.join(",")})`;
        offenders.push({
          label: describe(el),
          border: fmt(worst.color),
          background: fmt(outside),
          ratio: Math.round(worst.ratio * 100) / 100,
        });
      }
    }
    return { offenders, measured };
  }, minRatio);
}

/** 失敗メッセージ用に違反を整形する。 */
function formatOffenders(offenders: readonly Offender[]): string {
  return offenders
    .map(
      (o) =>
        `  ${o.label} — 枠 ${o.border} / 地 ${o.background} = ${o.ratio}:1`,
    )
    .join("\n");
}

/** 画面 1 つを監査する: 測定件数のフロアと、違反ゼロの双方を主張する。 */
async function auditScreen(
  page: Page,
  label: string,
  minMeasured: number,
): Promise<void> {
  const { offenders, measured } = await collectOffenders(page, MIN_RATIO);
  expect(
    measured,
    `${label}: 監査できた枠が ${measured} 件で想定(${minMeasured} 件)を下回った。` +
      "検査対象の取りこぼし(監査が静かに壊れている)を疑うこと。",
  ).toBeGreaterThanOrEqual(minMeasured);
  expect(
    offenders,
    `${label}: 非テキストコントラスト ${MIN_RATIO}:1 未満の対話コントロール:\n` +
      formatOffenders(offenders),
  ).toEqual([]);
}

test.describe("非テキストコントラスト(WCAG 1.4.11 / #388)", () => {
  for (const theme of THEMES) {
    for (const screen of SCREENS) {
      test(`${theme} / ${screen.path}: 対話コントロールの境界線が ${MIN_RATIO}:1 以上`, async ({
        page,
      }) => {
        await openScreen(page, screen, theme);
        await auditScreen(
          page,
          `${theme} / ${screen.path}`,
          screen.minMeasured,
        );
      });
    }
  }

  /**
   * 監査自身の自己検査(#388)。
   *
   * この監査の最大の失敗モードは「壊れていても常に緑」= 静かな取りこぼしである
   * (実際、初版は `getComputedStyle` の `color(srgb …)` を読めず、修正前でも全件緑だった)。
   * そこで **意図的に 3:1 未満の枠を注入し、それを検出できること**を同じ経路で確認する。
   * この検査が落ちたら、他の全ケースの緑は信用できない。
   *
   * 画面単位の「測定件数フロア」(`Screen.minMeasured`)と対で、
   * 「検出器が動くこと」と「各画面で実際に測れていること」の両方を固定する。
   */
  test("自己検査: 3:1 未満の枠を注入すると検出できる", async ({ page }) => {
    await openScreen(page, LOBBY, "ライト");
    const before = await collectOffenders(page, MIN_RATIO);
    expect(before.offenders).toEqual([]);

    // ページ背景(白)に対し 1.2:1 程度しかない枠を持つボタンを差し込む。
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "注入されたコントロール";
      button.style.border = "1px solid #eeeeee";
      button.style.background = "transparent";
      document.body.append(button);
    });

    const after = await collectOffenders(page, MIN_RATIO);
    expect(after.measured).toBe(before.measured + 1);
    const injected = after.offenders.find(
      (o) => o.label === "<button> 注入されたコントロール",
    );
    expect(
      injected,
      `注入した低コントラスト枠を検出できなかった:\n${formatOffenders(after.offenders)}`,
    ).toBeDefined();
    expect(injected?.ratio).toBeLessThan(MIN_RATIO);
  });

  /**
   * 初期局面だけでは走査外になる局面依存の描画も監査する
   * (`e2e/a11y.spec.ts` の状態駆動シナリオと同じ考え方)。
   */
  test("状態駆動: 段階②(320px)と全体盤面モーダルでも 3:1 以上", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openScreen(page, GAME, "ライト");

    // 段階②はクロス配置(段階①)に「全体盤面」ボタンが加わるぶんだけ対象が増える。
    const before = await collectOffenders(page, MIN_RATIO);
    expect(
      before.measured,
      `段階②(320px): 監査できた枠が ${before.measured} 件で想定(${GAME_NARROW_MIN_MEASURED} 件)を下回った。`,
    ).toBeGreaterThanOrEqual(GAME_NARROW_MIN_MEASURED);
    expect(
      before.offenders,
      `段階②(320px):\n${formatOffenders(before.offenders)}`,
    ).toEqual([]);

    const opener = page.getByRole("button", { name: "全体盤面" });
    await expect(opener).toBeVisible();
    await opener.click();
    await expect(page.getByRole("dialog", { name: "全体盤面" })).toBeVisible();

    // モーダルは Portal 配下で背景の合成経路が別。閲覧専用なので手牌は option を持たず、
    // 増える対象は Modal の「閉じる」ボタンちょうど 1 件。
    // ここは**下限ではなく厳密増分**で固定する。下限だとモーダル分が 1 件も増えなくても
    // 緑になり、この監査が潰そうとしている「フロアが低すぎて何も保証しない」形になる。
    const after = await collectOffenders(page, MIN_RATIO);
    expect(
      after.measured,
      "全体盤面モーダル: 「閉じる」ボタンが監査対象に増えていない(Portal 配下が測れていない)",
    ).toBe(before.measured + 1);
    expect(
      after.offenders,
      `全体盤面モーダル:\n${formatOffenders(after.offenders)}`,
    ).toEqual([]);
  });

  /**
   * 確定済みの結果が表示された `/game/result`(#388)。
   *
   * 直接アクセスは「結果未確定」のフォールバックになり、`ResultPageClient` の
   * 「もう一半荘」「戦績を見る」「ロビーへ戻る」の 3 コントロールが一度も測られない。
   * 実対局を終局まで進めてから監査する。
   */
  test("状態駆動: 確定済みの /game/result でも 3:1 以上", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/game?seed=${SEED_RESULT}`);
    await expect(GAME.ready(page)).toBeVisible();

    // 半荘終了(gameEnd)まで進め、最終局の決着表示から結果画面へ入る(#277: 自動遷移は無い)。
    await advanceUntil(page, (state) => state?.phase === "gameEnd", {
      maxSteps: 1500,
      onGameEnd: "stop",
    });
    await page
      .getByRole("button", { name: "結果を見る" })
      .filter({ visible: true })
      .first()
      .click();
    await page.waitForURL((url) => url.pathname === "/game/result");

    await expect(
      page.getByRole("button", { name: /もう一半荘/ }),
    ).toBeVisible();
    await auditScreen(
      page,
      "確定済み /game/result",
      RESULT_CONFIRMED_MIN_MEASURED,
    );
  });

  /**
   * 戦績が 1 件以上ある `/history`(#388)。
   *
   * 空の戦績では枠を持つ対話コントロールがほとんど描かれず、静的監査だけでは
   * `MatchHistoryList` の `<details>` カードと削除ボタン群が一度も測られない。
   */
  for (const theme of STATE_DRIVEN_THEMES) {
    test(`状態駆動: 戦績のある /history でも 3:1 以上 [${theme}]`, async ({
      page,
    }) => {
      await page.addInitScript((entry) => {
        try {
          localStorage.setItem("four-bros-mahjong.history.v1", entry);
        } catch {
          // localStorage 不可環境では空状態のまま監査する。
        }
      }, JSON.stringify(HISTORY_FIXTURE));

      await openScreen(page, HISTORY, theme);
      const card = page.getByRole("group").first();
      await expect(card).toBeVisible();
      await auditScreen(
        page,
        `戦績あり /history [${theme}]`,
        HISTORY_WITH_ENTRY_MIN_MEASURED,
      );

      // 展開そのものを待つ。「戦績をすべて削除」は展開前から可視なので、
      // それを待ちにするとクリックが不発でも緑になる。
      await card.locator("summary").first().click();
      await expect(card).toHaveAttribute("open", "");
      await auditScreen(
        page,
        `戦績あり /history(展開後) [${theme}]`,
        HISTORY_WITH_ENTRY_MIN_MEASURED,
      );

      // 削除確認 UI は --danger の枠を持つ唯一の実描画経路。トークン単体テストはあるが、
      // 「実際に載る地」の上での比はここでしか測れない。
      await page.getByRole("button", { name: /戦績をすべて削除/ }).click();
      await expect(
        page.getByRole("button", { name: /削除する/ }),
      ).toBeVisible();
      await auditScreen(
        page,
        `戦績削除の確認 UI [${theme}]`,
        HISTORY_DELETE_CONFIRM_MIN_MEASURED,
      );
    });
  }
});
