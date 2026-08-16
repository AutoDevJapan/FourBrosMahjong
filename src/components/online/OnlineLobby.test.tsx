import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OnlineLobby from "./OnlineLobby";

afterEach(() => {
  window.history.replaceState({}, "", "/online");
  window.sessionStorage.clear();
  vi.unstubAllEnvs();
});

describe("OnlineLobby (#605)", () => {
  it("prefills a valid room code from a shared URL", async () => {
    window.history.replaceState({}, "", "/online?room=abc234");

    render(
      <StrictMode>
        <OnlineLobby />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("ルームコード")).toHaveValue("ABC234"),
    );
    expect(screen.getByRole("button", { name: "参加する" })).toBeDisabled();
  });

  it("ignores an invalid room code in a shared URL", async () => {
    window.history.replaceState({}, "", "/online?room=ABC123");

    render(
      <StrictMode>
        <OnlineLobby />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("ルームコード")).toHaveValue(""),
    );
  });
});
