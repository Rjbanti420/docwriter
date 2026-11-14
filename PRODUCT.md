# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user is the author themself, using DocWriter daily on their own books from an Electron desktop window. The product is also built to hold up for a novelist or worldbuilder who has never seen it.

The user's situation: they draft in Word or another editor and do not want to move the manuscript into a new app. They paste one chapter at a time into DocWriter to keep a trustworthy story bible beside the draft. Their job is to get names, places, organisations and items out of the prose and into typed cards — quickly, without duplicates — then get back to writing.

## Product Purpose

DocWriter is an offline paste-to-worldbible writing companion. You paste a chapter, it detects capitalised name candidates, and you triage them into a typed, cross-linked world bible stored in one SQLite file per book. Success means the bible stays accurate and complete as the manuscript grows, and the app becomes quieter the more it is used: known names are linked silently, and only genuinely new or ambiguous ones ask for a decision.

## Positioning

The mechanism a neighbouring note-taking or worldbuilding app could not copy: the manuscript stays in the writer's own editor, and DocWriter derives the bible from pasted chapter text with precision-first detection — dictionary demotion plus signal gating so "Then" and "Rain" never reach triage, while a real name that is also a common word never disappears. One entity per name, look-alikes always prompt for a same-thing/different decision, and every card keeps a mention trail back to the chapter text.

## Operating Context

- The writer drafts elsewhere and pastes a chapter at a time; DocWriter is a companion, not the primary word processor.
- Desktop-first: the shipping build is an Electron AppImage; the localhost web build is how the app is developed and tested.
- Fully offline and local. One SQLite file per book, openable from disk; no accounts, no sync, no cloud.
- Triage and the reader are keyboard-first by design (Enter, 1–9, arrows, L, X, Esc; arrow keys move between chapters).
- The demo book (`data/demo.db`, seeded by `server/seed-demo.mjs`) is the working large-book fixture, currently 133 entities across five types.
- Verification is `npm test` (node:test over `server/*.test.mjs`), `npx tsc --noEmit`, and `npm run build`; the API runs on `:5178` and vite on `:5173`.

## Capabilities and Constraints

Views: Read (chapter text with linked entity mentions), Review (New names / Trail alerts / Rejected / Trash inbox), Planning (Chekhov's guns, questions, duels), Timeline (map and story), Bible (typed entity cards), Settings.

Working capabilities:

- Paste → detect → triage → typed entity + mentions, with rescan on edited chapter text.
- Five built-in entity types: Character, Location, Country, Organisation, Item. Character has Abilities / System / History sections; Organisation, Location and Country share an editor.
- Aliases with a same-thing/different prompt on look-alike names, name-conflict handling on create and rename.
- Mention trails per entity; opt-in tracking (`off` / `reappearance` / `absence`) with a manual gap threshold and trail alerts.
- Chapter delete cascades mentions and asks keep-gap vs renumber; orphaned cards move to Trash, never destroyed.
- Entity merge, entity images, markdown export, per-book themes, density, and font/size settings.
- Items carry owner links ("Possessed by"); characters and organisations carry possessions and membership links.

Constraints and deliberate limits:

- React + TypeScript + Vite front end, Express + built-in `node:sqlite` back end, no native dependencies, Electron wrapper for distribution.
- No accounts, authentication, telemetry, or network calls beyond localhost.
- Entity relationships (explicit `source —label→ target` links and the graph view) were removed from the UI on request. The API routes, markdown export, merge handling, `relationships` table and existing rows are deliberately retained. Re-adding the UI is an open product decision, not a settled absence.
- Detection only prompts for typo/variant look-alikes; "same name, different thing" splitting is not built.
- Undo for triage decisions, global find-and-replace into Word, and a custom-field editor are not built.

## Brand Commitments

- Product name is **DocWriter** everywhere: window title, installer, About box, docs. "Grimoire" from HANDOFF.md is abandoned; do not revive it.
- Voice is the writer's vocabulary, not the schema's: bible, chapter, mention, triage, trail, gun, duel.
- Binding visual constraint from the owner: keep the existing Fog / Mocha / Sepia palette and the reading-first serif treatment. Do not replace the visual world as part of ordinary refinement.

## Evidence on Hand

- `README.md` — the loop, the detection strategy, and the implemented first slice.
- `HANDOFF.md` — session-by-session build history and the rationale behind shipped decisions.
- `server/seed-demo.mjs` + `data/demo.db` — a realistic 133-entity demo book used for visual and performance checks.
- `server/*.test.mjs` — 198 passing tests covering detection, merge, export, duels, timeline, planning and the API.
- Absent, and must not be invented: external users, testimonials, benchmarks against other products, press, pricing, or deployment claims.

## Product Principles

1. **The manuscript is the source of truth.** The bible is derived from pasted text and must never invent a fact the prose does not support.
2. **Precision over recall.** A missed candidate is recoverable; a wrong link pollutes every later chapter. Ask when unsure, link silently only when sure.
3. **Quiet by default.** Value shows as the app getting calmer with use: fewer prompts, fewer unresolved names, no repeated confirmations.
4. **Destructive actions stay reversible.** Trash before delete, confirm before discard, choose gap or renumber rather than guessing.
5. **Local and single-file.** One book is one file the writer owns and can move, back up, or delete without an account.
