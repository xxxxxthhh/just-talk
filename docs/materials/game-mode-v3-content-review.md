# Game Mode v3 content review

**Revision:** r1 · 2026-10-08 · new rows drafted with AI assistance

**Status:** All 60 rows of revision r1 approved by the owner on 2026-10-08 (see Owner decisions).

This table is the approved v3 starter pack:

- **Pack shape:** five sounds × three stages × four items, 60 rows in total.
- **Existing rows (30):** copied unchanged from the v2 `frontend/src/game/starterPack.json`.
- **New rows (30):** two per stage for each sound, drafted with AI assistance.

**Nothing in this file is loaded at runtime.** The approved rows are integrated word for word into `frontend/src/game/starterPack.json` and the backend `GAME_STARTER_TEXTS` allowlist. `frontend/src/game/starterPack.test.ts` checks that the runtime pack matches this table. Editing a row's wording after approval sends it back for review before it ships.

Column meanings:

- **Position** gives where the target sound falls inside the target word, not where that word falls in the sentence.
- **Status** records the owner's approval of revision r1. Before approval, existing rows read "Awaiting owner review of wording and target sounds" and new rows read "Draft — awaiting owner review".

| ID | Existing/new | Phoneme | Stage | Text | targetWord | Position | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| theta-warmup-1 | existing | θ | warmup | thin | thin | initial |Approved (r1, 2026-10-08) |
| theta-warmup-2 | existing | θ | warmup | thick | thick | initial |Approved (r1, 2026-10-08) |
| theta-warmup-3 | new | θ | warmup | thumb | thumb | initial |Approved (r1, 2026-10-08) |
| theta-warmup-4 | new | θ | warmup | thing | thing | initial |Approved (r1, 2026-10-08) |
| theta-focus-1 | existing | θ | focus | think | think | initial |Approved (r1, 2026-10-08) |
| theta-focus-2 | existing | θ | focus | thank | thank | initial |Approved (r1, 2026-10-08) |
| theta-focus-3 | new | θ | focus | three | three | initial (cluster θɹ) |Approved (r1, 2026-10-08) |
| theta-focus-4 | new | θ | focus | teeth | teeth | final |Approved (r1, 2026-10-08) |
| theta-context-1 | existing | θ | context | I think we can walk home now. | think | initial |Approved (r1, 2026-10-08) |
| theta-context-2 | existing | θ | context | The narrow path leads to our house. | path | final |Approved (r1, 2026-10-08) |
| theta-context-3 | new | θ | context | We bought three tickets for the show. | three | initial (cluster θɹ) |Approved (r1, 2026-10-08) |
| theta-context-4 | new | θ | context | Both cups of tea are still hot. | both | final |Approved (r1, 2026-10-08) |
| eth-warmup-1 | existing | ð | warmup | this | this | initial |Approved (r1, 2026-10-08) |
| eth-warmup-2 | existing | ð | warmup | that | that | initial |Approved (r1, 2026-10-08) |
| eth-warmup-3 | new | ð | warmup | they | they | initial |Approved (r1, 2026-10-08) |
| eth-warmup-4 | new | ð | warmup | then | then | initial |Approved (r1, 2026-10-08) |
| eth-focus-1 | existing | ð | focus | these | these | initial |Approved (r1, 2026-10-08) |
| eth-focus-2 | existing | ð | focus | those | those | initial |Approved (r1, 2026-10-08) |
| eth-focus-3 | new | ð | focus | weather | weather | medial |Approved (r1, 2026-10-08) |
| eth-focus-4 | new | ð | focus | breathe | breathe | final |Approved (r1, 2026-10-08) |
| eth-context-1 | existing | ð | context | These little birds wait by the window. | these | initial |Approved (r1, 2026-10-08) |
| eth-context-2 | existing | ð | context | My brother walks home after the rain. | brother | medial |Approved (r1, 2026-10-08) |
| eth-context-3 | new | ð | context | The weather turned cold after lunch. | weather | medial |Approved (r1, 2026-10-08) |
| eth-context-4 | new | ð | context | We cooked dinner together last night. | together | medial |Approved (r1, 2026-10-08) |
| r-warmup-1 | existing | ɹ | warmup | rain | rain | initial |Approved (r1, 2026-10-08) |
| r-warmup-2 | existing | ɹ | warmup | red | red | initial |Approved (r1, 2026-10-08) |
| r-warmup-3 | new | ɹ | warmup | rice | rice | initial |Approved (r1, 2026-10-08) |
| r-warmup-4 | new | ɹ | warmup | rock | rock | initial |Approved (r1, 2026-10-08) |
| r-focus-1 | existing | ɹ | focus | room | room | initial |Approved (r1, 2026-10-08) |
| r-focus-2 | existing | ɹ | focus | road | road | initial |Approved (r1, 2026-10-08) |
| r-focus-3 | new | ɹ | focus | right | right | initial |Approved (r1, 2026-10-08) |
| r-focus-4 | new | ɹ | focus | green | green | initial (cluster ɡɹ) |Approved (r1, 2026-10-08) |
| r-context-1 | existing | ɹ | context | This room feels warm in the morning. | room | initial |Approved (r1, 2026-10-08) |
| r-context-2 | existing | ɹ | context | A river runs beside the quiet town. | river | initial |Approved (r1, 2026-10-08) |
| r-context-3 | new | ɹ | context | Turn right at the next corner. | right | initial |Approved (r1, 2026-10-08) |
| r-context-4 | new | ɹ | context | She wrote her friend a card. | wrote | initial (spelled wr) |Approved (r1, 2026-10-08) |
| l-warmup-1 | existing | l | warmup | light | light | initial |Approved (r1, 2026-10-08) |
| l-warmup-2 | existing | l | warmup | leaf | leaf | initial |Approved (r1, 2026-10-08) |
| l-warmup-3 | new | l | warmup | lamp | lamp | initial |Approved (r1, 2026-10-08) |
| l-warmup-4 | new | l | warmup | lip | lip | initial |Approved (r1, 2026-10-08) |
| l-focus-1 | existing | l | focus | late | late | initial |Approved (r1, 2026-10-08) |
| l-focus-2 | existing | l | focus | long | long | initial |Approved (r1, 2026-10-08) |
| l-focus-3 | new | l | focus | listen | listen | initial |Approved (r1, 2026-10-08) |
| l-focus-4 | new | l | focus | yellow | yellow | medial |Approved (r1, 2026-10-08) |
| l-context-1 | existing | l | context | We stayed late to finish our work. | late | initial |Approved (r1, 2026-10-08) |
| l-context-2 | existing | l | context | The lake looks calm in the morning. | lake | initial |Approved (r1, 2026-10-08) |
| l-context-3 | new | l | context | Please listen to the whole song. | listen | initial |Approved (r1, 2026-10-08) |
| l-context-4 | new | l | context | I left my bag on the bus. | left | initial |Approved (r1, 2026-10-08) |
| v-warmup-1 | existing | v | warmup | vine | vine | initial |Approved (r1, 2026-10-08) |
| v-warmup-2 | existing | v | warmup | van | van | initial |Approved (r1, 2026-10-08) |
| v-warmup-3 | new | v | warmup | vest | vest | initial |Approved (r1, 2026-10-08) |
| v-warmup-4 | new | v | warmup | vote | vote | initial |Approved (r1, 2026-10-08) |
| v-focus-1 | existing | v | focus | voice | voice | initial |Approved (r1, 2026-10-08) |
| v-focus-2 | existing | v | focus | visit | visit | initial |Approved (r1, 2026-10-08) |
| v-focus-3 | new | v | focus | very | very | initial |Approved (r1, 2026-10-08) |
| v-focus-4 | new | v | focus | seven | seven | medial |Approved (r1, 2026-10-08) |
| v-context-1 | existing | v | context | Her voice sounds clear across the room. | voice | initial |Approved (r1, 2026-10-08) |
| v-context-2 | existing | v | context | We save fresh bread for the morning. | save | final |Approved (r1, 2026-10-08) |
| v-context-3 | new | v | context | We wake up at seven each day. | seven | medial |Approved (r1, 2026-10-08) |
| v-context-4 | new | v | context | They live in a small village. | village | initial |Approved (r1, 2026-10-08) |

## How the new rows were drafted

The new rows follow the shape of the shipped pack, which `frontend/src/game/runDeck.test.ts` also checks for:

- **Word rows** are one lowercase word, and `targetWord` is the same word.
- **Sentence rows** have 5–9 words, and `targetWord` appears in the sentence as a whole word.
- **Context pairs:** in each group, one sentence's target is also a focus word, and the other's is not in any word row. The new pairs repeat this. `context-3` reuses the new `focus-3` word, and `context-4` introduces a new word.
- **Uniqueness:** no new text repeats an existing text. No new target word repeats an existing target word in any group.
- **Originality:** the sentences are short everyday statements written for this pack, not quotations.

Whether each target sound is present was judged by pronunciation, not by spelling. These checks are AI judgments. They are not phonetic verification, and they don't stand in for the owner's review.

## Pronunciation assumptions

These were part of the reviewed revision r1.

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

All 60 rows were approved, so the runtime pack and allowlist now contain exactly these texts. A later wording change goes back for review before it ships.
