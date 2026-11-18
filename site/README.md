# DocWriter site

The static promotional site that ships alongside the app. Plain Vite + TypeScript,
two pages, no server, no forms, no analytics. Nothing here runs at runtime.

- `index.html` — one page with anchor nav: hero, the problem, the four-step loop, features, footer.
- `guide.html` — first run, where the book file lives, backup/export, the full keyboard table, known limits.
- Deploy target: the custom domain **`www.docwriter.app`** (`public/CNAME`). The Vite base path defaults to `/` and is configurable via `VITE_BASE` for a subpath mirror.

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

## Deploy to GitHub Pages

The Pages source is the `gh-pages` branch; the custom domain is set by the
`CNAME` file copied from `public/` into `dist/` on every build. From the repo root:

```bash
cd /home/rj/docwriter
npm --prefix site install
npm --prefix site run build
npx --yes gh-pages@6 -d site/dist
```

`gh-pages` creates or updates the `gh-pages` branch at `origin` and pushes it.
In the GitHub repo, set **Settings → Pages → Build and deployment → Source** to
"Deploy from a branch", branch `gh-pages`, folder `/ (root)`. Keep the custom
domain `www.docwriter.app` in the Pages settings and leave "Enforce HTTPS" on.

If you prefer to publish without `npx`:

```bash
git worktree add -B gh-pages /tmp/docwriter-pages
cp -R site/dist/. /tmp/docwriter-pages/
cd /tmp/docwriter-pages
git add -A && git commit -m "Deploy DocWriter site" && git push -f origin gh-pages
```

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
| `read-sepia-1440.png` | Read (hero, cropped to the reading column) | Sepia | 920×510 crop |
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
cropped to the manuscript page (legend, drop cap, dotted and solid linked names),
and the Light/Mocha pair is cropped to the identical paragraph so the two themes
can be compared directly. Cropping also cut their combined weight from ~410 KB to
~121 KB.

To re-capture them, run the app on `:5173` with a disposable `DOCWRITER_DB`,
dismiss the export reminder, set `data-theme` to the wanted theme, and capture
the viewport with `Page.captureScreenshot`, then re-apply the crops above.

## Deliberately left out

- No testimonials, benchmarks, pricing, AI claims or comparison to other products.
- No feature that is not in `PRODUCT.md`, `README.md` or `HANDOFF.md` §97–100, or visible in the app.
- No relationship graph or link editor: removed from the app's UI, so not advertised.
- No Windows/macOS build, no auto-update, no account or sync: stated as limits on the guide page.
- No analytics, tracking or web fonts beyond the four families the app already ships.
