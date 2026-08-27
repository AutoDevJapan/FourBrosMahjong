import { describe, expect, it } from "vitest";
import { token } from "./globals.cssParse";

/**
 * 配色トークンのコントラスト回帰テスト(#147 / spec5 5.2.4)。
 *
 * `globals.css` の実トークン値を読み取り、WCAG 2.1 の相対輝度式でコントラスト比を計算する。
 * 赤ドラ「赤」バッジ(文字 `--tile-face` × 地 `--tile-badge-red`)がライト/ダーク双方で
 * 通常テキスト基準 4.5:1(WCAG 1.4.3)を満たすことを固定し、トークン変更時の退行を防ぐ。
 * ダークの `--tile-badge-red` は `:root` の値を継承する(ダーク側で上書きしない)ため、
 * ライト・ダークとも地色は同一の深い赤で評価する。
 */

/** sRGB 1 チャンネルを相対輝度用の線形値へ変換(WCAG 2.1 定義)。 */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** #rrggbb の相対輝度(WCAG 2.1)。 */
function luminance(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** 2 色間のコントラスト比(1〜21)。 */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** #rrggbb を 0〜255 の 3 チャンネルへ分解する。 */
function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * 不透明度 `alpha`(0〜1)の前景色 `fg` を地 `bg` へ重ねた合成色を返す(#388)。
 *
 * Tailwind の `text-x/25` / `bg-x/10` のような**不透明度修飾子は、トークンの値を見ても
 * 実際に描画される色が分からない**。生トークン同士の比較だけでは、`border-foreground/25`
 * が実際には 1.73:1 しかない、といった破綻を原理的に検出できない(#388 の根本原因)。
 * 合成してから比を測ることで、修飾子付きの実描画色を回帰対象にできる。
 */
function composite(fg: string, alpha: number, bg: string): string {
  const [fr, fg_, fb] = channels(fg);
  const [br, bg_, bb] = channels(bg);
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex(mix(fr, br))}${hex(mix(fg_, bg_))}${hex(mix(fb, bb))}`;
}

describe("赤ドラ「赤」バッジのコントラスト(#147 / WCAG 1.4.3)", () => {
  const badgeBg = token(":root", "--tile-badge-red");
  const lightFace = token(":root", "--tile-face");
  const darkFace = token(':root[data-theme="dark"]', "--tile-face");

  it("ライトテーマで文字×地が 4.5:1 以上", () => {
    expect(contrast(lightFace, badgeBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("ダークテーマで文字×地が 4.5:1 以上(バッジ地色は :root を継承)", () => {
    expect(contrast(darkFace, badgeBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("枠 --tile-accent-red はダークでも牌面地に対し非テキスト 3:1 以上を維持", () => {
    // バッジ地色を枠から分離しても、枠(border=非テキスト)の識別コントラストは退行させない。
    const darkBorder = token(':root[data-theme="dark"]', "--tile-accent-red");
    expect(contrast(darkFace, darkBorder)).toBeGreaterThanOrEqual(3);
  });
});

describe("StatusBadge の felt 上コントラスト(#154 / #157 / WCAG 1.4.3)", () => {
  // default/riichi/highlight バッジは明色地 --tile-face を敷き、その上に濃色トークンで文字を描く。
  // 文字×バッジ地(--tile-face)がライト/ダーク双方で通常テキスト 4.5:1 を満たすことを固定する。
  const lightFace = token(":root", "--tile-face");
  const darkFace = token(':root[data-theme="dark"]', "--tile-face");
  const lightFelt = token(":root", "--table-felt");
  const darkFelt = token(':root[data-theme="dark"]', "--table-felt");
  // 文字トークンはテーマ非依存(:root のみで定義、ダーク側で上書きしない)。
  // default(◆親)は牌面印字色 --tile-ink をバッジ文字に再利用する(#157)。--tile-ink は
  // ダーク側でも同値(明色地に濃色印字)のため、ライト/ダークとも同一値で評価する。
  const defaultInk = token(":root", "--tile-ink");
  const riichiInk = token(":root", "--tile-badge-red");
  const highlightInk = token(":root", "--turn-highlight-ink");

  it("default(親): 文字×バッジ地がライトで 4.5:1 以上", () => {
    expect(contrast(defaultInk, lightFace)).toBeGreaterThanOrEqual(4.5);
  });

  it("default(親): 文字×バッジ地がダークで 4.5:1 以上", () => {
    expect(contrast(defaultInk, darkFace)).toBeGreaterThanOrEqual(4.5);
  });

  it("riichi: 文字×バッジ地がライトで 4.5:1 以上", () => {
    expect(contrast(riichiInk, lightFace)).toBeGreaterThanOrEqual(4.5);
  });

  it("riichi: 文字×バッジ地がダークで 4.5:1 以上", () => {
    expect(contrast(riichiInk, darkFace)).toBeGreaterThanOrEqual(4.5);
  });

  it("highlight: 文字×バッジ地がライトで 4.5:1 以上", () => {
    expect(contrast(highlightInk, lightFace)).toBeGreaterThanOrEqual(4.5);
  });

  it("highlight: 文字×バッジ地がダークで 4.5:1 以上", () => {
    expect(contrast(highlightInk, darkFace)).toBeGreaterThanOrEqual(4.5);
  });

  it("バッジ地 --tile-face が felt に対し非テキスト 3:1 以上(地と識別可能)", () => {
    // バッジ自体が卓 felt 上で図地分離できることを保証する(非テキスト UI 境界=3:1)。
    expect(contrast(lightFace, lightFelt)).toBeGreaterThanOrEqual(3);
    expect(contrast(darkFace, darkFelt)).toBeGreaterThanOrEqual(3);
  });
});

describe("牌枠 --tile-border の非テキストコントラスト(#148 項目2 / WCAG 1.4.11)", () => {
  // 白地に直接載る手牌の枠は、ページ背景に対し非テキスト境界 3:1(スペック5 5.2.4)が必要。
  // フラット 1 色では白地(暗い枠が有利)と緑フェルト(明るい枠が有利)を同時に満たせないため、
  // 白地側を基準に固定する。フェルト上の輪郭は牌面 --tile-face/伏せ牌の内側環が担う(globals.css 参照)。
  it("ライトテーマで白系ページ背景に対し 3:1 以上", () => {
    const lightBorder = token(":root", "--tile-border");
    const lightBg = token(":root", "--background");
    expect(contrast(lightBorder, lightBg)).toBeGreaterThanOrEqual(3);
  });

  it("ダークテーマで暗いページ背景に対し 3:1 以上(退行防止)", () => {
    const darkBorder = token(':root[data-theme="dark"]', "--tile-border");
    const darkBg = token(':root[data-theme="dark"]', "--background");
    expect(contrast(darkBorder, darkBg)).toBeGreaterThanOrEqual(3);
  });
});

describe("フォーカスリング --focus-ring の非テキストコントラスト(#314 / WCAG 1.4.11)", () => {
  // グローバル `:focus-visible` が全画面のフォーカスリングを描画する(下の regression テスト参照)。
  // リングは非テキスト UI 部品なので、隣接するページ背景に対し 3:1(スペック5 5.2.4)が必要。
  const lightBg = token(":root", "--background");

  it("ライトテーマでページ背景に対し 3:1 以上", () => {
    expect(
      contrast(token(":root", "--focus-ring"), lightBg),
    ).toBeGreaterThanOrEqual(3);
  });

  it('手動ダーク(data-theme="dark")でページ背景に対し 3:1 以上', () => {
    const scope = ':root[data-theme="dark"]';
    expect(
      contrast(token(scope, "--focus-ring"), token(scope, "--background")),
    ).toBeGreaterThanOrEqual(3);
  });

  it("OS ダーク追従(:root:not([data-theme]))でページ背景に対し 3:1 以上", () => {
    const scope = ":root:not([data-theme])";
    expect(
      contrast(token(scope, "--focus-ring"), token(scope, "--background")),
    ).toBeGreaterThanOrEqual(3);
  });
});

/**
 * 対話コントロールの境界線(#388 / WCAG 1.4.11)。
 *
 * `--control-border` はボタン・リンクの pill・テキスト入力・ラジオのラベルカードの枠に使う。
 * 枠が唯一のコントロール識別手段になる場合(`/settings` の対局者名入力は地が透明)があるため、
 * ページ背景とホバー地の**双方**に対して非テキスト 3:1 を満たす必要がある。
 *
 * ホバー地は `hover:bg-foreground/5`(= `--foreground` を 5% ページ背景へ重ねた色)。
 * 修飾子付きの実描画色を見るため `composite()` で合成してから比を測る。
 */
describe("対話コントロール枠 --control-border の非テキストコントラスト(#388 / WCAG 1.4.11)", () => {
  const scopes = [
    ["ライト", ":root"],
    ['手動ダーク(data-theme="dark")', ':root[data-theme="dark"]'],
    ["OS ダーク追従", ":root:not([data-theme])"],
  ] as const;

  for (const [label, scope] of scopes) {
    const border = token(scope, "--control-border");
    const bg = token(scope, "--background");

    it(`${label}: ページ背景に対し 3:1 以上`, () => {
      expect(contrast(border, bg)).toBeGreaterThanOrEqual(3);
    });

    it(`${label}: ホバー地(bg-foreground/5)に対し 3:1 以上`, () => {
      const hover = composite(token(scope, "--foreground"), 0.05, bg);
      expect(contrast(border, hover)).toBeGreaterThanOrEqual(3);
    });
  }

  it("旧実装の border-foreground/25 は 3:1 を満たさない(この検査が実効的であることの確認)", () => {
    // 合成を挟まずトークン同士を比べる従来の検査では、この破綻を検出できなかった。
    for (const scope of [":root", ':root[data-theme="dark"]']) {
      const bg = token(scope, "--background");
      const legacy = composite(token(scope, "--foreground"), 0.25, bg);
      expect(contrast(legacy, bg)).toBeLessThan(3);
    }
  });
});

/**
 * spec 5.4.2 が要求しているのにテストが無かったトークンの回帰(#388)。
 * いずれも現状値は合格しているが、無防備なままだと #159 と同種の退行が無音で通る。
 */
describe("spec 5.4.2 が名指しするトークンのコントラスト(#388)", () => {
  const scopes = [
    ["ライト", ":root"],
    ['手動ダーク(data-theme="dark")', ':root[data-theme="dark"]'],
    ["OS ダーク追従", ":root:not([data-theme])"],
  ] as const;

  for (const [label, scope] of scopes) {
    const bg = token(scope, "--background");

    it(`${label}: ActionPanel 主要ボタンの文字が淡地(bg-turn-highlight/10)に対し 4.5:1 以上`, () => {
      const face = composite(token(scope, "--turn-highlight"), 0.1, bg);
      expect(
        contrast(token(scope, "--turn-highlight-strong"), face),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`${label}: 同ボタンのホバー地(bg-turn-highlight/20)でも 4.5:1 以上`, () => {
      const face = composite(token(scope, "--turn-highlight"), 0.2, bg);
      expect(
        contrast(token(scope, "--turn-highlight-strong"), face),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`${label}: --danger がページ背景に対し 4.5:1 以上`, () => {
      expect(contrast(token(scope, "--danger"), bg)).toBeGreaterThanOrEqual(
        4.5,
      );
    });

    it(`${label}: --positive がページ背景に対し 4.5:1 以上`, () => {
      expect(contrast(token(scope, "--positive"), bg)).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  }

  it("ライト: --positive が全キャラクター結果カード地に対し 4.5:1 以上", () => {
    const scope = ":root";
    const bg = token(scope, "--background");
    const positive = token(scope, "--positive");

    for (const theme of ["red", "blue", "yellow", "green"] as const) {
      const surface = composite(token(scope, `--character-${theme}`), 0.07, bg);
      expect(contrast(positive, surface), theme).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("Issue #712 共通UI foundationのコントラスト", () => {
  const scopes = [
    ["ライト", ":root"],
    ['手動ダーク(data-theme="dark")', ':root[data-theme="dark"]'],
    ["OS ダーク追従", ":root:not([data-theme])"],
  ] as const;

  for (const [label, scope] of scopes) {
    const canvas = token(scope, "--ui-canvas");
    const surface = token(scope, "--ui-surface");
    const raised = token(scope, "--ui-surface-raised");
    const decoration = token(scope, "--ui-gold-decoration");
    const panel = composite(surface, 0.96, canvas);

    it(`${label}: 本文・補助文・gold textがsurface上で4.5:1以上`, () => {
      for (const name of ["--ui-text", "--ui-muted", "--ui-gold-text"]) {
        expect(
          contrast(token(scope, name), surface),
          name,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${label}: primary文字が通常・hover地で4.5:1以上`, () => {
      const foreground = token(scope, "--ui-accent-foreground");
      expect(
        contrast(foreground, token(scope, "--ui-accent")),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(foreground, token(scope, "--ui-accent-hover")),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`${label}: 金罫線がcanvas・surfaceの双方で3:1以上`, () => {
      const frame = token(scope, "--ui-frame");
      expect(contrast(frame, canvas)).toBeGreaterThanOrEqual(3);
      expect(contrast(frame, panel)).toBeGreaterThanOrEqual(3);
    });

    it(`${label}: 96% panel上の本文・補助文が実合成後も4.5:1以上`, () => {
      expect(contrast(token(scope, "--ui-text"), panel)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrast(token(scope, "--ui-muted"), panel),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`${label}: secondary通常・hover地の本文と補助文が実合成後も4.5:1以上`, () => {
      const hover = composite(decoration, 0.14, raised);
      for (const foreground of ["--ui-text", "--ui-muted"]) {
        expect(
          contrast(token(scope, foreground), raised),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(token(scope, foreground), hover),
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${label}: primary補助文82%文字が通常・hover地へ合成後も4.5:1以上`, () => {
      const foreground = token(scope, "--ui-accent-foreground");
      for (const backgroundName of ["--ui-accent", "--ui-accent-hover"]) {
        const background = token(scope, backgroundName);
        expect(
          contrast(composite(foreground, 0.82, background), background),
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${label}: character名色が8% accent card地の実合成後も4.5:1以上`, () => {
      for (const theme of ["red", "blue", "yellow", "green"]) {
        const accent = token(scope, `--character-${theme}`);
        const card = composite(accent, 0.08, raised);
        expect(contrast(accent, card), theme).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
