/**
 * Service worker スクリプト生成(issue #292 / スペック6 6.9 オフライン方針)。
 *
 * 対局は完全にクライアント内(`GameProvider` の React state + `sessionStorage` ジャーナル)で
 * 完結するため、静的アセットさえキャッシュされていればオフラインで起動・継続できる。
 * ここでは外部ライブラリ(Workbox 等)に依存せず、必要最小限の自前 SW を文字列として生成する。
 *
 * 配信は `src/app/sw.js/route.ts`(`force-static`)が担い、ビルドごとに一意の `version` を
 * 埋め込む。更新版は旧 SW のクライアントが無くなるまで waiting に留まり、
 * activate してから旧 `fbm-*` cache を破棄する。`skipWaiting` / `clients.claim`
 * で旧ページを途中から奪うと、必要な旧ハッシュ chunk も削除されるため使わない(#349)。
 *
 * キャッシュ戦略:
 * - ナビゲーション(HTML): network-first。オンライン時は常に最新シェルを取得し、
 *   オフライン時のみキャッシュ(最後は `/` へフォールバック)で応答する。
 * - `/_next/static/`(コンテンツハッシュ付き)・牌 SVG・アイコン: cache-first(実質不変)。
 * - その他の同一オリジン GET(RSC/API/未知URL等): キャッシュせずブラウザへ委譲。
 *   未知URLへのナビゲーションだけは、オフライン時の `/` fallback のため仲介する。
 *
 * 生成文字列内では `self.*` を明示参照する(暗黙のグローバル参照を避け、Vitest で
 * 偽の ServiceWorkerGlobalScope を注入してハンドラの挙動を検証できるようにするため)。
 */
import { TILE_ASSET_URLS } from "@/components/common/tileImage";

/** オフライン起動対象の全ルート(App Router のユーザー向け画面)。 */
export const PRECACHE_ROUTES: readonly string[] = [
  "/",
  "/rules",
  "/settings",
  // 戦績は localStorage 完結でオフラインでも中身を表示できる(issue #293)。
  "/history",
  "/game",
  "/game/result",
];

/** ルート以外にプリキャッシュする静的アセット(PWA アイコン・全牌素材)。 */
export const PRECACHE_ASSETS: readonly string[] = [
  "/manifest.webmanifest",
  "/icon.svg",
  "/icons/icon-192",
  "/icons/icon-512",
  ...TILE_ASSET_URLS,
];

/**
 * 1デプロイ中に保持する runtime cache の最大件数。
 *
 * プリキャッシュ外で実際に増えるのは主にコンテンツハッシュ付き Next.js chunk だが、
 * クエリ違い・将来の route 追加・ブラウザの投機取得でも origin quota を無制限に
 * 消費しないよう明示的な上限を置く。超過時は Cache API の挿入順で古いものから削除する。
 */
export const MAX_RUNTIME_ENTRIES = 100;

/**
 * SW のキャッシュバージョンを決定する。
 *
 * Vercel ビルドではコミット SHA(デプロイごとに一意)を使う。ローカルビルドでは
 * ビルド時刻ベースのフォールバックを使う(`force-static` ルートはビルド時に一度だけ
 * 評価されるため、ビルドごとに一意になる)。
 */
export function resolveServiceWorkerVersion(
  env: Record<string, string | undefined> = process.env,
  now: () => number = Date.now,
): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  if (sha) {
    return sha.slice(0, 12);
  }
  return `local-${now().toString(36)}`;
}

/** 生成した SW スクリプト(JavaScript ソース文字列)を返す。 */
export function buildServiceWorkerScript(version: string): string {
  const precacheUrls = [...PRECACHE_ROUTES, ...PRECACHE_ASSETS];
  return `/* 四兄弟麻雀 service worker (generated: src/app/sw.js/route.ts, issue #292) */
"use strict";

const VERSION = ${JSON.stringify(version)};
const OWNED_CACHE_PREFIX = "fbm-";
const PRECACHE = OWNED_CACHE_PREFIX + "precache-" + VERSION;
const RUNTIME = OWNED_CACHE_PREFIX + "runtime-" + VERSION;
const PRECACHE_URLS = ${JSON.stringify(precacheUrls)};
const CACHEABLE_PATHS = new Set(PRECACHE_URLS);
const MAX_RUNTIME_ENTRIES = ${MAX_RUNTIME_ENTRIES};
const NAVIGATION_FALLBACK_URL = "/";

// cache.put + eviction を直列化する。同時 fetch が各々「上限未満」と判定してから
// 書き込む競合を防ぎ、完了後の件数上限を常に維持する。
let cacheWriteChain = Promise.resolve();

/** コンテンツハッシュ付き・または実質不変の静的アセットか。 */
function isImmutableAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/tiles/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/icon.svg"
  );
}

function canonicalCacheKey(request) {
  const url = new URL(request.url);
  // 本アプリでは query は表示シェル/静的アセットの内容を変えない。本番の ?seed も無効。
  // URLごとの無制限エントリ化を防ぎ、同じ pathname は1つのキャッシュへ畳み込む。
  url.search = "";
  url.hash = "";
  return url.href;
}

function isCacheableRequest(url) {
  return (
    CACHEABLE_PATHS.has(url.pathname) ||
    url.pathname.startsWith("/_next/static/")
  );
}

function putRuntimeCache(cacheKey, response) {
  const write = cacheWriteChain.then(async () => {
    const cache = await self.caches.open(RUNTIME);
    await cache.put(cacheKey, response);
    const keys = await cache.keys();
    const excess = keys.length - MAX_RUNTIME_ENTRIES;
    if (excess > 0) {
      await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
    }
  });
  // 失敗を次の書き込みへ伝播させない。呼び出し元は個別 write の成否だけを待てる。
  cacheWriteChain = write.catch(() => {});
  return write;
}

/** network-first: 成功したらキャッシュへ退避し、失敗(オフライン)時はキャッシュで応答する。 */
async function networkFirst(request, cacheKey, fallbackUrl) {
  try {
    const response = await self.fetch(request);
    if (response.ok && cacheKey) {
      // Cache Storage は progressive enhancement。quota/権限エラーでも、既に取得できた
      // オンラインレスポンスは必ず利用者へ返す。
      await putRuntimeCache(cacheKey, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = cacheKey ? await self.caches.match(cacheKey) : undefined;
    if (cached) {
      return cached;
    }
    if (fallbackUrl) {
      const fallback = await self.caches.match(fallbackUrl);
      if (fallback) {
        return fallback;
      }
    }
    throw error;
  }
}

/** cache-first: 不変アセット用。キャッシュ済みなら network に一切出ない。 */
async function cacheFirst(request, cacheKey) {
  const cached = await self.caches.match(cacheKey);
  if (cached) {
    return cached;
  }
  const response = await self.fetch(request);
  if (response.ok) {
    await putRuntimeCache(cacheKey, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    self.caches.open(PRECACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith(OWNED_CACHE_PREFIX) &&
                key !== PRECACHE &&
                key !== RUNTIME,
            )
            .map((key) => self.caches.delete(key)),
        ),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  const cacheable = isCacheableRequest(url);
  if (request.mode === "navigate") {
    // 未知URLもオフライン時は / へ戻すが、そのレスポンス自体は保存しない。
    event.respondWith(
      networkFirst(
        request,
        cacheable ? canonicalCacheKey(request) : null,
        NAVIGATION_FALLBACK_URL,
      ),
    );
    return;
  }
  // オフライン契約に含まれる画面・素材と、ビルド固有 chunk だけを保存する。
  // API/RSC等の一時的な GET はブラウザへ任せ、runtime cache を汚染しない。
  if (!cacheable) {
    return;
  }
  const cacheKey = canonicalCacheKey(request);
  if (isImmutableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, cacheKey));
    return;
  }
  event.respondWith(networkFirst(request, cacheKey));
});
`;
}
