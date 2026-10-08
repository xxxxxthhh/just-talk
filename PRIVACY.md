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
- Game mode keeps four settings in your browser's local storage and never
  sends them to the server:
  - `jt.runBest.v1`: your best run score for each run type (Route 6, Route 12,
    Target 60, Target 85) and sound. On the public trial a best score expires
    7 days after it was last set. On a personal install it does not expire.
  - `jt.sfx`: sound effects on or off.
  - `jt.autoStop`: auto-stop on or off.
  - `jt.runConfig.v1`: the run type and Route length you last picked, stored
    as `{"selection": "route" | "target60" | "target85", "routeLength": 6 | 12}`.
    It is kept until you change it or delete your data. It only preselects
    the entry card; no run is saved or resumed from it.

  **Delete my data** also clears these four keys from this browser, after the
  server confirms the deletion.
- A **My words** run adds no browser storage. Its length choice and the words
  picked to revisit are held only in memory for that run, and it keeps no
  best score. Scoring a single word still updates that word's practice
  history in your word bank on the server, exactly as ordinary word practice
  does; a word that is not yet in the bank may be added. When the public
  trial's word bank is full, scores still count but new words are not saved.
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
