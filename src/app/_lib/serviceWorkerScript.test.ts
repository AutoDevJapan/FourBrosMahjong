/**
 * 生成された service worker スクリプトの挙動検証(issue #292)。
 *
 * 偽の ServiceWorkerGlobalScope(`self`)を注入してスクリプトを評価し、
 * install / activate / fetch ハンドラの実挙動(プリキャッシュ・旧キャッシュ破棄・
 * network-first / cache-first・オフラインフォールバック)をユニットテストする。
 *
 * 注: 偽 Cache は URL 文字列キーの単純な Map(実ブラウザの Vary 対応等は簡略化)。
 * `Request` の `mode: "navigate"` はコンストラクタで作れないため、リクエストは
 * 最小限のプレーンオブジェクトで表現する。
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildServiceWorkerScript,
  PRECACHE_ASSETS,
  PRECACHE_ROUTES,
  resolveServiceWorkerVersion,
} from "./serviceWorkerScript";

const ORIGIN = "https://example.com";

interface FakeRequest {
  readonly method: string;
  readonly url: string;
  readonly mode: string;
}

function request(
  path: string,
  { method = "GET", mode = "no-cors", origin = ORIGIN } = {},
): FakeRequest {
  return { method, url: `${origin}${path}`, mode };
}

function toKey(target: FakeRequest | string): string {
  return typeof target === "string"
    ? new URL(target, ORIGIN).href
    : new URL(target.url).href;
}

class FakeCache {
  readonly store = new Map<string, Response>();

  constructor(private readonly fetchImpl: () => typeof fetch) {}

  async addAll(urls: string[]): Promise<void> {
    for (const url of urls) {
      const response = await this.fetchImpl()(toKey(url));
      if (!response.ok) {
        throw new TypeError(`addAll failed: ${url}`);
      }
      this.store.set(toKey(url), response);
    }
  }

  async put(target: FakeRequest | string, response: Response): Promise<void> {
    this.store.set(toKey(target), response);
  }

  async match(target: FakeRequest | string): Promise<Response | undefined> {
    return this.store.get(toKey(target));
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();

  constructor(private readonly fetchImpl: () => typeof fetch) {}

  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache(this.fetchImpl);
      this.caches.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  async match(target: FakeRequest | string): Promise<Response | undefined> {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(target);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }
}

interface FetchEvent {
  request: FakeRequest;
  respondWith: ReturnType<typeof vi.fn>;
}

/** スクリプトを偽グローバルで評価し、登録されたイベントハンドラを収集する。 */
function bootServiceWorker({ version = "v1" } = {}) {
  let fetchImpl: typeof fetch = vi.fn(async () => new Response("ok"));
  const cacheStorage = new FakeCacheStorage(() => fetchImpl);
  const listeners = new Map<string, (event: unknown) => void>();
  const scope = {
    location: new URL(`${ORIGIN}/`),
    caches: cacheStorage,
    fetch: (...args: Parameters<typeof fetch>) => fetchImpl(...args),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    },
  };
  new Function("self", buildServiceWorkerScript(version))(scope);

  const dispatchLifecycle = async (type: "install" | "activate") => {
    let waited: Promise<unknown> | undefined;
    listeners.get(type)?.({
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise;
      },
    });
    await waited;
  };

  const dispatchFetch = async (req: FakeRequest): Promise<FetchEvent> => {
    const event: FetchEvent = { request: req, respondWith: vi.fn() };
    listeners.get("fetch")?.(event);
    // respondWith に渡された Promise の解決を待つ(未呼び出しなら何もしない)。
    await event.respondWith.mock.calls[0]?.[0];
    return event;
  };

  const setFetchImpl = (impl: typeof fetch) => {
    fetchImpl = impl;
  };

  return {
    scope,
    cacheStorage,
    dispatchLifecycle,
    dispatchFetch,
    setFetchImpl,
  };
}

const OFFLINE: typeof fetch = () =>
  Promise.reject(new TypeError("net::ERR_INTERNET_DISCONNECTED"));

describe("resolveServiceWorkerVersion", () => {
  it("VercelビルドではコミットSHA先頭12桁を使う", () => {
    expect(
      resolveServiceWorkerVersion({
        VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
      }),
    ).toBe("0123456789ab");
  });

  it("SHAが無いローカルビルドではビルド時刻ベースの一意な版になる", () => {
    const version = resolveServiceWorkerVersion({}, () => 1_234_567_890_123);
    expect(version).toBe(`local-${(1_234_567_890_123).toString(36)}`);
  });
});

describe("buildServiceWorkerScript", () => {
  it("versionをJSONエスケープして埋め込み、全ルートと牌素材をプリキャッシュ対象に含む", () => {
    const script = buildServiceWorkerScript('v"1\\');
    expect(script).toContain(JSON.stringify('v"1\\'));
    for (const url of [...PRECACHE_ROUTES, ...PRECACHE_ASSETS]) {
      expect(script).toContain(JSON.stringify(url).slice(1, -1));
    }
    expect(PRECACHE_ROUTES).toEqual([
      "/",
      "/rules",
      "/settings",
      "/game",
      "/game/result",
    ]);
    expect(PRECACHE_ASSETS).toContain("/tiles/Pin5-Dora.svg");
    expect(PRECACHE_ASSETS).toContain("/tiles/Back.svg");
    expect(PRECACHE_ASSETS).toContain("/manifest.webmanifest");
  });

  it("installで全URLをプリキャッシュしskipWaitingする", async () => {
    const sw = bootServiceWorker();
    await sw.dispatchLifecycle("install");

    const precache = sw.cacheStorage.caches.get("fbm-precache-v1");
    expect(precache).toBeDefined();
    expect(precache?.store.size).toBe(
      PRECACHE_ROUTES.length + PRECACHE_ASSETS.length,
    );
    expect(precache?.store.has(`${ORIGIN}/game`)).toBe(true);
    expect(sw.scope.skipWaiting).toHaveBeenCalled();
  });

  it("activateで旧fbm-*キャッシュのみ破棄し、他名前空間は残してclients.claimする", async () => {
    const sw = bootServiceWorker();
    await sw.cacheStorage.open("fbm-precache-old");
    await sw.cacheStorage.open("fbm-runtime-old");
    await sw.cacheStorage.open("unrelated-cache");
    await sw.dispatchLifecycle("install");
    await sw.dispatchLifecycle("activate");

    const remaining = await sw.cacheStorage.keys();
    expect(remaining).not.toContain("fbm-precache-old");
    expect(remaining).not.toContain("fbm-runtime-old");
    expect(remaining).toContain("unrelated-cache");
    expect(remaining).toContain("fbm-precache-v1");
    expect(sw.scope.clients.claim).toHaveBeenCalled();
  });

  it("ナビゲーションはnetwork-first: オンライン時は最新を返しつつキャッシュへ退避する", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(vi.fn(async () => new Response("fresh-shell")));

    const event = await sw.dispatchFetch(
      request("/game", { mode: "navigate" }),
    );

    const response: Response = await event.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe("fresh-shell");
    const runtime = sw.cacheStorage.caches.get("fbm-runtime-v1");
    expect(runtime?.store.has(`${ORIGIN}/game`)).toBe(true);
  });

  it("オフラインのナビゲーションはプリキャッシュ済みHTMLで応答する(#292回帰防止)", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi.fn(async (input) => new Response(`precached:${String(input)}`)),
    );
    await sw.dispatchLifecycle("install");
    sw.setFetchImpl(OFFLINE);

    const event = await sw.dispatchFetch(
      request("/game", { mode: "navigate" }),
    );

    const response: Response = await event.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe(`precached:${ORIGIN}/game`);
  });

  it("オフラインで未キャッシュのパスへのナビゲーションは / へフォールバックする", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi.fn(async (input) => new Response(`precached:${String(input)}`)),
    );
    await sw.dispatchLifecycle("install");
    sw.setFetchImpl(OFFLINE);

    const event = await sw.dispatchFetch(
      request("/unknown-path", { mode: "navigate" }),
    );

    const response: Response = await event.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe(`precached:${ORIGIN}/`);
  });

  it("不変アセットはcache-first: 一度キャッシュされたらネットワークへ出ない", async () => {
    const sw = bootServiceWorker();
    const fetchSpy = vi.fn(async () => new Response("chunk"));
    sw.setFetchImpl(fetchSpy);

    await sw.dispatchFetch(request("/_next/static/chunks/app.js"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await sw.dispatchFetch(
      request("/_next/static/chunks/app.js"),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const response: Response = await second.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe("chunk");
  });

  it("非GET・クロスオリジンのリクエストには介入しない", async () => {
    const sw = bootServiceWorker();

    const post = await sw.dispatchFetch(request("/game", { method: "POST" }));
    expect(post.respondWith).not.toHaveBeenCalled();

    const cross = await sw.dispatchFetch(
      request("/lib.js", { origin: "https://cdn.example.org" }),
    );
    expect(cross.respondWith).not.toHaveBeenCalled();
  });

  it("エラー応答(非2xx)はキャッシュへ退避しない", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi.fn(async () => new Response("not found", { status: 404 })),
    );

    await sw.dispatchFetch(request("/missing", { mode: "navigate" }));

    // 非2xx はキャッシュされない(runtime キャッシュ自体が未生成のままでもよい)。
    const runtime = sw.cacheStorage.caches.get("fbm-runtime-v1");
    expect(runtime?.store.has(`${ORIGIN}/missing`) ?? false).toBe(false);
  });
});
