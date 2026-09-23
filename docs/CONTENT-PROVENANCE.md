# Content provenance

The code in this repository is MIT licensed (see `LICENSE`). This file
records where bundled non-code content comes from. It notes what has **not**
been independently verified instead of claiming more than is known.

| Content | Location | Provenance | Status |
| --- | --- | --- | --- |
| Three starter passages ("Quiet Streets", "Clear Morning", "Small Project") | `backend/app/storage.py` (`BUILTIN_MATERIAL_PACK`) | Bundled in this repository, labeled "Just Talk original" in the data | Authorship not independently verified |
| Phoneme guide descriptions and coaching tips | `frontend/src/components/PhonemeGuideData.ts` | Added in this repository | Authorship and third-party overlap not verified |
| Example import pack | `docs/materials/custom-pack.example.json` | Project example | Same as the starter passages |
| Favicon | `frontend/public/favicon.svg` | Project asset | Origin not recorded |
| iOS app icon and splash images | `frontend/ios/App/App/Assets.xcassets/` | Capacitor-generated or project assets | Origin not recorded |

Third-party course text or audio is not bundled. Users who import material
are responsible for having the right to use it.

Runtime dependencies keep their own licenses. The Azure Speech SDK
(`azure-cognitiveservices-speech`) is distributed by Microsoft under its own
license terms. It is installed from PyPI and not vendored here.
