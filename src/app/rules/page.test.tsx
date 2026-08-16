import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  OKA,
  RETURN_POINTS,
  STARTING_POINTS,
} from "@/domain/scoring/settlement";
import RulesPage from "./page";

/**
 * `/rules`(ルール説明)ページのスモークテスト。
 *
 * Server Component だが同期に JSX を返すだけなので、jsdom プロジェクトで
 * そのままレンダリングできる。ここでは受け入れ基準に対応する骨格
 * (見出し・主要ルール項目・ロビーへの戻り導線)が描画されることを検証する。
 */
describe("RulesPage (/rules)", () => {
  it("見出しと主要ルール項目を描画する", () => {
    render(<RulesPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "ルール説明" }),
    ).toBeInTheDocument();

    // 独自ルールの要点が本文に含まれること(色非依存のテキスト情報)。
    // 要約の性質上、これらの語は複数箇所に登場しうるため getAllByText を使う。
    expect(screen.getAllByText(/オール赤5/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ガリ\(北抜きドラ\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/サイコロ連動/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/四槓散了/).length).toBeGreaterThan(0);
  });

  it("確定済みの独自仕様4項目を記載する(#283)", () => {
    render(<RulesPage />);

    // 1. リーチ宣言牌ロン時のリーチ不成立・供託なし
    // (docs/四兄弟麻雀ルール.md / documents/spec/game-flow.md 準拠)
    expect(
      screen.getByText(
        /宣言牌がロンされた場合はリーチ不成立となり、1,000点は供託しない/,
      ),
    ).toBeInTheDocument();

    // 2. 槍槓あり(国士無双テンパイ他家に限り暗槓槍槓可)
    expect(screen.getAllByText(/槍槓/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        /国士無双テンパイの他家に限り、暗槓に対しても槍槓ロンできる/,
      ),
    ).toBeInTheDocument();

    // 3. リーチ後の暗槓(条件付き許可)
    expect(
      screen.getByText(/送り槓・七対子テンパイでの暗槓は不可/),
    ).toBeInTheDocument();

    // 4. トビ(持ち点マイナスで半荘即終了)
    expect(
      screen.getByText(
        /いずれかのプレイヤーの持ち点がマイナスに達した時点で半荘は即終了/,
      ),
    ).toBeInTheDocument();
  });

  it("折りたたみセクションを details/summary で提供する", () => {
    const { container } = render(<RulesPage />);
    const sections = container.querySelectorAll("details");
    expect(sections.length).toBeGreaterThan(0);
    // 各 details には開閉トリガ(summary)がある。
    for (const section of sections) {
      expect(section.querySelector("summary")).not.toBeNull();
    }
  });

  it("目次から安定したセクションIDへ移動できる", () => {
    render(<RulesPage />);

    const toc = screen.getByRole("navigation", { name: "ルールの目次" });
    const entries = [
      ["rule-basic-format", "1. 基本形式"],
      ["rule-tiles-and-dora", "2. 使用牌・ドラ牌"],
      ["rule-progress", "3. 進行ルール"],
      ["rule-scoring-and-dora", "4. 点数・ドラ(サイコロ連動)"],
      ["rule-settlement-and-soshii", "5. 精算・祝儀(ソシー)"],
      ["rule-special-elements", "6. 名物要素(ルール外)"],
    ] as const;

    expect(within(toc).getAllByRole("link")).toHaveLength(entries.length);
    for (const [id, heading] of entries) {
      const link = within(toc).getByRole("link", { name: heading });
      expect(link).toHaveAttribute("href", `#${id}`);
      expect(document.getElementById(id)).not.toBeNull();
      expect(document.getElementById(id)).toHaveAttribute("id", id);
    }
  });

  it("初期開閉状態を維持しつつ各summaryを提供する", () => {
    const { container } = render(<RulesPage />);
    const sections = [
      ...container.querySelectorAll<HTMLDetailsElement>("details[id^='rule-']"),
    ];

    expect(sections.filter((section) => section.open)).toHaveLength(4);
    expect(sections.filter((section) => !section.open)).toHaveLength(2);
    for (const section of sections) {
      const summary = section.querySelector("summary");
      expect(summary).not.toBeNull();
      expect(summary).toHaveAttribute("id", `${section.id}-summary`);
    }
  });

  it("実装定数と一致する配給原点・返し・オカとソシー精算を説明する(#196)", () => {
    render(<RulesPage />);

    expect(
      screen.getByText(
        `1人${STARTING_POINTS.toLocaleString("ja-JP")}点持ち(4人合計${(STARTING_POINTS * 4).toLocaleString("ja-JP")}点)、${RETURN_POINTS.toLocaleString("ja-JP")}点返し。`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(
          `素点に順位ウマを加え、1位にはオカ${OKA.toLocaleString("ja-JP")}を加算`,
        ),
      ),
    ).toBeInTheDocument();
  });

  it("ロビー(/)へ戻る導線を持つ", () => {
    render(<RulesPage />);
    const backLinks = screen.getAllByRole("link", { name: /ロビーへ戻る/ });
    expect(backLinks.length).toBeGreaterThan(0);
    for (const link of backLinks) {
      expect(link).toHaveAttribute("href", "/");
    }
  });
});
