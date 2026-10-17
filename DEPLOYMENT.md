# Deploying VC Fashion to GitHub + Cloudflare Pages

This is a **checklist for you to execute** — nothing here has been run
automatically: no repository was created, nothing pushed, no deployment or
production configuration changed.

## 1. What is being deployed

- **Public website root:** the repository root itself — `index.html`,
  `sw.js`, `manifest.webmanifest`, `style.css`, `pwa.js`, `img/`, `icons/`
  and all other assets live directly in `C:\myportfolio\practise\day4\`.
  All links are relative, so the site works at any URL path.
- **Pure static site:** no `package.json`, no build step. Cloudflare Pages
  needs framework preset **None**, build command **empty**, output directory **`/`**.
- **Separately hosted backend:** the Supabase project
  (`atvybrhsrvpmldhdntht`) runs the database, auth, storage, and four Edge
  Functions. Cloudflare Pages only publishes static files (see §5).

## 2. Secret hygiene (enforced by `.gitignore`)

The frontend intentionally contains only the **publishable** Supabase key in
`supabase-config.js` (`sb_publishable_…`) — that is public by design, the
same as a Supabase anon key, and must stay in the repo for the site to work.

Never place these anywhere in this repository (`.gitignore` blocks the common
shapes: `.env*`, `service-role*`, `sb_secret_*`, `rzp_*`, `*.pem`, `*.key`):

| Secret | Where it lives |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function secrets only |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Supabase Edge Function secrets only |
| `RAZORPAY_WEBHOOK_SECRET` | Supabase Edge Function secrets + Razorpay dashboard |
| Database / dashboard passwords | Password managers, never files in the repo |

Also excluded as local-only: `_inspect.txt`, `debug.log`, `*.log`,
`.vscode/`, `.wrangler/`, `node_modules/`.
If a secret is ever committed, rotating it is the only real fix — revoking
and re-issuing beats trying to erase history.

## 3. Install Git (not currently installed on this machine)

`git` is not on your PATH (checked `Program Files`, `LocalAppData`, VS Code
locations). Install **Git for Windows**, then restart VS Code and verify:

```
git --version
```

## 4. Create the GitHub repository and push (you do this)

From PowerShell in the project root (or use VS Code's Source Control →
"Publish to GitHub"):

```
cd C:\myportfolio\practise\day4
git init
git add -A
git status
git commit -m "VC Fashion storefront with PWA, Supabase auth and Razorpay checkout"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git
git push -u origin main
```

In `git status`, confirm `_inspect.txt` and `debug.log` are **absent** —
that proves `.gitignore` is working before the first push.

## 5. Supabase Edge Functions are deployed SEPARATELY

Cloudflare Pages will **not** deploy `supabase/functions/`. Checkout and
payment depend on four Edge Functions that live on Supabase. Deploy them with
the Supabase CLI from this repo:

```
supabase login
supabase link --project-ref atvybrhsrvpmldhdntht
supabase functions deploy create-razorpay-order
supabase functions deploy verify-razorpay-payment
supabase functions deploy razorpay-webhook
supabase functions deploy claim-guest-order
```

- `supabase/config.toml` in this repo declares `verify_jwt` per function —
  use Supabase CLI v2+ so those flags are honoured at deploy time.
- Set the function secrets **in Supabase** (they are read via `Deno.env.get`,
  never from this repo):

```
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<value> RAZORPAY_KEY_ID=<value> RAZORPAY_KEY_SECRET=<value> RAZORPAY_WEBHOOK_SECRET=<value>
```

- Razorpay Dashboard → Webhooks → callback URL
  `https://atvybrhsrvpmldhdntht.supabase.co/functions/v1/razorpay-webhook`,
  secret = the same value as `RAZORPAY_WEBHOOK_SECRET`.

## 6. Database changes are also separate

Cloudflare Pages never touches Postgres. `supabase/migrations/*.sql` apply via
`supabase db push` (or the SQL editor); `supabase/proposals/*.sql` are
optional reviewed proposals; `checkout-order-rpc.sql` is a manual SQL script.
Nothing needs re-running if your project already has them.

## 7. Create the Cloudflare Pages site (dashboard — you do this)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** (grant the Cloudflare GitHub app access to the repo).
2. Build settings: framework preset **None**, build command **(empty)**,
   build output directory **`/`**.
3. **Environment variables: none needed.** The frontend reads no secrets; do
   not put the service-role key or Razorpay secrets in Pages — no page ever
   uses them, and adding them would only broaden exposure.
4. **Deploy.** Cloudflare provisions **HTTPS automatically**, which the PWA
   service worker requires (see `PWA-SETUP.md`; localhost was fine only for
   development).
5. Optional: attach a custom domain under the Pages project's
   **Custom domains**.

## 8. Post-deploy verification

1. Open the site over `https://…` — DevTools → Application → Manifest shows
   no errors and the service worker is *activated and running*.
2. Supabase Dashboard → Authentication → URL Configuration: set the production
   origin as **Site URL** and add `https://<your-domain>/auth.html` as an
   additional redirect URL; update Google OAuth authorized origins/redirect
   URIs. (The code derives all redirects from `window.location`, so only the
   dashboard side needs updating.)
3. Smoke test: browse → cart → wishlist → sign-in → checkout with Razorpay
   **test** keys → My Orders → admin sign-in.
4. Confirm GitHub shows no `_inspect.txt` / `debug.log` after the first push.
5. Note: `admin.html` source is public if the repo is public — that is
   expected. Its security comes from Supabase auth + the `is_admin` check +
   row-level security, not from the page being secret.

## 9. What was NOT done (per your instruction)

No GitHub repository was created, nothing was pushed, the site was not
deployed, and no production configuration was changed. All commands above are
waiting for you.

Run the test suite any time with: `node --test tests/*.test.cjs`

