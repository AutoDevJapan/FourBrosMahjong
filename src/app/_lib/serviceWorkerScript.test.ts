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
import { CHARACTER_TEXTURES } from "@/components/game/three/characterAssets";
import {
  buildServiceWorkerScript,
  MAX_RUNTIME_ENTRIES,
  PRECACHE_ASSETS,
  PRECACHE_ROUTES,
  resolveServiceWorkerVersion,
} from "./serviceWorkerScript";

// Next's static-image loader returns metadata; Vitest's asset loader returns a URL.
vi.mock("@/components/game/characters3d/textures/p0-reference.jpg", () => ({
  default: { src: "/_next/static/media/p0-reference.12345678.jpg" },
}));
vi.mock("@/components/game/characters3d/textures/p1-reference.jpg", () => ({
  default: { src: "/_next/static/media/p1-reference.23456789.jpg" },
}));
vi.mock("@/components/game/characters3d/textures/p2-reference.jpg", () => ({
  default: { src: "/_next/static/media/p2-reference.34567890.jpg" },
}));
vi.mock("@/components/game/characters3d/textures/p3-reference.jpg", () => ({
  default: { src: "/_next/static/media/p3-reference.45678901.jpg" },
}));

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
  putError: Error | null = null;

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
    if (this.putError) throw this.putError;
    this.store.set(toKey(target), response);
  }

  async match(target: FakeRequest | string): Promise<Response | undefined> {
    return this.store.get(toKey(target));
  }

  async keys(): Promise<FakeRequest[]> {
    return [...this.store.keys()].map((url) => ({
      method: "GET",
      url,
      mode: "no-cors",
    }));
  }

  async delete(target: FakeRequest | string): Promise<boolean> {
    return this.store.delete(toKey(target));
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  matchError: Error | null = null;
  keysError: Error | null = null;
  deleteError: Error | null = null;

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
    if (this.keysError) throw this.keysError;
    return [...this.caches.keys()];
  }

  async delete(name: string): Promise<boolean> {
    if (this.deleteError) throw this.deleteError;
    return this.caches.delete(name);
  }

  async match(target: FakeRequest | string): Promise<Response | undefined> {
    if (this.matchError) throw this.matchError;
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
  let fetchImpl: typeof fetch = vi.fn(async (input) => {
    const url = new URL(String(input), ORIGIN);
    return PRECACHE_ROUTES.includes(url.pathname)
      ? htmlResponse("ok")
      : staticAssetResponse(url.pathname);
  });
  const cacheStorage = new FakeCacheStorage(() => fetchImpl);
  const listeners = new Map<string, (event: unknown) => void>();
  const scope = {
    location: new URL(`${ORIGIN}/`),
    caches: cacheStorage,
    fetch: (...args: Parameters<typeof fetch>) => fetchImpl(...args),
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

function htmlResponse(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/html" } });
}

function redirectedResponse(
  body: string,
  contentType: string,
  url: string,
): Response {
  const response = new Response(body, {
    headers: { "Content-Type": contentType },
  });
  Object.defineProperties(response, {
    redirected: { value: true },
    url: { value: url },
  });
  return response;
}

function buildAssetResponse(pathname: string, body = "asset"): Response {
  const contentType = pathname.endsWith(".css")
    ? "text/css"
    : pathname.endsWith(".woff2")
      ? "font/woff2"
      : "application/javascript";
  return new Response(body, { headers: { "Content-Type": contentType } });
}

function staticAssetResponse(pathname: string, body = "asset"): Response {
  const contentType =
    pathname === "/manifest.webmanifest"
      ? "application/manifest+json"
      : pathname.endsWith(".avif")
        ? "image/avif"
        : pathname.endsWith(".jpg")
          ? "image/jpeg"
          : pathname === "/icons/icon-192" || pathname === "/icons/icon-512"
            ? "image/png"
            : "image/svg+xml";
  return new Response(body, { headers: { "Content-Type": contentType } });
}

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
      "/history",
      "/online",
      "/game",
      "/game/result",
    ]);
    expect(PRECACHE_ASSETS).toContain("/tiles/Pin5-Dora.svg");
    expect(PRECACHE_ASSETS).toContain("/tiles/Back.svg");
    expect(PRECACHE_ASSETS).toContain("/manifest.webmanifest");
    expect(PRECACHE_ASSETS).toContain("/characters/p3-hechima-portrait.avif");
    const textures = Object.values(CHARACTER_TEXTURES);
    expect(textures).toHaveLength(4);
    for (const texture of textures) {
      expect(texture).toMatch(/^\/_next\/static\/media\/.+\.jpg$/);
      expect(PRECACHE_ASSETS).toContain(texture);
    }
  });

  it("installでプリキャッシュし、旧タブ保護のため即時activateしない(#349)", async () => {
    const sw = bootServiceWorker();
    await sw.dispatchLifecycle("install");

    const precache = sw.cacheStorage.caches.get("fbm-precache-v1");
    expect(precache).toBeDefined();
    expect(precache?.store.size).toBe(
      PRECACHE_ROUTES.length + PRECACHE_ASSETS.length,
    );
    expect(precache?.store.has(`${ORIGIN}/game`)).toBe(true);
    expect(buildServiceWorkerScript("v1")).not.toContain("skipWaiting");
  });

  it("初回install時にAppシェルHTMLが参照するbuild固有JS/CSS/fontをプリキャッシュする(#506)", async () => {
    const sw = bootServiceWorker();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), ORIGIN);
      if (PRECACHE_ROUTES.includes(url.pathname)) {
        return htmlResponse(`
          <link rel="stylesheet" href="/_next/static/css/app.abc.css">
          <link rel="preload" href="/_next/static/media/game.def.woff2?dpl=build#font" as="font">
          <script src="/_next/static/chunks/app.123.js"></script>
          <script src="/_next/static/chunks/app.123.js?dpl=build#duplicate"></script>
          <script src="/_next/static/chunks/app.123.js?dpl=another-build"></script>
          <script src="https://cdn.example.net/_next/static/foreign.js"></script>
          <script src="/api/not-a-build-asset"></script>
        `);
      }
      if (PRECACHE_ASSETS.includes(url.pathname)) {
        return staticAssetResponse(url.pathname, `asset:${url.pathname}`);
      }
      return buildAssetResponse(url.pathname, `asset:${url.pathname}`);
    });
    sw.setFetchImpl(fetchSpy as typeof fetch);

    await sw.dispatchLifecycle("install");

    const precache = sw.cacheStorage.caches.get("fbm-precache-v1");
    for (const path of [
      "/_next/static/css/app.abc.css",
      "/_next/static/media/game.def.woff2",
      "/_next/static/chunks/app.123.js",
    ]) {
      expect(precache?.store.has(`${ORIGIN}${path}`)).toBe(true);
    }
    expect(
      [...(precache?.store.keys() ?? [])].filter((key) =>
        key.includes("/_next/static/chunks/app.123.js?"),
      ),
    ).toHaveLength(0);

    // Runtime fetches keep their deployment query, while the cache lookup
    // canonicalizes it away. Verify the query-bearing request still hits the
    // install cache without touching the network when offline.
    sw.setFetchImpl(OFFLINE);
    const offlineEvent = await sw.dispatchFetch(
      request("/_next/static/chunks/app.123.js?dpl=runtime"),
    );
    const offlineResponse: Response =
      await offlineEvent.respondWith.mock.calls[0][0];
    expect(await offlineResponse.text()).toBe(
      "asset:/_next/static/chunks/app.123.js",
    );
    expect(
      precache?.store.has("https://cdn.example.net/_next/static/foreign.js"),
    ).toBe(false);
    expect(precache?.store.has(`${ORIGIN}/api/not-a-build-asset`)).toBe(false);
    expect(
      fetchSpy.mock.calls.filter(
        ([input]) =>
          new URL(String(input), ORIGIN).pathname ===
          "/_next/static/chunks/app.123.js",
      ),
    ).toHaveLength(1);
  });

  it("CSSのurl参照もinstall時にfont cacheへ収録する", async () => {
    const sw = bootServiceWorker();
    const stylesheet = "/_next/static/css/app.abc.css";
    const font = "/_next/static/media/route-font.woff2";
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), ORIGIN);
      if (PRECACHE_ROUTES.includes(url.pathname)) {
        return htmlResponse(`<link rel="stylesheet" href="${stylesheet}">`);
      }
      if (PRECACHE_ASSETS.includes(url.pathname)) {
        return staticAssetResponse(url.pathname, `asset:${url.pathname}`);
      }
      if (url.pathname === stylesheet) {
        return buildAssetResponse(
          stylesheet,
          '@font-face{font-family:Route;src:url("../media/route-font.woff2?build=1#font")}@import url("./nested.css")',
        );
      }
      if (url.pathname === "/_next/static/css/nested.css") {
        return buildAssetResponse(
          "/_next/static/css/nested.css",
          "body{background-image:url('../media/route-bg.svg?build=1')}",
        );
      }
      return url.pathname === font
        ? buildAssetResponse(font, "font-data")
        : url.pathname.endsWith(".svg")
          ? staticAssetResponse(url.pathname, `asset:${url.pathname}`)
          : buildAssetResponse(url.pathname, `asset:${url.pathname}`);
    });
    sw.setFetchImpl(fetchSpy as typeof fetch);

    await sw.dispatchLifecycle("install");

    const precache = sw.cacheStorage.caches.get("fbm-precache-v1");
    expect(precache?.store.has(`${ORIGIN}${stylesheet}`)).toBe(true);
    expect(precache?.store.has(`${ORIGIN}${font}`)).toBe(true);
    expect(precache?.store.has(`${ORIGIN}/_next/static/css/nested.css`)).toBe(
      true,
    );
    expect(
      precache?.store.has(`${ORIGIN}/_next/static/media/route-bg.svg`),
    ).toBe(true);

    sw.setFetchImpl(OFFLINE);
    const offline = await sw.dispatchFetch(request(`${font}?runtime=1`));
    const response: Response = await offline.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe("font-data");
  });

  it("必要build assetの取得失敗時はinstall自体を失敗させる(#506)", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi.fn(async (input) => {
        const url = new URL(String(input), ORIGIN);
        if (PRECACHE_ROUTES.includes(url.pathname)) {
          return htmlResponse(
            '<script src="/_next/static/chunks/missing.js"></script>',
          );
        }
        if (url.pathname === "/_next/static/chunks/missing.js") {
          return new Response("missing", {
            status: 404,
            headers: { "Content-Type": "application/javascript" },
          });
        }
        return staticAssetResponse(url.pathname);
      }),
    );

    await expect(sw.dispatchLifecycle("install")).rejects.toThrow(
      "Invalid precached build asset response",
    );
    expect(sw.cacheStorage.caches.has("fbm-precache-v1")).toBe(false);
  });

  it("App shellが200 HTMLでなければinstallを失敗させ部分cacheを削除する", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi.fn(async (input) => {
        const url = new URL(String(input), ORIGIN);
        if (url.pathname === "/game") {
          return new Response("login", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }
        return PRECACHE_ROUTES.includes(url.pathname)
          ? htmlResponse("shell")
          : staticAssetResponse(url.pathname);
      }),
    );

    await expect(sw.dispatchLifecycle("install")).rejects.toThrow(
      "Invalid precached App shell response: /game",
    );
    expect(sw.cacheStorage.caches.has("fbm-precache-v1")).toBe(false);
  });

  it.each([204, 206] as const)(
    "App shellが非200ステータス(%d) HTMLでもinstallを失敗させ部分cacheを削除する(#942)",
    async (status) => {
      const sw = bootServiceWorker();
      sw.setFetchImpl(
        vi.fn(async (input) => {
          const url = new URL(String(input), ORIGIN);
          if (url.pathname === "/game") {
            return new Response(status === 204 ? null : "partial", {
              status,
              headers: { "Content-Type": "text/html" },
            });
          }
          return PRECACHE_ROUTES.includes(url.pathname)
            ? htmlResponse("shell")
            : staticAssetResponse(url.pathname);
        }),
      );

      await expect(sw.dispatchLifecycle("install")).rejects.toThrow(
        "Invalid precached App shell response: /game",
      );
      expect(sw.cacheStorage.caches.has("fbm-precache-v1")).toBe(false);
    },
  );

  it("build assetの拡張子とContent-Typeが一致しなければinstallを失敗させる", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi.fn(async (input) => {
        const url = new URL(String(input), ORIGIN);
        if (PRECACHE_ROUTES.includes(url.pathname)) {
          return htmlResponse(
            '<script src="/_next/static/chunks/app.js"></script>',
          );
        }
        if (url.pathname.endsWith("app.js")) {
          return htmlResponse("login fallback");
        }
        return staticAssetResponse(url.pathname);
      }),
    );

    await expect(sw.dispatchLifecycle("install")).rejects.toThrow(
      "Invalid precached build asset response",
    );
    expect(sw.cacheStorage.caches.has("fbm-precache-v1")).toBe(false);
  });

  it("固定素材が200でもMIME不一致ならinstallを失敗させ部分cacheを削除する", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi.fn(async (input) => {
        const url = new URL(String(input), ORIGIN);
        if (url.pathname === "/tiles/Back.svg") {
          return htmlResponse("hosting fallback");
        }
        return PRECACHE_ROUTES.includes(url.pathname)
          ? htmlResponse("shell")
          : staticAssetResponse(url.pathname);
      }),
    );

    await expect(sw.dispatchLifecycle("install")).rejects.toThrow(
      "Invalid precached static asset response: /tiles/Back.svg",
    );
    expect(sw.cacheStorage.caches.has("fbm-precache-v1")).toBe(false);
  });

  it("cross-origin redirectされたApp shellをprecacheせずinstallを失敗させる", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi.fn(async (input) => {
        const url = new URL(String(input), ORIGIN);
        if (url.pathname === "/game") {
          return redirectedResponse(
            "external shell",
            "text/html",
            "https://external.example.net/game",
          );
        }
        return PRECACHE_ROUTES.includes(url.pathname)
          ? htmlResponse("shell")
          : staticAssetResponse(url.pathname);
      }),
    );

    await expect(sw.dispatchLifecycle("install")).rejects.toThrow(
      "Invalid precached App shell response: /game",
    );
    expect(sw.cacheStorage.caches.has("fbm-precache-v1")).toBe(false);
  });

  it("waiting中は旧chunk cacheを残し、activate後にだけ旧fbm-*を回収する(#349)", async () => {
    const sw = bootServiceWorker();
    const old = await sw.cacheStorage.open("fbm-precache-old");
    await old.put("/_next/static/chunks/old.js", new Response("old-chunk"));
    await sw.cacheStorage.open("fbm-runtime-old");
    await sw.cacheStorage.open("unrelated-cache");
    await sw.dispatchLifecycle("install");

    expect(
      await sw.cacheStorage.match("/_next/static/chunks/old.js"),
    ).toBeDefined();
    expect(await sw.cacheStorage.keys()).toContain("fbm-precache-old");

    await sw.dispatchLifecycle("activate");

    const remaining = await sw.cacheStorage.keys();
    expect(remaining).not.toContain("fbm-precache-old");
    expect(remaining).not.toContain("fbm-runtime-old");
    expect(remaining).toContain("unrelated-cache");
    expect(remaining).toContain("fbm-precache-v1");
    expect(buildServiceWorkerScript("v1")).not.toContain("clients.claim");
  });

  it("Cache Storageの一覧取得に失敗してもactivateを失敗させない", async () => {
    const sw = bootServiceWorker();
    await sw.dispatchLifecycle("install");
    sw.cacheStorage.keysError = new DOMException("Cache Storage unavailable");

    await expect(sw.dispatchLifecycle("activate")).resolves.toBeUndefined();
    expect(sw.cacheStorage.caches.has("fbm-precache-v1")).toBe(true);
  });

  it("古いcacheの削除に失敗してもactivateを失敗させない", async () => {
    const sw = bootServiceWorker();
    await sw.cacheStorage.open("fbm-runtime-old");
    await sw.dispatchLifecycle("install");
    sw.cacheStorage.deleteError = new DOMException("Cache deletion blocked");

    await expect(sw.dispatchLifecycle("activate")).resolves.toBeUndefined();
    expect(sw.cacheStorage.caches.has("fbm-runtime-old")).toBe(true);
    expect(sw.cacheStorage.caches.has("fbm-precache-v1")).toBe(true);
  });

  it("ナビゲーションはnetwork-first: オンライン時は最新を返しつつキャッシュへ退避する", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(vi.fn(async () => htmlResponse("fresh-shell")));

    const event = await sw.dispatchFetch(
      request("/game", { mode: "navigate" }),
    );

    const response: Response = await event.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe("fresh-shell");
    const runtime = sw.cacheStorage.caches.get("fbm-runtime-v1");
    expect(runtime?.store.has(`${ORIGIN}/game`)).toBe(true);
  });

  it("query違いの同一routeをcanonical keyへ畳み込みruntime cacheを増やさない", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(vi.fn(async () => htmlResponse("fresh-shell")));

    for (let i = 0; i < MAX_RUNTIME_ENTRIES + 20; i++) {
      await sw.dispatchFetch(
        request(`/rules?runtime-cache-repro=${i}`, { mode: "navigate" }),
      );
    }

    const runtime = sw.cacheStorage.caches.get("fbm-runtime-v1");
    expect(runtime?.store.size).toBe(1);
    expect(runtime?.store.has(`${ORIGIN}/rules`)).toBe(true);

    sw.setFetchImpl(OFFLINE);
    const offline = await sw.dispatchFetch(
      request("/rules?runtime-cache-repro=offline", { mode: "navigate" }),
    );
    const response: Response = await offline.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe("fresh-shell");
  });

  it("runtime cacheは上限超過時に古いentryから削除する", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi.fn(
        async () =>
          new Response("chunk", {
            headers: { "Content-Type": "application/javascript" },
          }),
      ),
    );

    // 実ブラウザ同様に並列取得しても、write + eviction の直列化で上限を越えない。
    await Promise.all(
      Array.from({ length: MAX_RUNTIME_ENTRIES + 5 }, (_, i) =>
        sw.dispatchFetch(request(`/_next/static/chunks/${i}.js`)),
      ),
    );

    const runtime = sw.cacheStorage.caches.get("fbm-runtime-v1");
    expect(runtime?.store.size).toBe(MAX_RUNTIME_ENTRIES);
    expect(runtime?.store.has(`${ORIGIN}/_next/static/chunks/0.js`)).toBe(
      false,
    );
    expect(
      runtime?.store.has(
        `${ORIGIN}/_next/static/chunks/${MAX_RUNTIME_ENTRIES + 4}.js`,
      ),
    ).toBe(true);
  });

  it("cache.putが失敗しても取得済みオンラインresponseを返す", async () => {
    const sw = bootServiceWorker();
    const online = htmlResponse("online-success");
    sw.setFetchImpl(vi.fn(async () => online.clone()));
    const runtime = await sw.cacheStorage.open("fbm-runtime-v1");
    runtime.putError = new DOMException("quota exceeded", "QuotaExceededError");

    const event = await sw.dispatchFetch(
      request("/game", { mode: "navigate" }),
    );
    const response: Response = await event.respondWith.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("online-success");
  });

  it("一時GET/RSCはinterceptせず、未知navigationはfallback用にinterceptするが保存しない", async () => {
    const sw = bootServiceWorker();

    const api = await sw.dispatchFetch(request("/api/data?request=1"));
    const rsc = await sw.dispatchFetch(request("/game?_rsc=repro"));
    const unknown = await sw.dispatchFetch(
      request("/unknown?query=1", { mode: "navigate" }),
    );

    expect(api.respondWith).not.toHaveBeenCalled();
    expect(rsc.respondWith).not.toHaveBeenCalled();
    expect(unknown.respondWith).toHaveBeenCalledOnce();
    expect(sw.cacheStorage.caches.has("fbm-runtime-v1")).toBe(false);
  });

  it("既知routeのRSC取得後もcanonical HTML cacheを維持してoffline navigationへ返す(#355)", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi.fn(async (input) => {
        const url = new URL(String(input), ORIGIN);
        return PRECACHE_ROUTES.includes(url.pathname)
          ? htmlResponse("precached-html")
          : staticAssetResponse(url.pathname);
      }),
    );
    await sw.dispatchLifecycle("install");

    sw.setFetchImpl(vi.fn(async () => htmlResponse("fresh-html")));
    await sw.dispatchFetch(request("/game", { mode: "navigate" }));

    const runtime = sw.cacheStorage.caches.get("fbm-runtime-v1");

    // Next.js client navigation/prefetch は同じ pathname への非navigation RSC GET。
    // HTML と同じ canonical key へ保存すると異なる表現が同居し、cache integrity が壊れる。
    const rsc = await sw.dispatchFetch(request("/game?_rsc=repro"));
    expect(rsc.respondWith).not.toHaveBeenCalled();
    expect(await (await runtime?.match("/game"))?.text()).toBe("fresh-html");

    sw.setFetchImpl(OFFLINE);
    const offline = await sw.dispatchFetch(
      request("/game", { mode: "navigate" }),
    );
    const response: Response = await offline.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe("precached-html");
  });

  it("navigationが非HTMLを返してもcanonical route keyへ保存しない", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi.fn(
        async () =>
          new Response("RSC_PAYLOAD", {
            headers: { "Content-Type": "text/x-component" },
          }),
      ),
    );

    const event = await sw.dispatchFetch(
      request("/game", { mode: "navigate" }),
    );
    const response: Response = await event.respondWith.mock.calls[0][0];

    expect(await response.text()).toBe("RSC_PAYLOAD");
    expect(sw.cacheStorage.caches.has("fbm-runtime-v1")).toBe(false);
  });

  it.each([204, 206] as const)(
    "navigationの非200ステータス(%d) HTMLは返すがcanonical route keyへ保存しない(#942)",
    async (status) => {
      const sw = bootServiceWorker();
      sw.setFetchImpl(
        vi.fn(
          async () =>
            new Response(status === 204 ? null : "partial", {
              status,
              headers: { "Content-Type": "text/html" },
            }),
        ),
      );

      const event = await sw.dispatchFetch(
        request("/game", { mode: "navigate" }),
      );
      const response: Response = await event.respondWith.mock.calls[0][0];

      expect(response.status).toBe(status);
      const runtime = sw.cacheStorage.caches.get("fbm-runtime-v1");
      expect(runtime?.store.has(`${ORIGIN}/game`) ?? false).toBe(false);
    },
  );

  it("オフラインのナビゲーションはプリキャッシュ済みHTMLで応答する(#292回帰防止)", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi.fn(async (input) => {
        const url = new URL(String(input), ORIGIN);
        return PRECACHE_ROUTES.includes(url.pathname)
          ? htmlResponse(`precached:${String(input)}`)
          : staticAssetResponse(url.pathname);
      }),
    );
    await sw.dispatchLifecycle("install");
    sw.setFetchImpl(OFFLINE);

    const event = await sw.dispatchFetch(
      request("/game", { mode: "navigate" }),
    );

    const response: Response = await event.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe("precached:/game");
  });

  it("オフラインで未キャッシュのパスへのナビゲーションは / へフォールバックする", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi.fn(async (input) => {
        const url = new URL(String(input), ORIGIN);
        return PRECACHE_ROUTES.includes(url.pathname)
          ? htmlResponse(`precached:${String(input)}`)
          : staticAssetResponse(url.pathname);
      }),
    );
    await sw.dispatchLifecycle("install");
    sw.setFetchImpl(OFFLINE);

    const event = await sw.dispatchFetch(
      request("/unknown-path", { mode: "navigate" }),
    );

    const response: Response = await event.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe("precached:/");
  });

  it("不変アセットはcache-first: 一度キャッシュされたらネットワークへ出ない", async () => {
    const sw = bootServiceWorker();
    const fetchSpy = vi.fn(
      async () =>
        new Response("chunk", {
          headers: { "Content-Type": "application/javascript" },
        }),
    );
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

  it("Cache Storageの読み取りが失敗しても不変アセットをネットワークから返す", async () => {
    const sw = bootServiceWorker();
    const fetchSpy = vi.fn(
      async () =>
        new Response("network-chunk", {
          headers: { "Content-Type": "application/javascript" },
        }),
    );
    sw.setFetchImpl(fetchSpy);
    sw.cacheStorage.matchError = new DOMException(
      "Cache Storage unavailable",
      "SecurityError",
    );

    const event = await sw.dispatchFetch(
      request("/_next/static/chunks/app.js"),
    );
    const response: Response = await event.respondWith.mock.calls[0][0];

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("network-chunk");
  });

  it("Cache Storageのmatch capabilityが欠けても不変アセットをネットワークから返す", async () => {
    const sw = bootServiceWorker();
    const fetchSpy = vi.fn(
      async () =>
        new Response("network-chunk", {
          headers: { "Content-Type": "application/javascript" },
        }),
    );
    sw.setFetchImpl(fetchSpy);
    Object.defineProperty(sw.cacheStorage, "match", { value: undefined });

    const event = await sw.dispatchFetch(
      request("/_next/static/chunks/app.js"),
    );
    const response: Response = await event.respondWith.mock.calls[0][0];

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(await response.text()).toBe("network-chunk");
  });

  it("不変アセットはオフライン時に既存のCache Storage responseを返す", async () => {
    const sw = bootServiceWorker();
    const onlineFetch = vi.fn(
      async () =>
        new Response("cached-chunk", {
          headers: { "Content-Type": "application/javascript" },
        }),
    );
    sw.setFetchImpl(onlineFetch);

    await sw.dispatchFetch(request("/_next/static/chunks/app.js"));
    sw.setFetchImpl(OFFLINE);

    const event = await sw.dispatchFetch(
      request("/_next/static/chunks/app.js"),
    );
    const response: Response = await event.respondWith.mock.calls[0][0];

    expect(onlineFetch).toHaveBeenCalledOnce();
    expect(await response.text()).toBe("cached-chunk");
  });

  it("Cache Storageとnetworkがともに失敗した場合は元のnetwork errorを再送出する", async () => {
    const sw = bootServiceWorker();
    const networkError = new TypeError("net::ERR_INTERNET_DISCONNECTED");
    sw.setFetchImpl(
      vi.fn(async () => {
        throw networkError;
      }),
    );
    sw.cacheStorage.matchError = new DOMException(
      "Cache Storage unavailable",
      "SecurityError",
    );

    await expect(
      sw.dispatchFetch(request("/unknown-path", { mode: "navigate" })),
    ).rejects.toBe(networkError);
  });

  it("manifestの200 HTML fallbackをruntime cacheへ保存せず正常応答へ回復する(#957)", async () => {
    const sw = bootServiceWorker();
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(htmlResponse("fallback"))
      .mockResolvedValueOnce(
        staticAssetResponse("/manifest.webmanifest", "valid manifest"),
      );
    sw.setFetchImpl(fetchSpy);

    const first = await sw.dispatchFetch(request("/manifest.webmanifest"));
    const firstResponse: Response = await first.respondWith.mock.calls[0][0];
    expect(await firstResponse.text()).toBe("fallback");
    const runtime = sw.cacheStorage.caches.get("fbm-runtime-v1");
    expect(runtime?.store.has(`${ORIGIN}/manifest.webmanifest`) ?? false).toBe(
      false,
    );

    const second = await sw.dispatchFetch(request("/manifest.webmanifest"));
    const secondResponse: Response = await second.respondWith.mock.calls[0][0];
    expect(await secondResponse.text()).toBe("valid manifest");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await sw.dispatchFetch(request("/manifest.webmanifest"));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("不変JSへの200 HTML fallbackをキャッシュせず正常応答へ回復する", async () => {
    const sw = bootServiceWorker();
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(htmlResponse("fallback"))
      .mockResolvedValueOnce(
        new Response("valid chunk", {
          headers: { "Content-Type": "application/javascript" },
        }),
      );
    sw.setFetchImpl(fetchSpy);

    const first = await sw.dispatchFetch(
      request("/_next/static/chunks/app.js"),
    );
    const firstResponse: Response = await first.respondWith.mock.calls[0][0];
    expect(await firstResponse.text()).toBe("fallback");

    const second = await sw.dispatchFetch(
      request("/_next/static/chunks/app.js"),
    );
    const secondResponse: Response = await second.respondWith.mock.calls[0][0];
    expect(await secondResponse.text()).toBe("valid chunk");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await sw.dispatchFetch(request("/_next/static/chunks/app.js"));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([204, 206] as const)(
    "不変JSの非200ステータス(%d) responseを返すがcache-firstへ保存しない(#942)",
    async (status) => {
      const sw = bootServiceWorker();
      sw.setFetchImpl(
        vi.fn(
          async () =>
            new Response(status === 204 ? null : "partial", {
              status,
              headers: { "Content-Type": "application/javascript" },
            }),
        ),
      );

      const event = await sw.dispatchFetch(
        request("/_next/static/chunks/partial.js"),
      );
      const response: Response = await event.respondWith.mock.calls[0][0];

      expect(response.status).toBe(status);
      const runtime = sw.cacheStorage.caches.get("fbm-runtime-v1");
      expect(
        runtime?.store.has(`${ORIGIN}/_next/static/chunks/partial.js`) ?? false,
      ).toBe(false);
    },
  );

  it("cross-origin redirectされたruntime responseを保存しない", async () => {
    const sw = bootServiceWorker();
    sw.setFetchImpl(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          redirectedResponse(
            "external shell",
            "text/html",
            "https://external.example.net/game",
          ),
        )
        .mockResolvedValueOnce(
          redirectedResponse(
            "external chunk",
            "application/javascript",
            "https://external.example.net/chunk.js",
          ),
        ),
    );

    const navigation = await sw.dispatchFetch(
      request("/game", { mode: "navigate" }),
    );
    const navigationResponse: Response =
      await navigation.respondWith.mock.calls[0][0];
    expect(await navigationResponse.text()).toBe("external shell");

    const asset = await sw.dispatchFetch(
      request("/_next/static/chunks/app.js"),
    );
    const assetResponse: Response = await asset.respondWith.mock.calls[0][0];
    expect(await assetResponse.text()).toBe("external chunk");

    const runtime = sw.cacheStorage.caches.get("fbm-runtime-v1");
    expect(runtime?.store.has(`${ORIGIN}/game`) ?? false).toBe(false);
    expect(
      runtime?.store.has(`${ORIGIN}/_next/static/chunks/app.js`) ?? false,
    ).toBe(false);
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
