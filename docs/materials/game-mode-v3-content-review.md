# Game Mode v3 content review

**Revision:** r1 · 2026-10-08 · new rows drafted with AI assistance

**Status:** All 60 rows of revision r1 approved by the owner on 2026-10-08 (see Owner decisions).

This table proposes the v3 starter pack:

- **Pack shape:** five sounds × three stages × four items, 60 rows in total.
- **Existing rows (30):** copied unchanged from `frontend/src/game/starterPack.json`.
- **New rows (30):** two per stage for each sound. All are proposals.

**Nothing in this file is loaded at runtime.** The application still uses only the existing 30 items. New rows enter `starterPack.json`, the backend `GAME_STARTER_TEXTS` allowlist and their tests only after the owner approves the exact wording. A rejected or reworded row comes back for review. Editing a row after approval also sends it back for review.

Column meanings:

- **Position** gives where the target sound falls inside the target word, not where that word falls in the sentence.
- **Status** for existing rows keeps their recorded status from `docs/CONTENT-PROVENANCE.md`.

| ID | Existing/new | Phoneme | Stage | Text | targetWord | Position | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| theta-warmup-1 | existing | θ | warmup | thin | thin | initial | Awaiting owner review of wording and target sounds |
| theta-warmup-2 | existing | θ | warmup | thick | thick | initial | Awaiting owner review of wording and target sounds |
| theta-warmup-3 | new | θ | warmup | thumb | thumb | initial | Draft — awaiting owner review |
| theta-warmup-4 | new | θ | warmup | thing | thing | initial | Draft — awaiting owner review |
| theta-focus-1 | existing | θ | focus | think | think | initial | Awaiting owner review of wording and target sounds |
| theta-focus-2 | existing | θ | focus | thank | thank | initial | Awaiting owner review of wording and target sounds |
| theta-focus-3 | new | θ | focus | three | three | initial (cluster θɹ) | Draft — awaiting owner review |
| theta-focus-4 | new | θ | focus | teeth | teeth | final | Draft — awaiting owner review |
| theta-context-1 | existing | θ | context | I think we can walk home now. | think | initial | Awaiting owner review of wording and target sounds |
| theta-context-2 | existing | θ | context | The narrow path leads to our house. | path | final | Awaiting owner review of wording and target sounds |
| theta-context-3 | new | θ | context | We bought three tickets for the show. | three | initial (cluster θɹ) | Draft — awaiting owner review |
| theta-context-4 | new | θ | context | Both cups of tea are still hot. | both | final | Draft — awaiting owner review |
| eth-warmup-1 | existing | ð | warmup | this | this | initial | Awaiting owner review of wording and target sounds |
| eth-warmup-2 | existing | ð | warmup | that | that | initial | Awaiting owner review of wording and target sounds |
| eth-warmup-3 | new | ð | warmup | they | they | initial | Draft — awaiting owner review |
| eth-warmup-4 | new | ð | warmup | then | then | initial | Draft — awaiting owner review |
| eth-focus-1 | existing | ð | focus | these | these | initial | Awaiting owner review of wording and target sounds |
| eth-focus-2 | existing | ð | focus | those | those | initial | Awaiting owner review of wording and target sounds |
| eth-focus-3 | new | ð | focus | weather | weather | medial | Draft — awaiting owner review |
| eth-focus-4 | new | ð | focus | breathe | breathe | final | Draft — awaiting owner review |
| eth-context-1 | existing | ð | context | These little birds wait by the window. | these | initial | Awaiting owner review of wording and target sounds |
| eth-context-2 | existing | ð | context | My brother walks home after the rain. | brother | medial | Awaiting owner review of wording and target sounds |
| eth-context-3 | new | ð | context | The weather turned cold after lunch. | weather | medial | Draft — awaiting owner review |
| eth-context-4 | new | ð | context | We cooked dinner together last night. | together | medial | Draft — awaiting owner review |
| r-warmup-1 | existing | ɹ | warmup | rain | rain | initial | Awaiting owner review of wording and target sounds |
| r-warmup-2 | existing | ɹ | warmup | red | red | initial | Awaiting owner review of wording and target sounds |
| r-warmup-3 | new | ɹ | warmup | rice | rice | initial | Draft — awaiting owner review |
| r-warmup-4 | new | ɹ | warmup | rock | rock | initial | Draft — awaiting owner review |
| r-focus-1 | existing | ɹ | focus | room | room | initial | Awaiting owner review of wording and target sounds |
| r-focus-2 | existing | ɹ | focus | road | road | initial | Awaiting owner review of wording and target sounds |
| r-focus-3 | new | ɹ | focus | right | right | initial | Draft — awaiting owner review |
| r-focus-4 | new | ɹ | focus | green | green | initial (cluster ɡɹ) | Draft — awaiting owner review |
| r-context-1 | existing | ɹ | context | This room feels warm in the morning. | room | initial | Awaiting owner review of wording and target sounds |
| r-context-2 | existing | ɹ | context | A river runs beside the quiet town. | river | initial | Awaiting owner review of wording and target sounds |
| r-context-3 | new | ɹ | context | Turn right at the next corner. | right | initial | Draft — awaiting owner review |
| r-context-4 | new | ɹ | context | She wrote her friend a card. | wrote | initial (spelled wr) | Draft — awaiting owner review |
| l-warmup-1 | existing | l | warmup | light | light | initial | Awaiting owner review of wording and target sounds |
| l-warmup-2 | existing | l | warmup | leaf | leaf | initial | Awaiting owner review of wording and target sounds |
| l-warmup-3 | new | l | warmup | lamp | lamp | initial | Draft — awaiting owner review |
| l-warmup-4 | new | l | warmup | lip | lip | initial | Draft — awaiting owner review |
| l-focus-1 | existing | l | focus | late | late | initial | Awaiting owner review of wording and target sounds |
| l-focus-2 | existing | l | focus | long | long | initial | Awaiting owner review of wording and target sounds |
| l-focus-3 | new | l | focus | listen | listen | initial | Draft — awaiting owner review |
| l-focus-4 | new | l | focus | yellow | yellow | medial | Draft — awaiting owner review |
| l-context-1 | existing | l | context | We stayed late to finish our work. | late | initial | Awaiting owner review of wording and target sounds |
| l-context-2 | existing | l | context | The lake looks calm in the morning. | lake | initial | Awaiting owner review of wording and target sounds |
| l-context-3 | new | l | context | Please listen to the whole song. | listen | initial | Draft — awaiting owner review |
| l-context-4 | new | l | context | I left my bag on the bus. | left | initial | Draft — awaiting owner review |
| v-warmup-1 | existing | v | warmup | vine | vine | initial | Awaiting owner review of wording and target sounds |
| v-warmup-2 | existing | v | warmup | van | van | initial | Awaiting owner review of wording and target sounds |
| v-warmup-3 | new | v | warmup | vest | vest | initial | Draft — awaiting owner review |
| v-warmup-4 | new | v | warmup | vote | vote | initial | Draft — awaiting owner review |
| v-focus-1 | existing | v | focus | voice | voice | initial | Awaiting owner review of wording and target sounds |
| v-focus-2 | existing | v | focus | visit | visit | initial | Awaiting owner review of wording and target sounds |
| v-focus-3 | new | v | focus | very | very | initial | Draft — awaiting owner review |
| v-focus-4 | new | v | focus | seven | seven | medial | Draft — awaiting owner review |
| v-context-1 | existing | v | context | Her voice sounds clear across the room. | voice | initial | Awaiting owner review of wording and target sounds |
| v-context-2 | existing | v | context | We save fresh bread for the morning. | save | final | Awaiting owner review of wording and target sounds |
| v-context-3 | new | v | context | We wake up at seven each day. | seven | medial | Draft — awaiting owner review |
| v-context-4 | new | v | context | They live in a small village. | village | initial | Draft — awaiting owner review |

## How the new rows were drafted

The new rows follow the shape of the shipped pack, which `frontend/src/game/runDeck.test.ts` also checks for:

- **Word rows** are one lowercase word, and `targetWord` is the same word.
- **Sentence rows** have 5–9 words, and `targetWord` appears in the sentence as a whole word.
- **Context pairs:** in each group, one sentence's target is also a focus word, and the other's is not in any word row. The new pairs repeat this. `context-3` reuses the new `focus-3` word, and `context-4` introduces a new word.
- **Uniqueness:** no new text repeats an existing text. No new target word repeats an existing target word in any group.
- **Originality:** the sentences are short everyday statements written for this pack, not quotations.

Whether each target sound is present was judged by pronunciation, not by spelling. These checks are AI judgments. They are not phonetic verification, and they don't stand in for the owner's review.

## Assumptions to confirm

- **Accent:** the reference voice is a General American or Southern British standard accent.
- **ɹ (all r rows):** every target is prevocalic, so the ɹ is pronounced in both rhotic and non-rhotic accents. Word-final or pre-consonantal r is never the target. "Turn" and "corner" in `r-context-3` contain such an r only in rhotic accents, and they are not targets.
- **r-context-4:** "wrote" starts with ɹ; the w is silent. Spelling is not the guide here. "Write" was rejected as a target because it sounds the same as `r-focus-3` "right".
- **θ/ð spelling:** "th" is judged by sound:
  - **θ:** thumb, thing, three, teeth, both.
  - **ð:** they, then, weather, breathe, together.
  - **breathe:** `eth-focus-4` is the verb, which ends in ð. The noun "breath" ends in θ and is not used.
  - **Avoided:** "with" (speakers vary between θ and ð) and "mouth" (θ as a noun, ð as a verb).
- **theta-focus-3 / theta-context-3:** "three" starts with the θɹ cluster. That is harder than a single θ, which is why it sits in Focus rather than Warm-up.
- **l (all l rows):** every target l is before a vowel (clear l). Dark l appears only in non-target words ("whole", "still", "small").
- **v (all v rows):** no target is a weak-form function word. "Of" in `theta-context-4` is not a target.
- **Words from other groups:** sentences contain sounds from other groups, as the existing ones do. Examples are "The" and "They" (ð) in θ and v sentences. Only the listed `targetWord` is the target.

## Owner decisions

Fill this in during review. Record each decision by ID against revision r1. Approval covers the exact wording in this revision.

| ID(s) | Decision (approved / reworded / rejected) | Final wording or correction | Owner and date |
| --- | --- | --- | --- |
| All 60 rows (r1) | Approved | Unchanged from r1 | Owner, 2026-10-08 (approved in chat with the lead: "通过") |

Runtime integration waits until all 60 rows are approved. Rows that are reworded or rejected go back for review before then. A partial approval is not reported as "60 approved".
