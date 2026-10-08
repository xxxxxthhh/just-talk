# Content provenance

The code in this repository is MIT licensed (see `LICENSE`). This file
records where bundled non-code content comes from. It notes what has **not**
been independently verified instead of claiming more than is known.

| Content | Location | Provenance | Status |
| --- | --- | --- | --- |
| Three starter passages ("Quiet Streets", "Clear Morning", "Small Project") | `backend/app/storage.py` (`BUILTIN_MATERIAL_PACK`) | Bundled in this repository, labeled "Just Talk original" in the data | Authorship not independently verified |
| Phoneme guide descriptions and coaching tips | `frontend/src/components/PhonemeGuideData.ts` | Added in this repository | Authorship and third-party overlap not verified |
| Game mode starter pack (60 words and sentences, 5 target sounds) | `frontend/src/game/starterPack.json`; same texts in `backend/app/main.py` (`GAME_STARTER_TEXTS`); review record in `docs/materials/game-mode-v3-content-review.md` | Project-original, drafted with AI assistance (the original 30, then 30 additions in revision r1) | Wording and target words approved by the owner for revision r1 on 2026-10-08. The AI pronunciation checks are not independent phonetic verification. A later wording change needs a new review |
| Example import pack | `docs/materials/custom-pack.example.json` | Project example | Same as the starter passages |
| Favicon | `frontend/public/favicon.svg` | Project asset | Origin not recorded |
| iOS app icon and splash images | `frontend/ios/App/App/Assets.xcassets/` | Capacitor-generated or project assets | Origin not recorded |

Third-party course text or audio is not bundled. Users who import material
are responsible for having the right to use it.

Runtime dependencies keep their own licenses. The Azure Speech SDK
(`azure-cognitiveservices-speech`) is distributed by Microsoft under its own
license terms. It is installed from PyPI and not vendored here.
