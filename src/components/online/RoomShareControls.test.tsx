import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import RoomShareControls from "./RoomShareControls";

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const originalShare = Object.getOwnPropertyDescriptor(navigator, "share");

function renderControls() {
  return render(
    <RoomShareControls
      code="ABC234"
      shareUrl="https://mahjong.example/online?room=ABC234"
      statusMessage="コードを共有して同じ卓に参加"
    />,
  );
}

function setNavigatorProperty(
  name: "clipboard" | "share",
  value: unknown,
): void {
  Object.defineProperty(navigator, name, {
    configurable: true,
    value,
  });
}

function setThrowingShareGetter(): void {
  Object.defineProperty(navigator, "share", {
    configurable: true,
    get() {
      throw new Error("Web Share capability is unreadable");
    },
  });
}

function restoreNavigatorProperty(
  name: "clipboard" | "share",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(navigator, name, descriptor);
  } else {
    Reflect.deleteProperty(navigator, name);
  }
}

beforeAll(() => {
  // jsdom has no Web Share implementation, so each test explicitly chooses the
  // supported/unsupported branch below.
  restoreNavigatorProperty("clipboard", originalClipboard);
  restoreNavigatorProperty("share", originalShare);
});

afterEach(() => {
  restoreNavigatorProperty("clipboard", originalClipboard);
  restoreNavigatorProperty("share", originalShare);
  vi.restoreAllMocks();
});

describe("RoomShareControls (#605)", () => {
  it("shows an explicit copy button and announces successful clipboard copy", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorProperty("clipboard", { writeText });

    renderControls();

    const group = screen.getByRole("group", { name: "ルームコード" });
    const copyButton = screen.getByRole("button", { name: "コードをコピー" });
    expect(copyButton).toHaveAttribute(
      "aria-describedby",
      "online-room-code-hint",
    );
    expect(group).toContainElement(copyButton);

    copyButton.focus();
    expect(copyButton).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(writeText).toHaveBeenCalledWith("ABC234");
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("ルームコードをコピーしました。");
    expect(screen.queryByLabelText("共有URL")).not.toBeInTheDocument();
  });

  it("shows a manual URL when Clipboard API is unavailable", async () => {
    const user = userEvent.setup();
    setNavigatorProperty("clipboard", undefined);
    renderControls();

    await user.click(screen.getByRole("button", { name: "コードをコピー" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("コピーできませんでした");
    const shareUrl = screen.getByLabelText("共有URL");
    expect(shareUrl).toHaveValue("https://mahjong.example/online?room=ABC234");

    await user.click(screen.getByRole("button", { name: "URLを選択" }));
    expect(shareUrl).toHaveFocus();
  });

  it("announces clipboard failures and keeps the manual fallback available", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Not allowed"));
    const user = userEvent.setup();
    setNavigatorProperty("clipboard", { writeText });
    renderControls();

    await user.click(screen.getByRole("button", { name: "コードをコピー" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("コピーできませんでした");
    expect(screen.getByLabelText("共有URL")).toBeInTheDocument();
    expect(
      screen.getByText(/コード「ABC234」を手動で伝えてください/),
    ).toBeInTheDocument();
  });

  it("uses Web Share API and announces successful sharing", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    setNavigatorProperty("share", share);
    renderControls();

    await user.click(screen.getByRole("button", { name: "共有" }));

    expect(share).toHaveBeenCalledWith({
      title: "四兄弟麻雀のルーム",
      text: "ルームコード: ABC234",
      url: "https://mahjong.example/online?room=ABC234",
    });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("共有シートを開きました。");
  });

  it("shows a manual URL when Web Share API rejects", async () => {
    const share = vi.fn().mockRejectedValue(new Error("Not allowed"));
    const user = userEvent.setup();
    setNavigatorProperty("share", share);
    renderControls();

    await user.click(screen.getByRole("button", { name: "共有" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("共有できませんでした");
    expect(screen.getByLabelText("共有URL")).toHaveValue(
      "https://mahjong.example/online?room=ABC234",
    );
  });

  it("shows a manual URL when Web Share API is unavailable", async () => {
    const user = userEvent.setup();
    setNavigatorProperty("share", undefined);
    renderControls();

    await user.click(screen.getByRole("button", { name: "共有" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("共有機能を利用できません");
    expect(screen.getByLabelText("共有URL")).toHaveValue(
      "https://mahjong.example/online?room=ABC234",
    );
  });

  it("shows a manual URL when Web Share capability discovery throws", async () => {
    const user = userEvent.setup();
    setThrowingShareGetter();
    renderControls();

    await user.click(screen.getByRole("button", { name: "共有" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("共有機能を利用できません");
    expect(screen.getByLabelText("共有URL")).toHaveValue(
      "https://mahjong.example/online?room=ABC234",
    );
  });
});
