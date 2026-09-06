import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServiceWorkerRegister } from "./ServiceWorkerRegister";

describe("ServiceWorkerRegister", () => {
  it("UIを描画せず、test環境(非production)ではSWを登録しない", () => {
    const register = vi.fn();
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    const { container } = render(<ServiceWorkerRegister />);

    expect(container).toBeEmptyDOMElement();
    // Vitest では NODE_ENV !== "production" のため登録されない
    // (production 分岐の登録挙動は serviceWorkerRegistration.test.ts で検証)。
    expect(register).not.toHaveBeenCalled();

    Reflect.deleteProperty(window.navigator, "serviceWorker");
  });

  it("navigator が利用できないクライアントでも描画を壊さない", () => {
    vi.stubGlobal("navigator", undefined);

    try {
      const { container } = render(<ServiceWorkerRegister />);

      expect(container).toBeEmptyDOMElement();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
