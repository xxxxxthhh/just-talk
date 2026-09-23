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
  belongs to your anonymous visitor ID.

## Identity

- No account, email address, or name is collected.
- Starting a session sets an HttpOnly cookie with a random token. The server
  stores only a hash of that token.
- The app does not save your IP address to the practice databases. It keeps
  an in-memory counter per network address, for up to an hour, to limit how
  many new sessions one address can start. The counter is not used to
  identify people and is lost on restart.

## Retention and deletion

- **Delete my data** in the app deletes your practice database and clears
  the cookie immediately.
- Visitor data is deleted automatically after 7 days without use. Cleanup
  runs about every 10 minutes.
- Usage counters are kept for about 70 days to enforce daily and monthly
  limits. When you delete your data, your counters are detached from your
  visitor ID. They still count toward site-wide totals.

## Third parties

- **Microsoft Azure AI Speech** processes recordings and text for scoring and
  speech synthesis under Microsoft's terms.
- **Cloudflare** carries traffic to the server.

Both providers may keep their own logs, including IP addresses and request
metadata. Just Talk cannot control or delete those logs.

## Limits

The trial is free and rate limited. When a daily or monthly allowance is used
up, scoring and playback pause until the allowance resets (00:00 UTC for daily
limits, the 1st of the month for monthly limits).
