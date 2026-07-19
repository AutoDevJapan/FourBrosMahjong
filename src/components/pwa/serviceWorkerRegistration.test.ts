import { describe, expect, it, vi } from "vitest";
import {
  registerServiceWorker,
  SERVICE_WORKER_URL,
} from "./serviceWorkerRegistration";

function navigatorWithServiceWorker(register = vi.fn().mockResolvedValue({})) {
  return {
    nav: { serviceWorker: { register } } as unknown as Navigator,
    register,
  };
}

describe("registerServiceWorker", () => {
  it("productionでは /sw.js を登録する", () => {
    const { nav, register } = navigatorWithServiceWorker();

    expect(registerServiceWorker("production", nav)).toBe(true);
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL);
    expect(SERVICE_WORKER_URL).toBe("/sw.js");
  });

  it("development / test では登録しない(devキャッシュ汚染の防止)", () => {
    const { nav, register } = navigatorWithServiceWorker();

    expect(registerServiceWorker("development", nav)).toBe(false);
    expect(registerServiceWorker("test", nav)).toBe(false);
    expect(registerServiceWorker(undefined, nav)).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it("serviceWorker非対応ブラウザでは何もしない", () => {
    expect(
      registerServiceWorker("production", {} as unknown as Navigator),
    ).toBe(false);
    expect(registerServiceWorker("production", undefined)).toBe(false);
  });

  it("登録失敗(register reject)でも例外を漏らさない", async () => {
    const register = vi.fn().mockRejectedValue(new Error("SecurityError"));
    const { nav } = navigatorWithServiceWorker(register);

    expect(registerServiceWorker("production", nav)).toBe(true);
    // reject が未処理例外として伝播しないことを確認する。
    await vi.waitFor(() => expect(register).toHaveBeenCalled());
  });
});
