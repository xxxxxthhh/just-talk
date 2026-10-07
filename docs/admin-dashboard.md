# Owner trial dashboard

Public mode provides `/admin` and `GET /api/admin/users`. Access is disabled by
default. After approving a specific verified owner account, set
`PUBLIC_ADMIN_USER_ID` to its Supabase UUID in the server environment. Invalid
UUIDs fail startup. Remove the setting and restart to remove the grant. Personal
mode has no admin API. Neither email nor user-editable metadata authorizes access.

Every admin request uses existing online Supabase verification and requires a
non-anonymous Google identity matching the configured owner ID. Ordinary users
get 403; missing, invalid or expired tokens get 401. The UI checks server-provided
access before mounting and clears summaries on logout/account change. Pending
requests are aborted; successful responses use `Cache-Control: no-store`.

## Metrics and privacy

The report reads local identity metadata and aggregate usage only. It never
opens any user's practice database. Recordings, text, transcripts, scores,
vocabulary and materials are not included. There are no editing actions.

- **User / registered:** account ID, email and Auth account creation time from an
  online verified Auth response. Existing emails and registration dates appear
  after the account's next ordinary app request on this version. Missing dates
  are unavailable; local first-seen time is not substituted for registration.
- **Last activity:** latest retained authenticated ordinary app request or usage
  attempt, not last Google sign-in. Admin views do not update activity or restore
  expired practice files.
- **Measured scoring audio:** decoded uploaded recording duration in milliseconds
  for successful scoring calls, including no-match results. It includes silence;
  it is neither speaking-only time nor time on site. This field begins on this
  version. Earlier successful requests have unknown duration, counted separately
  rather than reconstructed from rounded quota units.
- **Attempts / quota charged:** unreleased reservations, including failed or
  unfinished calls. Quota rounds each recording up to seconds. Measurement does
  not change enforcement or refunds.
- **Listening use:** conservatively charged characters and synthesis attempts.
  Cached playback creates no new synthesis request and is not counted.

Periods are seven UTC calendar days including today, the current UTC month, and
retained history. Identity summaries and ledger rows retain the existing roughly
70-day window; recorded history is not a lifetime total. Practice deletion and
expiry leave usage intact. The report does not combine other deployments.

## Coverage and deployment

This lists accounts observed by this application, not the complete live Supabase
Auth catalog. Accounts that never opened the app may be absent; deleted or expired
profiles may appear as IDs during ledger retention. A complete Auth catalog would
require a further privileged integration. This implementation retrieves no admin
key, grants no access to `auth.users`, and requires no Supabase schema change.

Deployment adds a nullable `audio_duration_ms` field and minimal identity and
measurement metadata tables to the local ledger. The idempotent migration
preserves existing attempts and caps. The old image remains compatible with the
additive schema but does not record measured duration. Back up the identity and
usage databases before approved deployment. Preserve trial caps and practice data.

The sign-in disclosure explains owner visibility, retention, and the absence of
site-time tracking. Persistent owner authorization and deployment need approval.

## Verification

Tests cover anonymous/ordinary/expired identities, verification outages, forged
metadata, owner-only access, historical missing duration, migration, quota caps,
date windows, failed/released attempts, deletion and retention. A privacy test
fails if an admin query opens any `SessionStore` connection. Frontend tests cover
restricted routes, absent practice requests on the admin route, permission loss,
aborted/late requests, logout and missing data.

Browser review uses fictional users and simulated responses; it is not a new
Google OAuth or real administrator end-to-end verification.
