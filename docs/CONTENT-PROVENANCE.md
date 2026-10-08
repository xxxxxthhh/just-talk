# Content provenance

The code in this repository is MIT licensed (see `LICENSE`). This file
records where bundled non-code content comes from. It notes what has **not**
been independently verified instead of claiming more than is known.

| Content | Location | Provenance | Status |
| --- | --- | --- | --- |
| Three starter passages ("Quiet Streets", "Clear Morning", "Small Project") | `backend/app/storage.py` (`BUILTIN_MATERIAL_PACK`) | Bundled in this repository, labeled "Just Talk original" in the data | Authorship not independently verified |
| Phoneme guide descriptions and coaching tips | `frontend/src/components/PhonemeGuideData.ts` | Added in this repository | Authorship and third-party overlap not verified |
| Game mode starter pack (30 words and sentences, 5 target sounds) | `frontend/src/game/starterPack.json`; same texts in `backend/app/main.py` (`GAME_STARTER_TEXTS`) | Project-original, drafted with AI assistance | Awaiting owner review of wording and target sounds |
| Game Mode v3 proposed starter additions (30 words and sentences, revision r1) | `docs/materials/game-mode-v3-content-review.md` only; not in `starterPack.json` or `GAME_STARTER_TEXTS`, not loaded at runtime | Project-original, drafted with AI assistance | Draft — awaiting owner review; enters the runtime pack only after approval |
| Example import pack | `docs/materials/custom-pack.example.json` | Project example | Same as the starter passages |
| Favicon | `frontend/public/favicon.svg` | Project asset | Origin not recorded |
| iOS app icon and splash images | `frontend/ios/App/App/Assets.xcassets/` | Capacitor-generated or project assets | Origin not recorded |

Third-party course text or audio is not bundled. Users who import material
are responsible for having the right to use it.

Runtime dependencies keep their own licenses. The Azure Speech SDK
(`azure-cognitiveservices-speech`) is distributed by Microsoft under its own
license terms. It is installed from PyPI and not vendored here.
