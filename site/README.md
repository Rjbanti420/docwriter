# DocWriter site

The static promotional site that ships alongside the app. Plain Vite + TypeScript,
two pages, no server, no forms, no analytics. Nothing here runs at runtime.

- `index.html` — one page with anchor nav: hero, the problem, the four-step loop, features, footer.
- `guide.html` — first run, where the book file lives, backup/export, the full keyboard table, known limits.
- Deploy target: **GitHub Pages** at `https://rjbanti420.github.io/docwriter/`, built by `.github/workflows/site.yml` with `VITE_BASE=/docwriter/`. The custom domain `www.docwriter.app` is not live (no DNS records) — see *Deploy* below for what changes when it is.

## Preview

```bash
cd /home/rj/docwriter/site
npm install
npm run dev            # local dev server (Vite default port 5173)
```

If the app's own dev server is already using port 5173, run the site elsewhere:

```bash
npm run dev -- --port 5174
```

Production build and local preview of the built output:

```bash
npm run build          # emits site/dist/ (index.html, guide.html, assets, CNAME)
npm run preview        # serves site/dist/ locally
npm run typecheck      # tsc --noEmit
```

To check a subpath deploy locally:

```bash
VITE_BASE=/docwriter/ npm run build
```

## Deploy

`.github/workflows/site.yml` builds `site/` and publishes it to GitHub Pages on
every push that touches `site/**` (and on demand via *Run workflow*). Pages'
source is **GitHub Actions**; there is no `gh-pages` branch and no CNAME file,
because the site is served from the project subpath `rjbanti420.github.io/docwriter/`.

The base path lives in the workflow (`VITE_BASE=/docwriter/`), not in
`vite.config.ts` — the config still defaults to `/`, so a build without that
variable is ready for a domain-root deploy.

**When `www.docwriter.app` exists:** add a `public/CNAME` containing the domain,
set `VITE_BASE` to `/` in the workflow, and point DNS at Pages
(`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`, plus
a `www` CNAME to `rjbanti420.github.io`). Until then the CNAME file would make
every visitor 404, which is why it was removed.

## Where the screenshots came from

All images in `src/assets/screens/` are real captures of the running app, not
mockups. They were taken with headless Chromium driven over the Chrome DevTools
Protocol from the app's Vite dev server on `http://127.0.0.1:5173` (API on
`:5178`), at viewport widths 1440 and 760, `deviceScaleFactor: 1`. There is no
OS window chrome in any image; each is the app viewport only.

The book shown is an isolated copy of the repo's `data/demo.db` seeded with a
few extra guns, questions and timeline events purely so those views had
something real to render. Its file was named `Ashen Harbor.db` because the app
names the book from its filename. No app source file was changed.

| File | View | Theme | Width |
| --- | --- | --- | --- |
| `read-sepia-1440.png` | Read (hero, cropped to the reading column) | Sepia | 1840×1020, shown at 920×510 |
| `read-sepia-760.png` | Read | Sepia | 760 |
| `read-light-1440.png` | Read (theme strip, same paragraph as Mocha) | Light | 870×350 crop |
| `read-mocha-1440.png` | Read (theme strip, same paragraph as Light) | Mocha | 870×350 crop |
| `paste-sepia-1440.png` | Paste a chapter modal, filled in | Sepia | 1440 |
| `triage-sepia-1440.png` | Triage modal with quotes and key legend | Sepia | 1440 |
| `cards-sepia-1440.png` | Bible, typed cards | Sepia | 1440 |
| `planning-sepia-1440.png` | Planning, guns | Sepia | 1440 |
| `timeline-sepia-1440.png` | Timeline, Map | Sepia | 1440 |
| `settings-sepia-1440.png` | Settings, Look / Profile / Export | Sepia | 1440 |

The three Read images were cropped from their original 1440×900 viewport captures
after a design critique found them too small to read at display size: the hero is
cropped to the manuscript page (kicker, drop cap, dotted and solid linked names),
and the Light/Mocha pair is cropped to the identical paragraph so the two themes
can be compared directly. Cropping also cut their combined weight from ~410 KB to
~121 KB.

To re-capture them, run the app with a disposable `DOCWRITER_DB` (`npm run build`
plus `PORT=5181 DOCWRITER_DB=… node server/index.mjs` is enough — no dev server
needed), dismiss the export reminder, set the theme in the book's `meta` table
before starting, and capture with `Page.captureScreenshot`. The hero is a
`deviceScaleFactor: 2` capture cropped to the `.paper` column, which is why it is
1840 px wide for a 920 px slot. The other images are `deviceScaleFactor: 1` whole
viewports.

## Deliberately left out

- No testimonials, benchmarks, pricing, AI claims or comparison to other products.
- No feature that is not in `PRODUCT.md`, `README.md` or `HANDOFF.md` §97–100, or visible in the app.
- No relationship graph or link editor: removed from the app's UI, so not advertised.
- No macOS build, no auto-update, no account or sync: stated as limits on the guide page.
- No analytics, tracking or web fonts beyond the four families the app already ships.
