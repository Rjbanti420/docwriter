---
name: DocWriter
description: An offline paste-to-worldbible writing companion — a harbour at night, lit by one lamp.
colors:
  accent: "#7fd6b8"
  accent-ink: "#08221b"
  accent-verdigris: "#1f7a6d"
  accent-harbor-blue: "#35597e"
  fog-base: "#edf1f0"
  fog-surface: "#f8fbfa"
  fog-paper: "#fdfefc"
  night-base: "#0b1315"
  night-surface: "#162428"
  night-paper: "#111e22"
  driftwood-base: "#e8e4db"
  driftwood-surface: "#f3f0e8"
  driftwood-paper: "#f6f3ec"
  ink: "#e3ece9"
  ink-muted: "#9ab0ad"
  ink-faint: "#7f9895"
  ink-fog: "#16262b"
  ink-driftwood: "#2b2923"
  border-night: "#213539"
  border-fog: "#d2dcdb"
  border-driftwood: "#d0cabb"
  type-character: "#d97706"
  type-country: "#059669"
  type-organisation: "#7c3aed"
  type-location: "#0284c7"
  type-item: "#db2777"
  danger: "#f0897a"
  positive: "#7fd6a0"
  caution: "#e3b25e"
typography:
  display:
    fontFamily: "Spectral, Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "44px"
    fontWeight: 500
    lineHeight: 1.02
    letterSpacing: "-0.028em"
  headline:
    fontFamily: "Spectral, Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Spectral, Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "23px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0em"
  body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0em"
  reading:
    fontFamily: "Spectral, Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "0em"
  label:
    fontFamily: "DM Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.14em"
  # Working steps between the six roles. Sizes only: each inherits the family
  # of the role it serves, as the Hierarchy section describes.
  caption:
    fontSize: "12px"
  control:
    fontSize: "13px"
  input:
    fontSize: "15px"
  subhead:
    fontSize: "16px"
  question:
    fontSize: "17px"
  section:
    fontSize: "18px"
  card-title:
    fontSize: "20px"
  inline-name:
    fontSize: "21px"
  candidate:
    fontSize: "22px"
  name:
    fontSize: "24px"
  inspector:
    fontSize: "26px"
  reader-sm:
    fontSize: "28px"
  panel-title:
    fontSize: "32px"
  reader-lg:
    fontSize: "34px"
  reader-hero:
    fontSize: "36px"
  # Ornamental daggers behind dead entities, not running text.
  watermark:
    fontSize: "128px"
  watermark-xl:
    fontSize: "190px"
rounded:
  hairline: "2px"     # meters, rules, the rule under the page head
  underline: "3px"    # mention underlines, active-tab markers
  xs: "4px"           # kbd caps, the focused mention ring
  sm-alt: "6px"       # chapter medallion, small pills
  tag: "7px"          # panel tags and move handles
  sm: "8px"           # icon buttons and inline panel buttons
  sm-lg: "9px"        # compact cards, small controls
  control: "10px"     # inputs, icon buttons, tab tops
  control-lg: "11px"  # nav items, card icons, reader headings
  control-xl: "12px"  # buttons, top bar, panel body, compact cards
  md: "14px"          # inner cards, icon tiles
  md-lg: "16px"       # grouped sections, small tiles
  chip: "17px"        # a fully round 34px chip
  panel-sm: "18px"    # entity-panel tiles, expanded panel
  lg: "20px"          # entity cards, panels, modal
  paper: "24px"       # the manuscript page
  panel-xl: "26px"    # the entity editor dialog
  pill: "999px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control-xl}"
    padding: "0 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.night-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control-xl}"
    padding: "0 16px"
    height: "40px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "0 15px"
    height: "34px"
  chip-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
    height: "34px"
  entity-card:
    backgroundColor: "{colors.night-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "18px"
  input:
    backgroundColor: "{colors.night-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
---

# Design System: DocWriter

## Overview

**Creative North Star: "The Harbor & Lamplight"**

DocWriter is a harbour at night lit by one lamp. Fog by day, lamplight after dark: sea-glass neutrals, a single verdigris accent, and a serif that belongs to the manuscript rather than the software. The system is quiet, salt-worn and lamplit — it never decorates, it only holds light on the thing being worked on.

The visual language splits the labour. Spectral carries everything the writer named: book titles, entity names, chapter text. Hanken Grotesk carries the apparatus — navigation, forms, buttons, counts. DM Mono marks the small printed labels, the way a chart is labelled. The result reads as an editorial instrument, not a dashboard.

Three light conditions are first-class: **Fog** (light), **Harbor night** (dark, the default), and **Driftwood** (reading). They are not skins bolted on afterwards; every surface token is re-bound per theme, and a screen is only finished when it survives all three.

**Key Characteristics:**
- Sea-glass neutrals with one verdigris accent per screen.
- Spectral for names and prose, Hanken Grotesk for controls, DM Mono for labels and counts.
- Softly tactile surfaces: 20px cards, 1px top light, layered downward shadows.
- Colour as data: five type hues identify entity kinds, never decoration.
- Density is a multiplier (`--density`), not a second layout.

## Colors

A cool, desaturated sea-glass range, warmed only by the five entity hues and the status colours. Every value is a theme token; the accent is the only saturated note.

### Primary
- **Verdigris Lamp** (#1f7a6d): Fog accent, light theme. The green of oxidised copper, used for the active chip, primary button and focus ring.
- **Lamp Glow** (#7fd6b8): Harbor night accent. Pale lamp oil; the same role after dark.
- **Harbor Blue** (#35597e): Driftwood accent. Deep chart ink for the reading theme.

### Secondary
- **Type Ink** (#d97706 Character · #059669 Country · #7c3aed Organisation · #0284c7 Location · #db2777 Item): the five entity colours. They arrive from the database per type and reach components as the inline `--e` custom property.

### Neutral
- **Fog Glass** (#edf1f0) / **Night Water** (#0b1315) / **Driftwood** (#e8e4db): the page base per theme.
- **Harbor Surface** (#162428) and **Lamplight Paper** (#111e22): raised surface and manuscript paper in the dark theme.
- **Ink** (#e3ece9), **Ink Muted** (#9ab0ad), **Ink Faint** (#7f9895): the three text weights at night; Fog and Driftwood re-bind the same roles, and faint clears AA on base, surface and paper in all three.
- **Tarnished Brass** (#213539): the one border colour at night; 1px, never thicker.

### Status
- **Signal Red** (#f0897a), **Kelp Green** (#7fd6a0), **Amber Wick** (#e3b25e): danger, positive and caution at night. Each theme re-tunes them for its own background.

### Named Rules
**The One Lamp Rule.** The accent marks the active or primary thing and nothing else. On any screen it covers well under a tenth of the pixels; its scarcity is what makes it read as light.

**The Type-Is-Data Rule.** Entity hues come from the `types` table. Never hard-code a type colour in a component, and never reassign a hue for decoration — the reader learns the five colours as a key.

**The Three Lights Rule.** A surface is finished only when it is legible in Fog, Harbor night and Driftwood. Never ship a component with a hard-coded background or text hex; bind it to a `--color-*` token.

## Typography

**Display Font:** Spectral (with Iowan Old Style, Palatino, Georgia fallback)
**Body Font:** Hanken Grotesk (with system-ui fallback)
**Label/Mono Font:** DM Mono (with ui-monospace fallback)

**Character:** A literary serif for everything the writer owns, a neutral grotesk for the machinery around it, and a mono for the small printed labels. The pairing reads as a book with a well-made index, not as an app with a theme.

### Hierarchy
- **Display** (500, 44px, 1.02, −0.028em; 32px below 720px, 28px below 480px): screen titles such as "The Bible". One per screen.
- **Headline** (600, 30px, 1.15, −0.015em): the entity panel title, the name of the thing being edited.
- **Title** (500, 23px, 1.2): entity card names, candidate names. Spectral, never bolded past 500.
- **Body** (400, 14px, 1.3): controls, forms, navigation, metadata. Hanken Grotesk.
- **Reading** (400, 19px, 1.75): manuscript text in the 660px reading column; the only place long prose lives.
- **Label** (500, 11px, 0.14em, uppercase): section labels and count badges. Group heads use the same face at 12px. DM Mono.

Between these roles sit named working steps for chips, controls, panel subtitles, reader titles and responsive display sizes. A step takes the family of the role it serves; none introduces a fourth face.

### Named Rules
**The Two Voices Rule.** Spectral is for what the writer named or reads; Hanken is for what the software does. A button never uses the serif, and a chapter title never uses the grotesk.

**The 11px Floor Rule.** Functional text never goes below 11px. Group heads sit one step above at 12px; every other mono label, count and badge is 11px.

## Layout

A fixed 288px sidebar on the left, a centred content column on the right. Reading text is held to 660px; general content to 960px; the Bible grid to 1000px. The entity panel is a centred dialog 780px wide (1280px expanded) with a 300px aside.

Vertical rhythm is built from a 4px base (4 / 8 / 12 / 16 / 18 / 24 / 28 / 32) and most card and section padding is multiplied by `--density`: `1` comfortable, `0.78` compact. Compact changes spacing only — never type size, never the order of anything.

Breakpoints: 760px is the working mobile cut (sidebar becomes an overlay drawer, panels go full-width with internal scrolling); 640px and 480px tighten grids and stack control rows. The grid itself is `repeat(auto-fill, minmax(...))`; nothing fixes a column count.

### Named Rules
**The Measure Rule.** Prose never exceeds 660px. The 1000px Bible column is for scanning cards, not for reading sentences.

**The One Multiplier Rule.** New spacing uses `calc(Npx * var(--density))`. A fixed height that ignores the multiplier breaks compact mode.

## Elevation & Depth

Lamplit and lifted: depth is light falling from above, not a drop shadow. Every raised surface carries a 1px inset highlight at the top and a set of soft, downward, ink-tinted shadows. Nothing floats on black; the shadows take the theme's text colour so they stay warm in Fog and Driftwood and cool at night.

### Shadow Vocabulary
- **Card** (`--shadow-card`): the default rest state for cards, panels, search fields and grouped lists.
- **Lift** (`--shadow-lift`): hover or emphasis on a card; adds a faint accent-tinted bloom.
- **Drawer** (`--shadow-drawer`): the left sidebar and any edge-anchored panel.
- **Modal** (`--shadow-modal`): the entity panel and confirmation dialogs — the only surfaces allowed a deep shadow.

### Named Rules
**The Top-Light Rule.** If a surface is raised, it carries an inset top highlight. A shadow without the inset light reads as a sticker.

**The Four Shadows Rule.** Depth uses these four tokens only. A new component composes them; it does not invent a fifth.

## Shapes

Corners round with size, on one continuous ladder rather than a 3-step scale: hairlines and rules at the small end, controls in the middle, panels and paper at the top. Borders are always 1px and always a theme border token. The silhouette vocabulary is soft rectangles and pills — no sharp corners, no heavy outlines, no glassy blur except the inspector and drawer surfaces.

- **Hairlines and marks**: 2–4px for meters, rules, kbd caps and the mention ring.
- **Controls** (buttons, inputs, selects): 8–12px, 34–44px tall.
- **Cards and panels**: 14–20px; the entity editor goes to 26px and the manuscript page to 24px.
- **Chips and status pills**: full round (`999px`), 34px tall when they are controls. Read-only status tags (READY, OPEN, WINNER) may stay 22–24px tall with 11px text, because nothing is asked of the pointer.
- **Icons**: 46px rounded square with a 14px radius (9px in compact rows), filled with a type-tinted gradient.
- **Tabs**: top corners only, 10px, with a 3px underline in the active colour for the selected tab.

### Named Rules
**The Soft Corner Rule.** Radius scales with the size of the thing. A 20px radius on a 34px chip looks like a mistake; a 9px radius on a panel looks unfinished.

## Components

Refined and restrained: softly tactile, quiet at rest, and obviously interactive only when the pointer or focus arrives. The phrase for the whole set is "a well-made instrument left on a desk".

### Buttons
- **Shape:** 12px radius, 40px tall, 13px Hanken.
- **Primary:** accent fill, accent-ink text, 600 weight, inset top highlight plus a 12px accent bloom below.
- **Hover:** the accent shifts one step (slightly darker in light themes, brighter at night); no scale change.
- **Secondary / Ghost:** surface fill, 1px border, 500 weight, 1px shadow. Ghost is the same with a transparent fill.
- **Danger:** transparent fill, danger border and text; fills with the danger tint on hover.

### Chips
- **Style:** 34px, fully round, 1px border, transparent fill, muted text.
- **State:** selected chips become solid accent with accent-ink text at 600 weight. Chips filter, they do not navigate.

### Cards / Containers
- **Corner Style:** 20px (paper 24px).
- **Background:** `--color-surface`, with the manuscript on `--color-paper`.
- **Shadow Strategy:** card at rest, lift on hover, translated up 3px.
- **Border:** 1px theme border; on hover the type colour mixes in at 55%.
- **Internal Padding:** `calc(18px * var(--density))`.

### Inputs / Fields
- **Style:** 44px, 10px radius, paper fill, strong 1px border, 15px Hanken text; the top-bar search is a full-round pill.
- **Focus:** 2px accent outline, 2px offset — never a border-colour-only change.
- **Placeholder:** muted ink. Faint clears AA as well, but placeholders stay one step louder than tertiary metadata.

### Navigation
- **Style:** 288px sidebar, 38px items, 11px radius, 14px/600 Hanken with a 20px line icon.
- **State:** active item gets a 15% accent wash, an accent-tinted inset highlight and an accent icon; chapters use a 22px round number medallion.
- **Mobile:** under 760px the sidebar becomes a scrim-backed drawer.

### Entity Panel
A 780px dialog on the 20px radius with the modal shadow. Title in Spectral 30px, a type-coloured pill beneath it, a 48px tab row whose selected tab carries a 3px underline in the entity's type colour, and a sticky footer holding trash on the left and save state on the right. Each tab's content enters with a short staggered rise.

## Do's and Don'ts

### Do:
- **Do** use the accent for one thing per screen: the active chip, the primary button, the focus ring.
- **Do** bind entity colour through the inline `--e` property sourced from the type row.
- **Do** check every screen in Fog, Harbor night and Driftwood before calling it done.
- **Do** keep raised surfaces on the four shadow tokens with the 1px inset highlight.
- **Do** multiply spacing by `--density` so compact mode keeps working.
- **Do** use `--color-text-secondary` for placeholders and empty text, and `--color-text-faint` for timestamps, counts and asides; both clear AA on every theme.

### Don't:
- **Don't** add a second accent hue, a gradient hero, or a metric-tile row. The rejected reference is the generic SaaS dashboard: stock gradients, purple blobs, cards that exist to fill space.
- **Don't** hard-code type or theme hex values inside a component.
- **Don't** use `--color-text-faint` for anything longer than a caption; its 4.5:1 floor is for metadata, not prose.
- **Don't** set functional text below 11px.
- **Don't** use DM Mono for anything longer than a label.
- **Don't** use pure-black shadows or a fifth elevation.
- **Don't** fix a card or control height that ignores the density multiplier.
