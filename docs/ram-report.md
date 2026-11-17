# DocWriter RAM report

Measured on 17 November 2026 against the packaged Linux AppImage. This is a
measurement, not a fix: no app behaviour was changed for the numbers below.

**Headline**

- A cold window starts at ~312 MB PSS peak and settles at **~294 MB**.
- An empty book costs the same as no book (288 MB) — the book load is not what
  costs you anything at boot.
- The 2,000-chapter / 5.0 M-word book settles at **~444 MB**; heavy navigation
  through it reaches **~508 MB**.
- A 15-minute continuous navigation soak peaked at **832 MB** (+290 MB while
  clicking), then dropped **344 MB in one 2-second sample** the moment the loop
  stopped. That is uncollected heap, not a leak — see [Soak](#soak-15-minutes).
- Main process (which also hosts the Express + SQLite server) is remarkably
  flat: **115 MB cold → 127 MB after 15 minutes of hammering**.

## What was measured

| | |
|---|---|
| Build | Packaged AppImage, `release/DocWriter-0.1.0.AppImage`, 128,815,765 bytes, built 2026-11-17 19:30 IST |
| Electron | 44.9.0 (bundled) |
| OS | Omarchy (Arch-based), Linux 7.2.15-1-omarchy x86_64 |
| CPU | Intel Core i3-10110U, 2 cores / 4 threads, 2.10 GHz base |
| RAM | 7,690 MB total |
| GPU | Intel CometLake-U GT2 [UHD Graphics], Wayland via Hyprland 0.56.2 |
| Load | ~5.5 (1 min) during the early runs, ~3.3 during the soak — other apps, including a video stream, were open |

Notes that affect comparability:

- The window was raised with CDP `Page.bringToFront` for each run, so Chromium
  never throttled the background tab. A normally occluded window costs less CPU
  (and about the same memory).
- The machine has 4 threads and was under load; absolute numbers will be lower
  on an idle machine, but the shape (renderer scales with book size, main does
  not) held consistently across all five runs.
- PSS is the primary metric (`/proc/<pid>/smaps_rollup`), RSS is secondary.
  RSS runs 40–60% higher because shared Electron/Chromium pages are counted
  once per process.

## Method

- `scripts/measure-ram.mjs` launches the AppImage with a temp `DOCWRITER_DB`,
  walks `/proc` every 2 s for the whole process tree, and writes
  `timestamp,scenario,pid,role,pss_mb,rss_mb,cpu_pct` plus one `total` row per
  sample. Roles are derived from the command line: `main`, `renderer`, `gpu`,
  `utility-network`, `zygote`, `crashpad`.
- UI actions are driven over the Chrome DevTools Protocol
  (`--remote-debugging-port`), one scenario per fresh launch (the app is
  single-instance, so reusing a window would not give a fresh process).
- `scripts/gen-ram-book.mjs` writes the synthetic book: 2,000 chapters,
  5,012,461 words, 150 entities, 804 mention spans, 28 MB SQLite file. It
  refuses any path outside `/tmp` and never touches a real book.
- All test databases live in `/tmp/opencode/ram/`. `export_nudge` is `off`
  there so the export reminder does not steal focus.
- No plotting tool is installed (no matplotlib, no gnuplot), so the charts
  below are text sparklines: one column per sample, ▁ = lowest, █ = highest
  total PSS in that run.
- Scenario (d) asks for a "Relationships graph". DocWriter has no such screen;
  the closest graph-shaped surfaces are **Timeline ▸ Map** and the **Bible
  entity card**, which were used instead. Everything else in (d) is as asked.

## Results

PSS in MB. "Settled" is the median of the last five samples of the run;
"peak" is the highest single sample.

| Scenario | Total | Renderer | Main | GPU | Network utility | Peak (at) | Idle after settle |
|---|---:|---:|---:|---:|---:|---:|---:|
| (a) Cold start, 60 s idle | 294 | 66 | 115 | 60 | 29 | 312 (+12 s) | 294 |
| (b) Empty book, 60 s idle | 288 | 64 | 114 | 58 | 28 | 307 (+26 s) | 288 |
| (c) Large book (2 000 ch), 60 s idle | 444 | 179 | 120 | 91 | 29 | 446 (+68 s) | 444 |
| (d) 50 chapters + all views | 508 | 251 | 120 | 85 | 28 | 516 (+74 s) | 508 (≈30 s after the last click) |
| (e) 15 min soak | 479¹ | 214¹ | 127 | 83 | 30 | 832 (+882 s) | 823 before the drop, 479 ten seconds later |

¹ Post-release value: the soak has no idle window until the loop ends. 344 MB
was returned in the single sample after the last click.

Total RSS for reference: cold 652, empty 645, large 809, navigation 876,
soak 1,195 MB at peak.

Time to first sample was 2.0 s in every run (the AppImage extract + Electron
boot). Time to a usable window varied with disk cache: 7.0 s (navigation),
8.1 s (cold), 9.7 s (large book), 12.3 s (soak), 13.0 s (empty book) — the
AppImage is extracted on every launch, and a cold page cache dominates.

### (a) Cold start — 294 MB settled

```
▁▂▂▅████████████████████████████████████████████████
```

Rises to 312 MB at +12 s while the window builds, then falls to 294 MB and
stays there. Idle CPU settles to 0.5%. Nothing else in the tree moves after
+15 s, so this is the baseline for the rest of the report.

### (b) Empty book — 288 MB settled

```
▁▃▃▅▅▅▆█████████████████████████████████████████████
```

Six megabytes *less* than a cold start, and identical process split. An empty
book costs nothing measurable: the schema, the sidebar and the server are
already in the cold-start cost.

### (c) Large book — 444 MB settled, still climbing at 60 s

```
▁▁▁▂▄▄▆▆▆▆▆▆▆▆▆▆▆▆▇▇▇▇██████████████████████████████
```

+150 MB over an empty book, all of it in the renderer (+115 MB) and the GPU
process (+33 MB). The renderer is still busy (~70–96% of one core) and the
total memory is still rising in the last sample, so 444 MB is an *upper
estimate of settled*, not a stable floor — the 60 s window ends before the
app has finished with a 2,000-row chapter list. The 2,000-row list is not
virtualised; 2,000 buttons are in the DOM and the whole list is painted.

### (d) 50 chapters + every view — 508 MB, +64 MB over (c)

```
▁▂▂▃▅▆▆▆▆▆▆▆▆▆▇▇▇▇▇▇████████████████████████████████
```

The 50-chapter walk (spread across the book, 450 ms apart) plus Read / Review /
Planning / Timeline / Bible, the Timeline Story→Map switch and a Bible entity
card add 64 MB, essentially all in the renderer (+72 MB, GPU −6 MB). Thirty
seconds after the last click the total is 508 MB — 8 MB below the peak — so
this one does settle and does not fall back when the views close: whatever the
views allocate stays allocated while the window lives.

### (e) Soak — 15 minutes of continuous navigation

`soak`: 1,705 iterations of open chapter → scroll → every third iteration
switch view, on the large book.

```
▁▅▅▅▆▆▅▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇█▇▇▇▇████████▅
```

- Warm-up floor (2 min): ~532 MB.
- Peak: 831.9 MB at +882 s.
- Linear regression on the warm window (>2 min, 401 samples):
  **+18.8 MB/min**.
- That is **188 MB per 10 minutes**, far above the ~5 MB/10 min threshold —
  so by the requested rule the soak **is flagged**.
- But it is not a leak: in the first sample after the last click the total fell
  from 823 MB to 479 MB (−344 MB, renderer 558→214 MB) with the same process
  tree and the same renderer PID. The post-release floor (479 MB) is *below*
  the 2-minute floor (532 MB). Growth during the loop is uncollected heap from
  freshly-rendered chapter text, released when the clicking stops — a sawtooth,
  not an unbounded climb.

Verdict: **no evidence of a leak**; the criterion is met only because the app
defers collection while it is being driven. The renderer's high-water mark
(~560 MB) during continuous navigation is still worth knowing about, and the
main process never moves (127 MB at minute 15), which rules out the server or
SQLite as a grower.

## Top 3 consumers

| # | Process | PSS | Why (evidence-based guess) |
|---|---|---:|---|
| 1 | Renderer | 66 MB cold → 179 MB large book → 251 MB after navigation, 558 MB peak under soak | Holds the whole chapter list (2,000 buttons, not virtualised) plus the rendered chapter text and every view's state. It is the only process that reacts to book size or navigation, and the only one that grows in the soak. |
| 2 | Main | 115 MB cold → 127 MB after 15 minutes | Flat. It hosts the Express server **and** `node:sqlite` in-process (the Electron main imports `server/index.mjs`), so this is the price of the server + SQLite page cache + the Electron browser engine itself; it does not grow with the book or with use. |
| 3 | GPU process | 60 MB cold → 91 MB large book | Raster cache for the 2,000-row sidebar and the reader page; it grows with the book once and then stays flat (91 MB large, 85 MB navigation, 83 MB soak), which fits a page/raster cache rather than a leak. |

Together the three are 82–90% of every total above. The rest is the two
zygotes (~25 MB together, shared), the network utility (~28 MB) and crashpad.

### Side observation: CPU, not memory

With the large book open and the window raised, the renderer stays near one
full core for the first minute after load, and the decorative
`body { animation: dw-tide }` / `.topbar::after` animations cost roughly
20% renderer + 20% GPU while the window is visible (verified by injecting
`animation: none` over CDP: 24% + 18% → 1% + 0%). Occluded windows drop to 0%
on their own, so this only matters while the writer is actually looking at the
app. Not measured further, because it is not memory.

## Reproducing

```sh
# once: synthetic book (safe, /tmp only)
node scripts/gen-ram-book.mjs /tmp/opencode/ram/large.db 2000 2500

# one scenario per run, fresh process each time
node scripts/measure-ram.mjs --scenario cold   --db /tmp/opencode/ram/cold.db  --idle 60
node scripts/measure-ram.mjs --scenario empty  --db /tmp/opencode/ram/empty.db --idle 60
node scripts/measure-ram.mjs --scenario large  --db /tmp/opencode/ram/large.db --idle 60
node scripts/measure-ram.mjs --scenario nav    --db /tmp/opencode/ram/large.db --idle 30
node scripts/measure-ram.mjs --scenario soak   --db /tmp/opencode/ram/large.db --soak 900 --idle 10
```

Samples append to `/tmp/opencode/ram/samples.csv`, one JSON line per run to
`meta.jsonl`, and the app's own stdout to `/tmp/opencode/ram/<scenario>.log`.

Optional live monitor, dev only: run the app with `DOCWRITER_MEM=1` and it
prints `app.getAppMetrics()` every 5 s (`[mem] Browser#123=230MB GPU#…=133MB
Utility#…=85MB Tab#…=117MB`). It is inert without the env var, there is no UI,
and the packaged build ignores it unless someone sets the variable.
