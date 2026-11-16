---
target: Timeline
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
p2_count: 2
target_identity: "file:/home/rj/docwriter/src/views/TimelineView.tsx"
target_fingerprint: "sha256:3913b17550704cd079144e7a51cd8dc435a377122627028b663688dfcd20a0ff"
target_path: /home/rj/docwriter/src/views/TimelineView.tsx
timestamp: 2026-11-16T17-37-32Z
slug: src-views-timelineview-tsx
---
⚠️ DEGRADED: single-context (sub-agent A and B calls returned a provider content-filter error and the free-model quota is exhausted; both assessments were completed inline from source, CDP measurement, and screenshots)

**Target:** `src/views/TimelineView.tsx` · measured live at 1400 / 760 / 560 in light, sepia and mocha against a throwaway copy of the demo book (2 chapters, 9 events, 18 event–entity links).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Loading, errors and counts exist; search fires with no count or live announcement, and saving an event only shows up as a silently refreshed list. |
| 2 | Match System / Real World | 2 | "Story day" vs "Story time" is two fields for one idea; "Map" is a chapter bar list, not a map of anything. |
| 3 | User Control and Freedom | 2 | Escape and backdrop close the editor; typed work is gone, no undo, no draft. |
| 4 | Consistency and Standards | 2 | The paste dialog asks before discarding; the event editor does not. Shell controls are 34px; Timeline's are 23–32px. Tabs don't follow the tab pattern. |
| 5 | Error Prevention | 2 | Title and day are validated, deletion confirms — but the common exit destroys a half-written event. |
| 6 | Recognition Rather Than Recall | 3 | Counts on tabs and chips, visible actions, linked cards; the Map/Story relationship needs a paragraph of explanation. |
| 7 | Flexibility and Efficiency | 2 | Search and kind filters exist; no shortcut for New event, no keyboard tab switching, reorder is one click per step. |
| 8 | Aesthetic and Minimalist Design | 3 | Genuinely handsome and authored; 8 kind chips, 5 actions per card, a second marker list and "+1 day" on every row crowd it. |
| 9 | Error Recovery | 3 | Load error keeps the page with Retry; editor errors are inline and preserve fields; native confirm is the weak exit. |
| 10 | Help and Documentation | 2 | Good inline notes and placeholder examples; no help surface anywhere in the app. |
| **Total** | | **23/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment.** This is not a generic CRUD table. The split between manuscript order and story order is the actual problem a novelist has, and the view builds its own vocabulary around it: numbered event cards, a colored kind rail, a day track with signed deltas, "Unplaced" as an honest state, a marker lane for guns and questions. The type is reading-first — Spectral titles over the book's own lamp-lit surface. It could not be dropped into another product without losing meaning. The weak spot is that the *Map* tab, the default landing, underdelivers on its name and on the promise of the view: it shows chapter bars and a handful of pills, while the real character lives one tab away.

**Deterministic scan.** `impeccable detect --json src/views/TimelineView.tsx` returned exit 0 and `[]`. Treat that as an undercount: `.tsx` is regex-matched only, so element rules did not run. No overlay was injected, so there is no **[Human]** tab to look at; the evidence here is the live page and the screenshots at `/tmp/opencode/tl-*.png`.

## Overall Impression

The best-written view in the app conceptually, and the least finished mechanically. It knows what a timeline is for, then loses work on Escape, fails AA contrast on its own kind badges in all three themes, puts prose at 816px against a 660px rule, and leaves keyboard users tabbing into the sidebar behind an open dialog. The single biggest opportunity: make the Story tab's event cards as trustworthy to operate as they are pleasant to read.

## What's Working

- **Manuscript vs story order is a real distinction, stated twice and never fudged.** The Map note and the Story note both say it in plain writer language, and undated events are labelled "Unplaced" rather than guessed into the line.
- **The card language is specific and legible.** Left color rail, numbered ring, serif title, kind pill, day pill, chapter anchor. You can scan nine events and see battle vs death vs reveal without reading titles.
- **Honest day math.** "Story days: Day 1 → Day 9 · 8 days" plus per-event `+1 day` deltas gives a real chronology, and the "Leave blank if this event has no day yet; the app only counts the difference" helper explains the rule before the user meets it.

## Priority Issues

### [P1] The event summary ignores the Measure Rule and the reading scale
**What:** At 1400px, `.tl-event p` renders **816px wide** — the app's binding prose cap is **660px**. The summary is also **12px** under a 20px title, while chapter prose in Read is 19px. The notes above it run 896px.
**Why it matters:** This is the one place in the app where prose is set as tiny wide text. It reads as metadata, so the writer skims past the sentence that actually describes the event, and long lines make the eye lose its place — the opposite of the reading-first promise.
**Fix:** Cap the event body's text column at 660px (keep the card full width if you like the surface), raise summaries to at least `--text-base`, and cap `.timeline-note` to the same measure.
**Suggested command:** `/impeccable typeset`

### [P1] The event editor is a dialog only by appearance
**What:** With a title typed, Escape closes it silently (`confirmOpen: false`), the draft is gone, and focus lands on `<body>`. Tab from the "What happens" textarea goes to the page behind the dialog — the next stops are the sidebar nav items — because there is no focus trap. Closing via Edit never returns focus to that Edit button.
**Why it matters:** This is a data-loss path on the most common keyboard exit, and a screen-reader user is dropped out of a modal without being told. The add-chapter dialog already solved exactly this with an in-app "Discard this chapter?" alertdialog; Timeline is the inconsistent one.
**Fix:** Add the same dirty-close guard here (Keep editing / Discard event), trap Tab inside `.tl-editor`, and restore focus to the `New event` / `Edit` control that opened it.
**Suggested command:** `/impeccable harden`

### [P1] Kinds, order rings and role labels fail contrast in every theme, and controls sit under the 34px floor
**What:** The kind pill and order ring use the kind hue as 11px text on a 10% tint of itself: **2.31:1** in sepia (Battle/Reveal), **2.51:1** in light, **3.9:1** in mocha (Reveal/Travel), against 4.5 needed. Entity role text ("Place", "Person", 11px) is **4.18:1** in light. Separately, 60 of 85 visible controls on the Story tab are under 34px: action buttons 32px, move arrows 32×32, entity chips 26px, map/marker pills 23px, chapter rows 28px.
**Why it matters:** The kind badge is the fastest way to read the view and it is the least legible thing on the page for low-vision users; the 11px floor passes only because the text is large enough to be seen, not readable. The undersized controls undo the 34px floor the shell just established, especially for the arrows that are the only way to reorder.
**Fix:** Keep the hue as the rail and dot, but set kind/order text in `--color-text` (or darken the mix until every theme clears 4.5:1), and bring interactive elements to 34px — chips included, per DESIGN.md.
**Suggested command:** `/impeccable colorize`

### [P2] Search and filters answer with silence, and the empty filter is a dead end
**What:** Typing "ledger" correctly narrows to 3 events, but there is no result count and no `aria-live` region anywhere in the view. Typing "zzzz" gives "No events match that filter." with no Clear control; the only way out is to find and click the All chip.
**Why it matters:** The user can't tell a filter from a failure, and a screen-reader user gets no feedback that anything changed. The app's search box already learned to say "7 of 17 matches"; this one didn't.
**Fix:** Add a `.sr-only` status line ("3 of 9 events"), show the count near the search, and put a Clear filters button inside the empty state.
**Suggested command:** `/impeccable clarify`

### [P2] Delete is a native confirm with no undo, one button away from Edit
**What:** `confirm("Delete “…”?")` blocks the browser and cannot be styled; there is no undo and no trash path to recover a deleted event. The red Delete button sits in the same row as Edit and the reorder arrows.
**Why it matters:** Destructive actions deserve either a guard that matches the app's own dialogs or a recovery path. A mis-click here loses a story event, and the page's own visual language stops at the browser's grey box.
**Fix:** Replace with an in-app alertdialog naming the event and the consequence, or a soft delete with Undo in the list; move Delete away from Edit.
**Suggested command:** `/impeccable harden`

## Persona Red Flags

**Alex (Power User).** No keyboard path to New event; reordering nine events takes eight separate ↑/↓ clicks with no drag or bulk move; the tablist ignores Arrow keys (focus stayed on Map while Story was selected); each card carries five buttons, so tabbing the list is 45 stops before the marker lane.

**Sam (Accessibility).** Tab walks out of the open dialog into the sidebar; Escape returns focus to `<body>`; the Battle and Reveal badges are 2.31–2.51:1 in sepia and light; entity chips are 26px tall; both tabs are in the tab order at once and neither controls a `role="tabpanel"`; search changes are unannounced.

**Nadia (returning novelist, from PRODUCT.md).** She opens Timeline to see where the book stands and lands on Map: two chapter bars and one Death pill, no events. She has to infer that Story is the real view, then choose between "Story time" and "Story day" for the same fact. Every card repeats "+1 day", so the chronology reads as noise rather than progress.

## Minor Observations

- Tabs are `role="tab"` with neither `aria-controls`, ids, nor a `tabpanel`; arrow keys do nothing and both keep `tabindex="0"`.
- The kind filter is 8 visible choices at one decision point (All + 7 kinds), above the 4-item working-memory guideline; "Other 1" orphan-wraps alone at 760.
- "Linked cards" is a `<label>` with no control; the search input beneath it is associated only by proximity.
- Event titles are `h3` with no `h2` above them; the marker lane is the only `h2` on the page.
- Map markers cap at 4 per chapter and "+N" is an inert span; the hidden markers have no route.
- At 560 the topbar title and the H1 both say "Timeline"; at 760 the duplicate is more prominent than the content's own hierarchy.
- `＋ New event` uses a fullwidth plus glyph; every other app button uses "+ Paste".
- Saving an event gives no confirmation beyond the list refreshing; if the user has scrolled, the change is off-screen.
- No legend for marker colors; "Gun", "Payoff", "Question", "Answered", "Death" are readable, so this is polish only.
- The Map's two filter chips report the same count (2 / 2) in this fixture, making the distinction invisible until a chapter has no events.

## Questions to Consider

- Is "Map" a chapter overview that should be renamed for what it is, or the beginning of a real spatial/temporal map? The current tab is neither.
- Should story order be a property you set once (drag, numbers), rather than eight single-step clicks?
- What would a card look like if the summary were the sentence you read and the metadata were the footnote, instead of the reverse?
