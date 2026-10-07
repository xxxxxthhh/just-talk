# Privacy

This describes what the hosted public trial of Just Talk does with your data.
If you run Just Talk yourself, your data stays on your own machine, except:

- audio and text sent to your own Azure AI Speech resource;
- if you enable the optional LLM features (passage check, drill generation),
  passage text and practice words sent to the LLM provider you configure.

The public trial never enables LLM features.

## What happens when you practice

- **Recordings.** Your browser uploads the recording to the Just Talk server.
  The server converts it to a 16 kHz WAV file in a temporary directory, sends
  that audio and the reference text to Microsoft Azure AI Speech for
  pronunciation scoring, and deletes the temporary files when the request
  finishes. Recordings are not kept by Just Talk.
- **Model audio.** When you play a passage or word, its text is sent to Azure
  Text to Speech. The generated audio is cached: for the built-in sample
  passages in a shared cache, and for any other text in your own practice
  database.
- **Practice data.** Reference text, scores, word- and sound-level results,
  saved words, and imported materials are stored in a database file that
  belongs to your verified Supabase account ID.

## Identity

- The hosted trial requires Google sign-in through Supabase Auth. Google and
  Supabase process account details (including email/name) for authentication.
- Just Talk's server verifies the Supabase access token on every private API
  request and uses the stable Supabase user ID to isolate practice data and
  enforce account quotas. It does not store your Google email or name locally.
- The browser stores Supabase authentication/session tokens so you stay signed
  in, and sends an access token in an Authorization header to Just Talk. Tokens
  are never put in export URLs. Sign out removes this browser's session and
  clears the practice interface, microphone recording and cached model audio.
- A new browser or clearing cookies does not give an existing account a new
  allowance. Anonymous visitor cookies are no longer accepted.

## Retention and deletion

- **Delete my data** deletes history, saved words, imported materials and
  private model audio after active practice requests finish. It does not
  delete your Google/Supabase account or reset your allowance.
- Practice data expires after 7 days without use (deployment configurable).
  Cleanup runs about every 10 minutes.
- Tutorial completion or dismissal is saved by account and guide version so it
  does not repeat in another browser. This preference lasts about 70 days
  without use, remains after deleting practice data, and can be reopened with
  “Tutorial”. It contains no audio or practice text.
- Account-linked usage records are retained for about 70 days to enforce
  daily/monthly limits even after practice deletion, logout, or expiry. Records
  contain account ID, timestamps, units and request outcome, not practice text
  or recordings. After retention, cleanup removes them.
- Existing anonymous data is not transferred to a Google account; it continues
  to expire under its original inactivity policy. Historical usage still counts
  toward the shared limits.
- Supabase account deletion is not offered in the practice-data control. Account
  deletion by an administrator and re-creation can produce a new user ID;
  shared site caps continue to apply. Do not treat practice deletion as account
  deletion or use account deletion as a quota-reset mechanism.

## Third parties

- **Microsoft Azure AI Speech** processes recordings and text for scoring and
  speech synthesis under Microsoft's terms.
- **Cloudflare** carries traffic to the server.
- **Google and Supabase Auth** provide account authentication.

These providers may keep their own logs, including IP addresses and request
metadata. Just Talk cannot control or delete those logs.

## Limits

The trial is free and rate limited. When a daily or monthly allowance is used
up, scoring and playback pause until the allowance resets (00:00 UTC for daily
limits, the 1st of the month for monthly limits).
