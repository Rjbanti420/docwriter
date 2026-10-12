# DocWriter

A writing app for novelists/worldbuilders. You keep writing in Word (or anywhere) and
**paste one chapter at a time**. The app stores the text as a linked viewer, scans it for
names, and triages them into a typed, cross-linked **worldbible**. It gets quieter the
more you use it: once a name is known, future mentions are linked silently.

## Stack

- **Backend:** Node + Express + built-in `node:sqlite` (no native deps). API on `:5178`.
- **Frontend:** React + TypeScript + Vite. Dev server on `:5173`, proxies `/api`.
- **Data:** `data/docwriter.db` (one SQLite file per book). Delete the `data/` folder to reset.

## Run

```bash
npm install
npm run dev      # starts API + web together
```

Then open http://localhost:5173 — a demo chapter is pre-loaded so you can see the loop.

Other scripts: `npm run build` (production bundle), `npm start` (serve the built app + API
from `:5178` alone).

Set `DOCWRITER_DB=/path/to/copy.db` to point the server at another project file (used by the
tests so they never touch your real data).

## The loop

```
PASTE a chapter → store revision → detect candidates
  ├─ new name?  → triage (Accept / Later / Ignore)
  │                Accept  → Entity + Mentions created
  │                Later   → Review › New names
  │                Ignore  → silent forever (ignored_tokens)
  ├─ known name? → auto-link, add Mention (silent)
  └─ tracked trails → Review › Trail alerts (reappeared / dormant)
```

- **One entity per name.** First appearance creates the card; later appearances just add
  mentions. No duplicates.
- **Look-alikes are always asked.** A candidate close to an existing name (`Kaelen` vs
  `Kael`) shows a "same thing / different" prompt. "Same thing" stores it as an alias.
- **Triage is keyboard-first:** `Enter` accept, `1–9` accept as type, `←/→` change type,
  `L` later, `X` ignore, `Esc` close.
- **Review** is one inbox with four tabs: *New names*, *Trail alerts*, *Rejected*, *Trash*.
- **Tracking** is opt-in per entity: `off` / `reappearance` / `absence`, each with a manual
  required gap threshold.
- **Delete chapter** cascades its mentions/scans/alerts and asks keep-gap vs renumber. A card
  that loses its only appearance is moved to **Trash**, not destroyed (recoverable).

## Cutting the noise

Capitalised common words ("Then", "Rain", "Hearing") used to flood triage. Two filters now
keep the queue short:

1. **Dictionary filter.** A bundled ~275k-word English list suppresses words that are plainly
   common (with simple inflections and contractions, so "looking"/"didn't" are caught). It is
   used as a *demotion* signal, never a hard drop, so a real name that is also a word
   (`Grace`, `Rose`) is never lost.
2. **Signal gating.** A candidate is only *primary* if it has a real reason to be a name:
   dialogue attribution (`Kael said` / `said Kael`), a type keyword (`Order`, `River`), an
   unusual non-dictionary token, or enough repetition. Weak candidates are **demoted** and
   hidden behind **"Show more low-confidence"** — still one click away, so nothing is buried
   completely.

Names are ranked by confidence, primary first. Punctuation breaks name groups, so
`"Nodding, Ash said"` correctly links `Ash` rather than inventing "Nodding Ash".

**Rejected** lists everything you've ignored, with a *Restore* button if you change your mind.
**Trash** lists cards orphaned by chapter deletion, with *Restore* and *Delete forever*.

## What's implemented (first slice)

Paste → detect → triage → typed entities + mentions, the reader with colored underlines
for known entities and dotted underlines for un-triaged names, Review inbox (New names /
Trail alerts / Rejected / Trash), precision-first detection with dictionary + signal tiers,
trail alerts, entity cards (type, summary, aliases, tracking, threshold), editable chapter
text with rescan, chapter delete with gap/renumber and orphan-to-Trash, manual entity creation.

## Deferred / not yet built

- Semantic detection of "same name, **different** thing" (a person and a city both named
  `Raven`). Only typo/variant look-alikes are prompted today; add a manual "split mention
  into a new entity" action.
- Undo (the `Z` key) for triage decisions.
- Type-specific custom fields in the UI (schema `fields` JSON exists, no editor yet).
- Relationship/link editing and graph views (the `Link` seam isn't wired yet).
- Global find-and-replace back into Word.
