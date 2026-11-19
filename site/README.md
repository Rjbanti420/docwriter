# DocWriter site

The static promotional site that ships alongside the app. Plain Vite + TypeScript,
three HTML entries (index, guide, 404), no server, no forms, no analytics. The
page is fully readable and its download links work with JavaScript off; JS only
updates the download block from GitHub's release API and adds the scroll marker.

- `index.html` — one page with anchor nav: hero, the problem, the four-step loop, features, three themes, try it first, built for long books, who it is for, FAQ, 1.1.0 notes, About, footer.
- `guide.html` — first run, book file, backup/export, full keyboard table, known limits.
- `404.html` — in the site's style; links use the public `/docwriter/` URLs.
- Deploy target: **GitHub Pages** at `https://rjbanti420.github.io/docwriter/`, built by `.github/workflows/site.yml` with `VITE_BASE=/docwriter/`. The custom domain `www.docwriter.app` is not live (no DNS records).

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
npm run build          # emits site/dist/
npm run preview        # serves site/dist/ locally
npm run typecheck      # tsc --noEmit
```

To check the real deploy path locally, build **and preview** with the same base:

```bash
VITE_BASE=/docwriter/ npm run build
VITE_BASE=/docwriter/ npm run preview -- --port 4173
# open http://localhost:4173/docwriter/
```

Without `VITE_BASE` at preview time, Vite serves the output at `/` and every
`/docwriter/…` asset URL falls through to the SPA shell — the page looks unstyled.
Set the variable on both commands.

## Downloads

Every Download control links **directly to an asset**, never to the Releases page.
The HTML ships working defaults for v1.1.0 so a visitor with JS off still gets a
file:

- `DocWriter-1.1.0-win-x64.exe` (Windows installer, default primary)
- `DocWriter-1.1.0-win-x64.zip` (portable Windows)
- `DocWriter-1.1.0.AppImage`
- `docwriter_1.1.0_amd64.deb`
- `SHA256SUMS.txt`

`src/main.ts` fetches `https://api.github.com/repos/Rjbanti420/docwriter/releases/latest`
once, matches assets by filename pattern and updates the hrefs, version label and
file sizes. Any failure (offline, rate limit, missing asset) leaves the defaults
untouched and silent. `navigator.userAgent` selects Windows (.exe) or Linux
(AppImage); anything else gets a short "no build for this system yet" line, with
all four artifacts still listed under **Other downloads**.

The v1.1.0 release is published, so the direct URLs resolve publicly. Check its
status at `https://github.com/Rjbanti420/docwriter/releases`.

## Deploy

`.github/workflows/site.yml` builds `site/` and publishes it to GitHub Pages on
every push that touches `site/**` (and on demand via *Run workflow*). Pages'
source is **GitHub Actions**; there is no `gh-pages` branch and no CNAME file,
because the site is served from the project subpath. The base path lives in the
workflow (`VITE_BASE=/docwriter/`), not in `vite.config.ts`.

## Discoverability

`og-image.png` (1200×630, composed from the hero screenshot), `apple-touch-icon.png`,
`robots.txt`, `sitemap.xml`, a canonical link, OG/Twitter tags on both pages, and
JSON-LD SoftwareApplication on the index. All public URLs in the sitemap and 404
page use `https://rjbanti420.github.io/docwriter/`.

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
| `read-light-1440.png` | Read (theme strip, full screen) | Light | 1440×900 |
| `read-mocha-1440.png` | Read (theme strip, full screen) | Mocha | 1440×900 |
| `paste-sepia-1440.png` | Paste a chapter modal, filled in | Sepia | 1440 |
| `triage-sepia-1440.png` | Triage modal with quotes and key legend | Sepia | 1440 |
| `cards-sepia-1440.png` | Bible, typed cards | Sepia | 1440 |
| `planning-sepia-1440.png` | Planning, guns | Sepia | 1440 |
| `timeline-sepia-1440.png` | Timeline, Map | Sepia | 1440 |
| `settings-sepia-1440.png` | Settings, Look / Profile / Export | Sepia | 1440 |

The hero is a `deviceScaleFactor: 2` capture cropped to the `.paper` column and
downsampled to 1840×1020 for a 920×510 slot. The Light and Mocha images were
re-captured full-screen at 1440×900, with the theme set in the book's `meta`
table before starting the server; both show the same chapter in the same book.

`public/sample-book.db` (332 KB) was generated with `server/seed-demo.mjs` into a
temporary file, then given chapter 1 from `src/sample.ts` ("The Drowned Bell")
through the app's own API. It holds 137 entities and one chapter. Its WAL/SHM
sidecars were checkpointed and removed before shipping.

To re-capture the screenshots, run the app with a disposable `DOCWRITER_DB`
(`npm run build` plus `PORT=<port> DOCWRITER_DB=… node server/index.mjs` is enough
— no dev server needed), dismiss the export reminder, set `data-theme` or the
book's `meta.theme`, and capture with `Page.captureScreenshot`.

## Deliberately left out

- No testimonials, user counts, benchmarks, press, pricing, AI claims or comparison to other products.
- No feature that is not in `PRODUCT.md`, `README.md` or `HANDOFF.md`, or visible in the app.
- No relationship graph or link editor; no macOS build, no auto-update, no account or sync beyond what the guide states.
- No analytics, tracking or web fonts beyond the families the app already ships.
- WebP variants of the screenshots: ImageMagick is available, but a second asset set plus `<picture>` markup would need a build step to stay in sync with the PNGs. The PNGs total about 1.3 MB and all but the hero load lazily.
