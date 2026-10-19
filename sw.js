/* VC Fashion service worker.
   Minimal, safety-first caching: only the public browsing shell is stored so
   the storefront opens reliably (including offline). This worker NEVER caches:
   - admin, account, order, checkout or payment pages;
   - Supabase responses (catalog, storage, auth, edge functions);
   - Razorpay checkout/payment resources;
   - any non-GET or credential-bearing (authenticated) request.
   Product data, pricing, inventory and orders always come fresh from the
   network. Offline checkout and payment are deliberately not supported. */
'use strict';

const VERSION = 'v2';
const SHELL_CACHE = `vc-fashion-shell-${VERSION}`;
const ASSET_CACHE = `vc-fashion-assets-${VERSION}`;
const FONT_CACHE = `vc-fashion-fonts-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE, FONT_CACHE];

// Public app shell, precached at install so the storefront loads reliably.
// Protected pages (admin/checkout/orders/auth) and their scripts are excluded
// on purpose so no account or payment surface is ever stored on the device.
const APP_SHELL = [
  'index.html',
  'shop.html',
  'product.html',
  'search.html',
  'style.css',
  'shop.css',
  'product.css',
  'products.js',
  'supabase-config.js',
  'supabase-client.js',
  'catalog-service.js',
  'commerce.js',
  'script.js',
  'shop.js',
  'product.js',
  'search.js',
  'pwa.js',
  'manifest.webmanifest',
  'favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

// Same-origin pages/assets that must always load straight from the network
// and are never read from or written to any cache.
const PROTECTED_PATHS = ['/admin', '/checkout', '/orders', '/auth'];

// Cross-origin hosts that must never be cached under any circumstance.
// Covers every Supabase surface used by the app (REST, Auth, Storage,
// Edge Functions, database webhooks) plus all Razorpay resources.
const NEVER_CACHE_HOSTS = [
  'supabase.co',
  'razorpay.com',
  'api.razorpay.com',
  'checkout.razorpay.com',
  'images.unsplash.com'
];

// Only these same-origin static asset types may be cached at runtime.
const STATIC_ASSET_EXTENSIONS = ['.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.webmanifest'];
const MAX_RUNTIME_ASSET_ENTRIES = 60;

const SHELL_FILES = new Set(APP_SHELL);

function isProtectedPath(path) {
  return PROTECTED_PATHS.some(prefix => path.startsWith(prefix));
}

function isNeverCacheHost(hostname) {
  return NEVER_CACHE_HOSTS.some(host => hostname === host || hostname.endsWith(`.${host}`));
}

function isStaticAsset(path) {
  const lower = path.toLowerCase();
  return STATIC_ASSET_EXTENSIONS.some(extension => lower.endsWith(extension));
}

function isPrecachedShellFile(path) {
  return SHELL_FILES.has(path.replace(/^\//, ''));
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map(key => cache.delete(key)));
}

function offlineNotice() {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline — VC Fashion</title></head><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#f8f7f4;color:#191a18;font-family:DM Sans,Arial,sans-serif;text-align:center"><div><p style="font-size:11px;letter-spacing:1.5px;color:#a4a37a;margin:0 0 12px">VC FASHION</p><h1 style="font:600 34px Manrope,Arial,sans-serif;letter-spacing:-1px;margin:0 0 10px">You’re offline.</h1><p style="font-size:14px;color:#777770;margin:0 0 18px">Reconnect to browse the latest collection. Cart, account, checkout and payment always need a connection.</p><a href="index.html" style="font-size:12px;color:#191a18;border-bottom:1px solid #191a18;padding-bottom:3px">Back to the shop</a></div></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// Only public Google Fonts are handled cross-origin; every other cross-origin
// request (Supabase, Razorpay, Unsplash images, WhatsApp, …) returns null and
// falls through to the plain network, untouched by this worker.
function fontStrategy(url, request) {
  if (url.hostname === 'fonts.gstatic.com' && request.destination === 'font') return cacheFirst(FONT_CACHE, request);
  if (url.hostname === 'fonts.googleapis.com' && request.destination === 'style') return staleWhileRevalidate(FONT_CACHE, request);
  return null;
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(response => {
      if (response && response.ok) return cache.put(request, response.clone()).then(() => response);
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

// Navigations: network first so customers always see fresh public pages and
// their live catalog. Protected pages never read from or write to cache.
async function handleNavigation(request, path) {
  if (isProtectedPath(path)) {
    try {
      return await fetch(request);
    } catch {
      return offlineNotice();
    }
  }
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const home = await caches.match('index.html');
    return home || offlineNotice();
  }
}

// Same-origin static files: serve from the app-shell cache when possible so
// the storefront opens quickly and survives flaky networks. Only plain
// successful responses to allowlisted asset types are ever stored.
async function handleStaticAsset(request, url) {
  const precached = isPrecachedShellFile(url.pathname);
  const cacheName = precached ? SHELL_CACHE : ASSET_CACHE;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: precached });
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    if (!precached) await trimCache(ASSET_CACHE, MAX_RUNTIME_ASSET_ENTRIES);
  }
  return response;
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(name => name.startsWith('vc-fashion-') && !CURRENT_CACHES.includes(name))
          .map(name => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  // Writes and mutations are never cached or intercepted.
  if (request.method !== 'GET') return;

  // Credential-bearing (authenticated) requests always bypass this worker.
  if (request.headers.get('authorization') || request.headers.get('apikey')) return;

  const url = new URL(request.url);

  // Defence in depth: hosts that must never be cached go straight out.
  if (isNeverCacheHost(url.hostname)) return;

  if (url.origin !== self.location.origin) {
    const fontHandler = fontStrategy(url, request);
    if (fontHandler) event.respondWith(fontHandler);
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, url.pathname));
    return;
  }

  // Admin, checkout, orders and auth pages/assets: network only, no cache.
  if (isProtectedPath(url.pathname)) return;

  if (isStaticAsset(url.pathname)) {
    event.respondWith(handleStaticAsset(request, url));
  }
});
