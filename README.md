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
- **Review** is one inbox with two tabs: *New names* and *Trail alerts*.
- **Tracking** is opt-in per entity: `off` / `reappearance` / `absence`, each with a manual
  required gap threshold.
- **Delete chapter** cascades its mentions/scans/alerts, asks keep-gap vs renumber, and
  never deletes a card that still has notes (unreferenced cards are flagged instead).

## What's implemented (first slice)

Paste → detect → triage → typed entities + mentions, the reader with colored underlines
for known entities and dotted underlines for un-triaged names, Review inbox, trail alerts,
entity cards (type, summary, aliases, tracking, threshold), editable chapter text with
rescan, chapter delete with gap/renumber, manual entity creation.

## Deferred / not yet built

- Semantic detection of "same name, **different** thing" (a person and a city both named
  `Raven`). Only typo/variant look-alikes are prompted today; add a manual "split mention
  into a new entity" action.
- Undo (the `Z` key) for triage decisions.
- Type-specific custom fields in the UI (schema `fields` JSON exists, no editor yet).
- Relationship/link editing and graph views (the `Link` seam isn't wired yet).
- Global find-and-replace back into Word.
