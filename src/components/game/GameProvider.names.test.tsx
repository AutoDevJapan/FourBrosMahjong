// @vitest-environment jsdom

/**
 * `/settings` で保存した対局者名が対局へ流れ込むこと(issue #291)の受け入れテスト。
 *
 * 表示名は engine の `EnginePlayer.name` として保持され `selectView` 経由で
 * 盤面・結果画面・読み上げへ渡るため、ここでは view に載る名前で検証する。
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PLAYER_NAMES_STORAGE_KEY } from "@/components/settings/playerNames";
import { DEFAULT_NAMES } from "@/domain/game/engine";
import { GameProvider, useGame } from "./GameProvider";

const SAVED_NAMES = ["自分", "龍二", "下ちゃん", "翔生"] as const;

function storeNames(names: readonly string[]): void {
  window.localStorage.setItem(PLAYER_NAMES_STORAGE_KEY, JSON.stringify(names));
}

/** view 上の全4人の名前(着席3人＋抜け番1人)を出力するプローブ。 */
function NamesProbe() {
  const { view } = useGame();
  const names = (["self", "right", "across", "left"] as const)
    .map((position) => view.slots[position].player.name)
    .join(",");
  return <output data-testid="names">{names}</output>;
}

function renderNames(): string {
  render(
    <GameProvider>
      <NamesProbe />
    </GameProvider>,
  );
  return screen.getByTestId("names").textContent ?? "";
}

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("GameProvider 対局者名の反映 (#291)", () => {
  it("設定済みの名前で対局を開始する", () => {
    storeNames(SAVED_NAMES);

    const names = renderNames();

    for (const name of SAVED_NAMES) {
      expect(names).toContain(name);
    }
  });

  it("名前未設定(初回)は既定名で従来どおり動作する", () => {
    const names = renderNames();

    for (const name of DEFAULT_NAMES) {
      expect(names).toContain(name);
    }
  });

  it("リロード(ジャーナル再生)後も同じ名前で復元する", () => {
    storeNames(SAVED_NAMES);
    const before = renderNames();

    // リロード相当: DOM を破棄して再描画する(sessionStorage のジャーナルは残る)。
    // 途中で localStorage の設定を変えても、進行中の半荘はジャーナルに固定された名前で復元される。
    cleanup();
    storeNames(["別人1", "別人2", "別人3", "別人4"]);
    const after = renderNames();

    expect(after).toBe(before);
    expect(after).not.toContain("別人1");
  });

  it("12書記素目が絵文字の名前を保存し、リロード後の盤面にも復元する(#484)", () => {
    const unicodeName = "12345678901😀";
    storeNames([unicodeName, "B", "C", "D"]);

    expect(renderNames()).toContain(unicodeName);

    // リロード相当。設定を差し替えることで、2回目の描画が localStorage の読み直しではなく
    // sessionStorage のジャーナル復元を通っていることを確定させる。
    cleanup();
    storeNames(["別人1", "別人2", "別人3", "別人4"]);
    const after = renderNames();

    expect(after).toContain(unicodeName);
    expect(after).not.toContain("別人1");
  });
});
