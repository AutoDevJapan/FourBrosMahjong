import { afterEach, describe, expect, it, vi } from "vitest";
import { RULE_ITEM_COUNT, RULE_SECTIONS } from "./rulesContent";

const EXPECTED_ITEM_IDS = [
  "rule-basic-format-sanma",
  "rule-basic-format-rotation",
  "rule-basic-format-hanchan",
  "rule-basic-format-soshii",
  "rule-tiles-and-dora-tile-set",
  "rule-tiles-and-dora-all-red-five",
  "rule-tiles-and-dora-kita",
  "rule-progress-calls",
  "rule-progress-open-tanyao",
  "rule-progress-renchan",
  "rule-progress-honba",
  "rule-progress-four-kans",
  "rule-progress-riichi-sticks",
  "rule-progress-riichi-established",
  "rule-progress-furiten-riichi",
  "rule-progress-chankan",
  "rule-progress-riichi-ankan",
  "rule-scoring-and-dora-no-fu",
  "rule-scoring-and-dora-dice",
  "rule-scoring-and-dora-inflation",
  "rule-settlement-and-soshii-starting-points",
  "rule-settlement-and-soshii-settlement",
  "rule-settlement-and-soshii-uma",
  "rule-settlement-and-soshii-yakuman-bonus",
  "rule-settlement-and-soshii-all-last",
  "rule-settlement-and-soshii-bankruptcy",
  "rule-settlement-and-soshii-chombo",
  "rule-special-elements-introduction",
  "rule-special-elements-24-hours",
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rulesContent", () => {
  it("6セクション・29項目を一意な安定IDで定義する", () => {
    const ids = RULE_SECTIONS.flatMap((section) => [
      section.id,
      ...section.items.map((item) => item.id),
    ]);

    expect(RULE_SECTIONS).toHaveLength(6);
    expect(RULE_ITEM_COUNT).toBe(29);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("rule-"))).toBe(true);
    expect(
      RULE_SECTIONS.flatMap((section) => section.items.map((item) => item.id)),
    ).toEqual(EXPECTED_ITEM_IDS);
  });

  it("三麻の鳴きと#708の人間・CPU・リーチ後北抜を正確に区別する", () => {
    const lines: string[] = [];
    for (const section of RULE_SECTIONS) {
      for (const item of section.items) {
        lines.push(`${item.label ?? ""}${item.body}`);
      }
    }
    const text = lines.join("\n");

    expect(text).toContain("チー不可(三人打ちのためポン・カンのみ)");
    expect(text).toContain("「北抜」を任意に選び");
    expect(text).toContain(
      "北を抜かずに保持したり、通常どおり打牌したりしてもよい",
    );
    expect(text).toContain("CPUは北を自動で抜く");
    expect(text).toContain(
      "リーチ後に北抜できるのは、その手番でツモった北だけ",
    );
    expect(text).toContain("リーチ前から手牌にある北は抜けない");
  });

  it("既存の6見出しと初期開閉契約を維持する", () => {
    expect(
      RULE_SECTIONS.map(({ id, heading, defaultOpen }) => ({
        id,
        heading,
        defaultOpen,
      })),
    ).toEqual([
      { id: "rule-basic-format", heading: "1. 基本形式", defaultOpen: true },
      {
        id: "rule-tiles-and-dora",
        heading: "2. 使用牌・ドラ牌",
        defaultOpen: true,
      },
      { id: "rule-progress", heading: "3. 進行ルール", defaultOpen: false },
      {
        id: "rule-scoring-and-dora",
        heading: "4. 点数・ドラ(サイコロ連動)",
        defaultOpen: true,
      },
      {
        id: "rule-settlement-and-soshii",
        heading: "5. 精算・祝儀(ソシー)",
        defaultOpen: true,
      },
      {
        id: "rule-special-elements",
        heading: "6. 名物要素(ルール外)",
        defaultOpen: false,
      },
    ]);
  });

  it("keeps the settlement constants grouped in the normal locale path", () => {
    const items = RULE_SECTIONS.find(
      (section) => section.id === "rule-settlement-and-soshii",
    )?.items;
    expect(items?.[0]?.body).toBe(
      "1人35,000点持ち(4人合計140,000点)、40,000点返し。",
    );
    expect(items?.[1]?.body).toContain("オカ20,000");
  });

  it("builds the rules content when localized number formatting throws", async () => {
    vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(() => {
      throw new Error("localized number formatting is unavailable");
    });

    vi.resetModules();
    const { RULE_SECTIONS: freshRuleSections } = await import("./rulesContent");
    const items = freshRuleSections.find(
      (section) => section.id === "rule-settlement-and-soshii",
    )?.items;
    expect(items?.[0]?.body).toBe(
      "1人35,000点持ち(4人合計140,000点)、40,000点返し。",
    );
    expect(items?.[1]?.body).toContain("オカ20,000");
  });
});
