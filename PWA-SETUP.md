# VC Fashion PWA setup

The storefront is now an installable Progressive Web App. This document covers
what was added, what the service worker does and — importantly — what it never
does. No database schemas, Supabase policies, payment logic, environment
secrets, or storage keys were changed.

## Files added

| File | Purpose |
| --- | --- |
| `manifest.webmanifest` | App identity: name "VC Fashion", brand theme/background `#f8f7f4`, `start_url: index.html`, `scope: .` (relative, so any deploy sub-path works) |
| `icons/icon-192.png`, `icons/icon-512.png` | Install icons (192×192 and 512×512) |
| `icons/icon-maskable-512.png` | Maskable 512×512 icon for Android adaptive icons |
| `icons/apple-touch-icon.png` | 180×180 icon for iPhone/iPad "Add to Home Screen" |
| `favicon.svg` | Vector favicon with the same VC monogram |
| `scripts/generate-pwa-icons.cjs` | Dependency-free generator for the icons above (`node scripts/generate-pwa-icons.cjs`); re-run it if brand colours ever change |
| `sw.js` | Minimal, safety-first service worker (app shell only) |
| `pwa.js` | Service-worker registration + honest install UI |
| `tests/pwa.test.cjs` | Focused PWA tests (manifest, icons, SW safety, install UI) |

All customer-facing pages (`index`, `shop`, `product`, `search`, `auth`,
`checkout`, `orders`) link the manifest, icons, theme-color metadata and
`pwa.js`. The homepage footer ("THE DETAILS" column) gained an **Install app**
button, hidden until the browser can act on it. `admin.html` deliberately has
**no** manifest link, install button, or service-worker registration.

## HTTPS: development vs deployment

- Browsers only allow service workers and PWA installation on a **secure
  context**. During development, **localhost is suitable**: `http://localhost`
  (or `http://127.0.0.1`) is treated as secure, so the full PWA works locally.
- A **publicly deployed site must be served over HTTPS** (`https://…`). Every
  mainstream host (GitHub Pages, Netlify, Vercel, Cloudflare Pages, Firebase
  Hosting, any TLS-terminating reverse proxy) provides this. `pwa.js` refuses
  to register the service worker on insecure non-localhost origins, so nothing
  breaks if you forget — you simply won't get install/offline behaviour.
- Serve `sw.js` and `manifest.webmanifest` with normal static-file headers
  (`text/javascript` / `application/manifest+json`). No special
  `Service-Worker-Allowed` header is needed because `sw.js` sits at the site
  root of this app.

## What the service worker caches — and what it never touches

Cached (public "app shell" only):

- The four public browsing pages (`index`, `shop`, `product`, `search`), their
  CSS/JS, the manifest, icons and favicon.
- Public Google Fonts files, so typography renders offline.
- Same-origin static images under `img/` at runtime (capped, trimmed list).

Never cached, always fresh from the network:

- **Admin** (`admin.html` and everything under `/admin`) — never intercepted,
  never stored, never registered on that page.
- **Checkout, orders and account pages** (`/checkout`, `/orders`, `/auth`) —
  navigations go network-only; offline, they show a branded "You're offline"
  notice instead of a stale page.
- **All Supabase traffic** (`*.supabase.co` — REST, Auth, Storage, Edge
  Functions, webhooks): on the never-cache host list, and any request carrying
  an `Authorization`/`apikey` header bypasses the worker entirely.
- **All Razorpay resources** (`checkout.razorpay.com`, `api.razorpay.com`,
  `*.razorpay.com`): on the never-cache host list.
- Any non-GET request (POST/PUT/DELETE are never intercepted).
- Product images served from Supabase Storage signed URLs (cross-origin) are
  not cached either, so signed URLs and private buckets stay untouched.

This means **inventory, pricing, orders, account data and cart state are never
stored by the service worker**, and there is deliberately **no offline checkout
or payment support**. Browsing the shell offline still works; live catalog
data requires a connection.

## Installing the app

- **Android (Chrome/Edge/Samsung Internet):** open the site, tap **Install
  app** in the footer (or the browser's ⋮ menu → *Install app* / *Add to
  Home screen*). Chromium also shows its own install prompt, which the footer
  button uses when available.
- **iPhone / iPad (Safari):** tap the **Share** button → **Add to Home
  Screen** → **Add**. iOS does not expose an automatic install prompt, so the
  footer button shows these written steps instead.
- **Desktop Chrome/Edge:** install icon in the address bar, or menu →
  *Install VC Fashion*. **Firefox and other browsers** without the prompt API
  get written instructions from the same button — the site never pretends
  every browser supports the same install flow.

## Updating caches after deployment

The cache is versioned (`vc-fashion-shell-v1`, …). When you ship changes to
`sw.js` (bump `VERSION`), the new worker installs the fresh shell and the
`activate` step deletes all older `vc-fashion-*` caches. HTML is served
network-first, so customers see updates on their next online visit without
manual cache clearing.

## Manual steps after deploying

1. Deploy the new files together: `manifest.webmanifest`, `sw.js`, `pwa.js`,
   `favicon.svg`, the `icons/` folder, and the updated HTML pages.
2. Verify the site loads over HTTPS and that DevTools → Application →
   Manifest shows no errors (icons, start URL, service worker "activated").
3. No Supabase, Razorpay, environment or storage-key changes are required.

Run the tests with: `node --test tests/*.test.cjs`
