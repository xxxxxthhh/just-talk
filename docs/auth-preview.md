# Google login and isolated preview

Google login is implemented for public mode only. Personal/local/iOS builds
retain their existing behavior. The server uses the stateless Supabase Auth
`GET /auth/v1/user` endpoint on every private request (the online verification
used by `auth.get_user(jwt)`), requires a non-anonymous user with a Google
identity, and maps its UUID to a local SQLite practice store. No practice data
moves to Supabase Postgres. Missing, invalid or expired authentication cannot
reach Azure scoring/TTS. Public LLM features remain disabled.

The browser uses `@supabase/supabase-js` 2.117.2, PKCE, a fixed same-origin `/`
redirect, automatic session refresh and authenticated fetch/blob export.
Runtime `/api/health` supplies only the project origin and publishable key.
The server refuses secret/service-role keys in that public config. CSP adds
only the configured Supabase origin to `connect-src`.

## Required provider setup

1. Create a dedicated **JustTalk** Supabase project in the user's chosen
   organization after verifying the form's plan, cost and capacity. Do not
   restore/reuse the unrelated paused projects. Database-password entry and
   final project creation remain separate authorized setup actions.
2. In Google Auth Platform configure a Web application OAuth client. Add the
   preview's exact origin as an authorized JavaScript origin, and
   `https://<project-ref>.supabase.co/auth/v1/callback` as its authorized redirect
   URI. Configure branding/consent and test users if Google's app is in testing.
3. Put the Google client ID/secret in Supabase's Google provider settings;
   enable Google. Disable anonymous sign-ins and other unused login providers.
   Google secrets belong only in the provider configuration, never Just Talk.
4. Set Supabase Auth's Site URL to the chosen preview origin; add the exact
   `https://<preview-host>/` URL to its redirect allowlist (no broad wildcard).
   For a same-machine preview, optionally permit `http://127.0.0.1:8765/`.
5. Set only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the preview's
   private server environment. The existing app-funded Azure key stays server
   side. Use the existing authorized secret handling process; no secret enters
   source control or a frontend build variable.

## Preview deployment boundary

Build a separate image/instance with its own practice and usage volume, exact
allowed origin and the same app-funded quota values. Keep one worker. Never
mount production's visitor/account databases into the preview or reset the
production ledger. A separate preview ledger allows additional Azure usage;
choose explicitly bounded preview global allowances before enabling scoring.

The existing public host has no pre-existing Supabase config. Its production
service/tunnel must not be replaced. A new public preview hostname or route
requires identifying and approving that routing change if no existing preview
route is available; do not create tunnel credentials or relax host firewall
rules as a workaround. A loopback-only preview on the user's Mac requires no
production or provider mutation and shows setup pending until configured.

## Quota and deletion semantics

`PUBLIC_VISITOR_*` env names and `visitor_day` JSON scope remain compatible;
these now apply to the stable account ID. Default account caps are 180 scoring
seconds, 1000 TTS characters, 20 scoring requests and 40 TTS requests daily
(UTC). Atomic reservation, global day/month caps, request caps and the Azure
concurrency semaphore are retained. Cached TTS consumes no additional Azure
usage; private cache is account scoped.

`DELETE /api/me` deletes only practice data and returns `quota_retained: true`.
It blocks new uses while waiting for active requests; if they cannot finish
within five seconds, it returns 409 and leaves data intact. Account quota rows
retain their user ID for about 70 days. Relogin, data deletion, practice TTL
and restart cannot reset them. Supabase account deletion is not exposed by
this app; deleting/recreating an Auth user can change the UUID and must not
be used to reset account quotas. Shared global caps still protect that case.
Old anonymous stores retain their original TTL cleanup; they cannot be used
or attached to a Google account.

## Verification and remaining live check

Automated tests use fake Supabase/Azure responses, including no-token and old
cookie rejection with zero Azure calls, cross-browser identity, account
isolation, deletion/restart persistence, TTL, atomic parallel caps, TTS cache,
CSP, session changes and in-flight download cancellation. They are not a real
Google login end-to-end test.

After provider and route setup, verify on the actual preview: Google selection,
callback, sign-out/relogin, the same quota in two browsers, authenticated JSON
backup, expired-session UI, and one explicitly authorized live score/TTS.

Official references checked 2026-10-01:

- https://supabase.com/changelog.md
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/reference/python/auth-getuser

Recent breaking changes in the changelog concern self-hosted Auth external
URLs or unrelated Postgres/management features; this implementation uses
hosted Auth's supported user endpoint and current supabase-js.
