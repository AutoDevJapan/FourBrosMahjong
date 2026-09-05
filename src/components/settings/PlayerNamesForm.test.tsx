import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_NAMES } from "@/domain/game/engine";
import { PlayerNamesForm } from "./PlayerNamesForm";
import {
  loadPlayerNames,
  MAX_PLAYER_NAME_CODE_UNITS,
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

    expect(inputFor("粗悪品（あなた）")).toHaveValue(DEFAULT_NAMES[0]);
    expect(inputFor("竜二")).toHaveValue(DEFAULT_NAMES[1]);
  });

  it("保存済みの名前をマウント後に読み込んで表示する", () => {
    window.localStorage.setItem(
      PLAYER_NAMES_STORAGE_KEY,
      JSON.stringify(["自分", "龍二", "下ちゃん", "翔生"]),
    );

    render(<PlayerNamesForm />);

    expect(inputFor("粗悪品（あなた）")).toHaveValue("自分");
    expect(inputFor("糸瓜")).toHaveValue("翔生");
  });

  it("入力した名前をlocalStorageへ保存し、完了を通知する", async () => {
    const user = userEvent.setup();
    render(<PlayerNamesForm />);

    const input = inputFor("竜二");
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

    const input = inputFor("マサキ");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "名前を保存" }));

    expect(inputFor("マサキ")).toHaveValue(DEFAULT_NAMES[2]);
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

    expect(inputFor("粗悪品（あなた）")).toHaveValue(DEFAULT_NAMES[0]);
    expect(loadPlayerNames(window.localStorage)).toEqual(DEFAULT_NAMES);
  });

  it("入力欄は上限文字数を超えて入力できない", async () => {
    const user = userEvent.setup();
    render(<PlayerNamesForm />);

    const input = inputFor("竜二");
    await user.clear(input);
    await user.type(input, "あ".repeat(MAX_PLAYER_NAME_LENGTH + 5));

    expect(input.value).toHaveLength(MAX_PLAYER_NAME_LENGTH);
  });

  it("入力欄も保存処理と同じ書記素単位で絵文字を制限する(#484)", async () => {
    const user = userEvent.setup();
    render(<PlayerNamesForm />);
    const input = inputFor("竜二");
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
    const input = inputFor("竜二");
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

  it("IME変換中の巨大な候補をcode unit上限内に保持する(#878)", () => {
    render(<PlayerNamesForm />);
    const input = inputFor("竜二");
    const huge = "あ".repeat(MAX_PLAYER_NAME_CODE_UNITS + 100_000);

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: huge } });

    expect(input).toHaveValue("あ".repeat(MAX_PLAYER_NAME_CODE_UNITS));
    expect(input.value.length).toBeLessThanOrEqual(MAX_PLAYER_NAME_CODE_UNITS);
  });

  it("変換中でも他の入力欄には上限が効く(#484)", () => {
    render(<PlayerNamesForm />);
    const composingInput = inputFor("竜二");
    const otherInput = inputFor("マサキ");
    const tooLong = "あ".repeat(MAX_PLAYER_NAME_LENGTH + 3);

    // 竜二欄を変換中のままマサキ欄へ入力しても、上限が外れてはいけない。
    fireEvent.compositionStart(composingInput);
    fireEvent.change(composingInput, { target: { value: tooLong } });
    fireEvent.change(otherInput, { target: { value: tooLong } });

    expect(composingInput).toHaveValue(tooLong);
    expect(otherInput.value).toHaveLength(MAX_PLAYER_NAME_LENGTH);
  });

  it.each(["compositionend", "blur"])(
    "別欄から遅れて届いた%sで新しいIMEの上限を解除しない",
    (eventType) => {
      render(<PlayerNamesForm />);
      const oldInput = inputFor("竜二");
      const currentInput = inputFor("マサキ");
      const tooLong = "あ".repeat(MAX_PLAYER_NAME_LENGTH + 3);

      fireEvent.compositionStart(oldInput);
      fireEvent.change(oldInput, { target: { value: tooLong } });
      fireEvent.compositionStart(currentInput);
      fireEvent.change(currentInput, { target: { value: tooLong } });

      // フォーカス移動に伴う古い欄の終了イベントが、新しい欄の変換中に届くケース。
      if (eventType === "compositionend") {
        fireEvent.compositionEnd(oldInput, { target: { value: tooLong } });
      } else {
        fireEvent.blur(oldInput);
      }
      fireEvent.change(currentInput, { target: { value: tooLong } });

      expect(oldInput.value).toHaveLength(MAX_PLAYER_NAME_LENGTH);
      expect(currentInput).toHaveValue(tooLong);
    },
  );

  it("compositionEndが来なくてもフォーカスアウトで上限が復帰する(#484)", () => {
    render(<PlayerNamesForm />);
    const input = inputFor("竜二");
    const tooLong = "あ".repeat(MAX_PLAYER_NAME_LENGTH + 3);

    // 一部のAndroid IMEは compositionend を発火しない。blur で確定扱いにする。
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: tooLong } });
    fireEvent.blur(input);

    expect(input.value).toHaveLength(MAX_PLAYER_NAME_LENGTH);
  });

  it("変換確定後に上限を超えた文字列は切り詰める(#484)", () => {
    render(<PlayerNamesForm />);
    const input = inputFor("竜二");
    const tooLong = "あ".repeat(MAX_PLAYER_NAME_LENGTH + 3);

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: tooLong } });
    fireEvent.compositionEnd(input, { target: { value: tooLong } });

    expect(input.value).toHaveLength(MAX_PLAYER_NAME_LENGTH);
  });

  it("グループと各入力がアクセシブルな名前を持つ(スペック5 5.2)", () => {
    render(<PlayerNamesForm />);

    expect(
      screen.getByRole("group", { name: /四兄弟の名前/ }),
    ).toBeInTheDocument();
    for (const label of ["粗悪品（あなた）", "竜二", "マサキ", "糸瓜"]) {
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(
        /空欄のまま保存すると既定名/,
      );
    }
  });

  it("同じ表示名を4人に保存できる", async () => {
    const user = userEvent.setup();
    render(<PlayerNamesForm />);

    for (const label of ["粗悪品（あなた）", "竜二", "マサキ", "糸瓜"]) {
      await user.clear(inputFor(label));
      await user.type(inputFor(label), "同名");
    }
    await user.click(screen.getByRole("button", { name: "名前を保存" }));

    expect(loadPlayerNames(window.localStorage)).toEqual([
      "同名",
      "同名",
      "同名",
      "同名",
    ]);
  });

  it("別タブの保存をstorageイベントで入力欄へ反映する", async () => {
    render(<PlayerNamesForm />);
    const names = ["A", "B", "C", "D"];
    window.localStorage.setItem(
      PLAYER_NAMES_STORAGE_KEY,
      JSON.stringify(names),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: PLAYER_NAMES_STORAGE_KEY,
        newValue: JSON.stringify(names),
      }),
    );

    await waitFor(() => expect(inputFor("粗悪品（あなた）")).toHaveValue("A"));
    expect(inputFor("糸瓜")).toHaveValue("D");
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
