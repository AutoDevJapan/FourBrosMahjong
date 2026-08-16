import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import OnlineLobby from "./OnlineLobby";

describe("OnlineLobby の参加条件", () => {
  it("初期状態でも入力条件とdisabled理由をアクセシブルに説明する", () => {
    render(<OnlineLobby />);

    const nameInput = screen.getByRole("textbox", { name: "表示名" });
    const roomCodeInput = screen.getByRole("textbox", { name: "ルームコード" });
    const createButton = screen.getByRole("button", {
      name: "新しいルームを作る",
    });
    const joinButton = screen.getByRole("button", { name: "参加する" });

    expect(nameInput).toBeRequired();
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput).toHaveAccessibleDescription(
      /参加には表示名が必要です。表示名を入力してください/,
    );
    expect(roomCodeInput).toBeRequired();
    expect(roomCodeInput).toHaveAttribute("aria-invalid", "true");
    expect(roomCodeInput).toHaveAccessibleDescription(
      /6文字のルームコードが必要です/,
    );

    expect(createButton).toBeDisabled();
    expect(joinButton).toBeDisabled();
    expect(joinButton).toHaveAccessibleDescription(
      /表示名を入力してください。.*6文字のルームコードが必要です/,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /表示名を入力してください。.*参加には6文字のルームコードが必要です。.*ルームコードを入力してください。/,
    );
  });

  it("空・短い・不正文字・有効なルームコードを順に検証する", async () => {
    const user = userEvent.setup();
    render(<OnlineLobby />);

    const nameInput = screen.getByRole("textbox", { name: "表示名" });
    const roomCodeInput = screen.getByRole("textbox", { name: "ルームコード" });
    const createButton = screen.getByRole("button", {
      name: "新しいルームを作る",
    });
    const joinButton = screen.getByRole("button", { name: "参加する" });

    expect(roomCodeInput).toHaveAccessibleDescription(
      /参加には6文字のルームコードが必要です。ルームコードを入力してください。/,
    );
    expect(roomCodeInput).toHaveAttribute("aria-invalid", "true");
    expect(joinButton).toBeDisabled();

    await user.type(nameInput, "たろう");
    expect(createButton).toBeEnabled();

    await user.type(roomCodeInput, "ABC23");
    expect(joinButton).toBeDisabled();
    expect(roomCodeInput).toHaveAttribute("aria-invalid", "true");
    expect(roomCodeInput).toHaveAccessibleDescription(
      /ルームコードは6文字必要です。あと1文字入力してください。/,
    );

    await user.clear(roomCodeInput);
    await user.type(roomCodeInput, "ABC!");
    expect(joinButton).toBeDisabled();
    expect(roomCodeInput).toHaveAttribute("aria-invalid", "true");
    expect(roomCodeInput).toHaveAccessibleDescription(
      /英大文字と2〜9の数字を使った6文字で入力してください。.*あと2文字入力してください。/,
    );
    expect(joinButton).toHaveAccessibleDescription(
      /英大文字と2〜9の数字を使った6文字で入力してください。.*あと2文字入力してください。/,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /英大文字と2〜9の数字を使った6文字で入力してください。.*あと2文字入力してください。/,
    );

    await user.clear(roomCodeInput);
    await user.type(roomCodeInput, "ABC!@#");
    expect(joinButton).toBeDisabled();
    expect(roomCodeInput).toHaveAttribute("aria-invalid", "true");
    expect(roomCodeInput).toHaveAccessibleDescription(
      /英大文字と2〜9の数字を使った6文字で入力してください。/,
    );

    await user.clear(roomCodeInput);
    await user.type(roomCodeInput, "ABC234");
    expect(roomCodeInput).toHaveAttribute("aria-invalid", "false");
    expect(roomCodeInput).toHaveAccessibleDescription(
      /ルームコードは6文字入力されています。/,
    );
    expect(joinButton).toBeEnabled();
    expect(joinButton).toHaveAccessibleDescription(
      /参加条件を満たしています。参加できます。/,
    );
  });
});
