import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NotFound, { metadata } from "./not-found";

describe("not-found", () => {
  it("日本語の説明とロビー・ルールへの復帰導線を表示する", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { name: "ページが見つかりません" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ロビーへ戻る" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "ルールを見る" })).toHaveAttribute(
      "href",
      "/rules",
    );
    expect(metadata.title).toBe("ページが見つかりません");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("404自身はcanonical・OGP・Twitter metadataを追加しない", () => {
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.twitter).toBeUndefined();
  });
});
