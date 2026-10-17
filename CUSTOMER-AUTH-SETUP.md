# VC Fashion customer authentication setup

The customer UI uses the existing `window.FORME_SUPABASE` client. It does not
create another Supabase client or contain provider credentials. Email, SMS, and
Google authentication must be enabled and configured in the Supabase dashboard
before those flows can be verified against a real account.

## 1. Configure site and redirect URLs

In **Supabase Dashboard → Authentication → URL Configuration**:

1. Set **Site URL** to the production storefront origin, for example
   `https://<your-store-domain>`.
2. Add the deployed callback `https://<your-store-domain>/auth.html` to
   **Redirect URLs**.
3. Add each exact development callback you use, such as
   `http://localhost:<port>/auth.html`. Do not use a broad wildcard in
   production.
4. Serve the site over HTTP(S); OAuth cannot complete from a `file:` URL.
5. Keep the frontend configuration limited to the project URL and a
   publishable/anon key. Never place a service-role key in browser code.

The app sets `emailRedirectTo` for email confirmation, `redirectTo` for password
recovery, and an OAuth `redirectTo` on the same `auth.html` callback. All
successful return destinations are restricted to the current origin.

## 2. Email confirmation and password recovery

In **Authentication → Providers → Email**, enable email/password sign-in and
choose whether email confirmation is required. If confirmation is enabled,
configure the confirmation email template to use Supabase's confirmation URL
flow and ensure the `auth.html` redirect above is allowed.

In **Authentication → URL Configuration**, keep the production site URL and
callback allowlist current for both confirmation and recovery. The app asks
Supabase to return password recovery to `auth.html?mode=reset`; the email link
must preserve Supabase's recovery token/code parameters. Test with a dedicated
test account after dashboard configuration.

## 3. Phone OTP and SMS delivery

In **Authentication → Providers → Phone**:

1. Enable phone sign-in and phone OTP.
2. Select and configure an SMS provider supported by Supabase (for example,
   Twilio) using credentials supplied directly in the dashboard.
3. Configure the provider's sender/service details and any required sender
   registration, regional permissions, and billing.
4. Configure OTP expiry and rate limits appropriate for the store.
5. Use only test numbers/provider sandbox features until production SMS is
   approved.

Credentials are entered manually in Supabase and must not be copied into
`auth.js` or any other frontend file. The site reports a code as sent only after
Supabase's OTP request succeeds.

## 4. Google OAuth

In Google Cloud Console, create an OAuth client for the appropriate web
application. Set authorized JavaScript origins to the deployed storefront
origin(s), and set the authorized redirect URI to:

`https://<project-ref>.supabase.co/auth/v1/callback`

Then in **Supabase Dashboard → Authentication → Providers → Google**, enable
Google, enter the Google client ID and client secret directly in the dashboard,
and save. The app callback, such as `https://<your-store-domain>/auth.html`,
must also be present in Supabase's **Redirect URLs** allowlist.

Use placeholders above only as setup examples; replace them with the actual
domain and project reference in dashboard settings. Google sign-in is not
available until the provider is enabled and configured.

## 5. Customer data access and RLS

Keep Row Level Security enabled for customer-owned tables. The existing
`checkout-order-rpc.sql` defines read policies for `orders` where
`user_id = auth.uid()` and for `order_items` through the owning order. Confirm
these policies have been reviewed and applied in the target Supabase project;
the browser's user-ID filters are not a substitute for database authorization.

Any future customer profile table should have RLS enabled and policies scoped
to `auth.uid()` for both reads and writes. Do not add policies that allow a
customer to read or modify another user's data. Keep administrator access
separate and continue to require the existing server-side `is_admin` check for
admin functionality.
