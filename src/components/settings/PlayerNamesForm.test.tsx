import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_NAMES } from "@/domain/game/engine";
import { PlayerNamesForm } from "./PlayerNamesForm";
import {
  loadPlayerNames,
  MAX_PLAYER_NAME_LENGTH,
  PLAYER_NAMES_STORAGE_KEY,
} from "./playerNames";

afterEach(() => {
  window.localStorage.clear();
});

function inputFor(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe("PlayerNamesForm", () => {
  it("未設定時は既定名を初期表示する(後方互換)", () => {
    render(<PlayerNamesForm />);

    expect(inputFor("あなた(自家)")).toHaveValue(DEFAULT_NAMES[0]);
    expect(inputFor("対局者2")).toHaveValue(DEFAULT_NAMES[1]);
  });

  it("保存済みの名前をマウント後に読み込んで表示する", () => {
    window.localStorage.setItem(
      PLAYER_NAMES_STORAGE_KEY,
      JSON.stringify(["自分", "龍二", "下ちゃん", "翔生"]),
    );

    render(<PlayerNamesForm />);

    expect(inputFor("あなた(自家)")).toHaveValue("自分");
    expect(inputFor("対局者4")).toHaveValue("翔生");
  });

  it("入力した名前をlocalStorageへ保存し、完了を通知する", async () => {
    const user = userEvent.setup();
    render(<PlayerNamesForm />);

    const input = inputFor("対局者2");
    await user.clear(input);
    await user.type(input, "龍二");
    await user.click(screen.getByRole("button", { name: "名前を保存" }));

    expect(loadPlayerNames(window.localStorage)).toEqual([
      DEFAULT_NAMES[0],
      "龍二",
      DEFAULT_NAMES[2],
      DEFAULT_NAMES[3],
    ]);
    expect(
      screen.getByText(/保存しました。次の半荘から反映されます。/),
    ).toBeInTheDocument();
  });

  it("空欄のまま保存すると既定名へ戻り、入力欄にも反映される", async () => {
    const user = userEvent.setup();
    render(<PlayerNamesForm />);

    const input = inputFor("対局者3");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "名前を保存" }));

    expect(inputFor("対局者3")).toHaveValue(DEFAULT_NAMES[2]);
    expect(loadPlayerNames(window.localStorage)).toEqual(DEFAULT_NAMES);
  });

  it("「既定名に戻す」で全員を既定名へ戻して保存する", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      PLAYER_NAMES_STORAGE_KEY,
      JSON.stringify(["自分", "龍二", "下ちゃん", "翔生"]),
    );
    render(<PlayerNamesForm />);

    await user.click(screen.getByRole("button", { name: "既定名に戻す" }));

    expect(inputFor("あなた(自家)")).toHaveValue(DEFAULT_NAMES[0]);
    expect(loadPlayerNames(window.localStorage)).toEqual(DEFAULT_NAMES);
  });

  it("入力欄は上限文字数を超えて入力できない", async () => {
    const user = userEvent.setup();
    render(<PlayerNamesForm />);

    const input = inputFor("対局者2");
    await user.clear(input);
    await user.type(input, "あ".repeat(MAX_PLAYER_NAME_LENGTH + 5));

    expect(input.value).toHaveLength(MAX_PLAYER_NAME_LENGTH);
  });

  it("入力欄も保存処理と同じ書記素単位で絵文字を制限する(#484)", async () => {
    const user = userEvent.setup();
    render(<PlayerNamesForm />);
    const input = inputFor("対局者2");
    const withinLimit = `${"あ".repeat(11)}😀`;

    // 貼り付けで検証する。`fireEvent.change` はネイティブの `maxlength` を素通しするため、
    // 上限がJS側で効いていることの証拠にならない。
    await user.clear(input);
    await user.click(input);
    await user.paste(`${withinLimit}超過`);

    expect(input).toHaveValue(withinLimit);
    expect(input.value).not.toMatch(/[\uD800-\uDFFF]/u);
  });

  it("IME変換中は上限で切り詰めず、確定時に適用する(#484)", () => {
    render(<PlayerNamesForm />);
    const input = inputFor("対局者2");
    // 確定後は8書記素でも、読みは13書記素ある。変換中に切り詰めると変換が壊れる。
    const reading = "にほんごにゅうりょくてすと";
    const converted = "日本語入力テスト";

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: reading } });
    expect(input, "変換中は読みをそのまま保持する").toHaveValue(reading);

    fireEvent.change(input, { target: { value: converted } });
    fireEvent.compositionEnd(input, { target: { value: converted } });
    expect(input).toHaveValue(converted);
  });

  it("変換中でも他の入力欄には上限が効く(#484)", () => {
    render(<PlayerNamesForm />);
    const composingInput = inputFor("対局者2");
    const otherInput = inputFor("対局者3");
    const tooLong = "あ".repeat(MAX_PLAYER_NAME_LENGTH + 3);

    // 「対局者2」を変換中のまま「対局者3」へ入力しても、上限が外れてはいけない。
    fireEvent.compositionStart(composingInput);
    fireEvent.change(composingInput, { target: { value: tooLong } });
    fireEvent.change(otherInput, { target: { value: tooLong } });

    expect(composingInput).toHaveValue(tooLong);
    expect(otherInput.value).toHaveLength(MAX_PLAYER_NAME_LENGTH);
  });

  it("compositionEndが来なくてもフォーカスアウトで上限が復帰する(#484)", () => {
    render(<PlayerNamesForm />);
    const input = inputFor("対局者2");
    const tooLong = "あ".repeat(MAX_PLAYER_NAME_LENGTH + 3);

    // 一部のAndroid IMEは compositionend を発火しない。blur で確定扱いにする。
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: tooLong } });
    fireEvent.blur(input);

    expect(input.value).toHaveLength(MAX_PLAYER_NAME_LENGTH);
  });

  it("変換確定後に上限を超えた文字列は切り詰める(#484)", () => {
    render(<PlayerNamesForm />);
    const input = inputFor("対局者2");
    const tooLong = "あ".repeat(MAX_PLAYER_NAME_LENGTH + 3);

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: tooLong } });
    fireEvent.compositionEnd(input, { target: { value: tooLong } });

    expect(input.value).toHaveLength(MAX_PLAYER_NAME_LENGTH);
  });

  it("グループと各入力がアクセシブルな名前を持つ(スペック5 5.2)", () => {
    render(<PlayerNamesForm />);

    expect(
      screen.getByRole("group", { name: /対局者の名前/ }),
    ).toBeInTheDocument();
    for (const label of ["あなた(自家)", "対局者2", "対局者3", "対局者4"]) {
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(
        /空欄のまま保存すると既定名/,
      );
    }
  });

  it("localStorageが使えない環境では保存失敗を色に依存せず通知する", async () => {
    const user = userEvent.setup();
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage is disabled", "SecurityError");
      },
    });

    try {
      render(<PlayerNamesForm />);
      await user.click(screen.getByRole("button", { name: "名前を保存" }));

      expect(screen.getByText(/保存できませんでした/)).toBeInTheDocument();
    } finally {
      if (descriptor) {
        Object.defineProperty(window, "localStorage", descriptor);
      }
    }
  });
});
