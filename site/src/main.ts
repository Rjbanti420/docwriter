// Scroll reveal is opted into here rather than in the markup, so a page whose
// script never runs stays fully readable.
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

if (!reduce.matches && 'IntersectionObserver' in window) {
  const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');

  if (targets.length) {
    document.documentElement.classList.add('has-reveal');

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0 },
    );

    targets.forEach((target) => observer.observe(target));
  }
}

// Current-section marker for the in-page nav. On guide.html the nav links point
// at another page, so nothing here matches and the script is a no-op.
const navLinks = document.querySelectorAll<HTMLAnchorElement>('.nav a[href^="#"]');
const links = new Map([...navLinks].map((link) => [link.getAttribute('href')!.slice(1), link]));

if (links.size && 'IntersectionObserver' in window) {
  const marker = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const link = links.get(entry.target.id);
        if (!link) continue;
        if (entry.isIntersecting) {
          links.forEach((other) => other.removeAttribute('aria-current'));
          link.setAttribute('aria-current', 'location');
        } else if (link.getAttribute('aria-current') === 'location') {
          link.removeAttribute('aria-current');
        }
      }
    },
    // A thin band across the middle of the viewport, so one section owns the marker at a time.
    { rootMargin: '-45% 0px -45% 0px' },
  );

  for (const id of links.keys()) {
    const section = document.getElementById(id);
    if (section) marker.observe(section);
  }
}

// The download links ship as direct asset URLs, so the page works with this
// script blocked. When the API answers, the same links are refreshed from the
// latest release; any failure leaves the markup untouched and stays quiet.
type AssetKey = 'win-exe' | 'win-zip' | 'appimage' | 'deb' | 'sums';

const MB = 1048576;
const sizes: Record<AssetKey, string> = {
  'win-exe': '109.4 MB',
  'win-zip': '149.6 MB',
  appimage: '122.9 MB',
  deb: '98.0 MB',
  sums: '',
};
const patterns: Record<AssetKey, RegExp> = {
  'win-exe': /-win-x64\.exe$/i,
  'win-zip': /-win-x64\.zip$/i,
  appimage: /\.AppImage$/i,
  deb: /_amd64\.deb$/i,
  sums: /^SHA256SUMS\.txt$/i,
};

const primary = document.querySelector<HTMLAnchorElement>('[data-primary]');
const primaryNone = document.querySelector<HTMLElement>('[data-primary-none]');
const primarySize = document.querySelector<HTMLElement>('[data-size]');
const sizeWrap = document.querySelector<HTMLElement>('[data-size-wrap]');

function applyOs(): void {
  const ua = navigator.userAgent;
  const isLinux = /Linux|X11/i.test(ua) && !/Android/i.test(ua);
  const key: AssetKey | null = /Windows/i.test(ua) ? 'win-exe' : isLinux ? 'appimage' : null;

  if (sizeWrap) sizeWrap.hidden = !key;
  if (primary) {
    if (!key) {
      primary.hidden = true;
      if (primaryNone) primaryNone.hidden = false;
    } else {
      primary.textContent = key === 'win-exe' ? 'Download for Windows' : 'Download for Linux';
      primary.hidden = false;
      if (primaryNone) primaryNone.hidden = true;
    }
  }

  if (!key) return;
  const link = document.querySelector<HTMLAnchorElement>(`[data-dl="${key}"]`);
  if (!link) return;

  document.querySelectorAll<HTMLAnchorElement>('[data-os-link]').forEach((el) => (el.href = link.href));
  if (primary) {
    primary.href = link.href;
    if (primarySize) primarySize.textContent = sizes[key];
  }
}

async function syncRelease(): Promise<void> {
  const response = await fetch('https://api.github.com/repos/Rjbanti420/docwriter/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) return;

  const release = (await response.json()) as { tag_name?: unknown; assets?: unknown };
  const assets = Array.isArray(release.assets) ? release.assets : [];

  for (const [key, pattern] of Object.entries(patterns) as [AssetKey, RegExp][]) {
    const asset = assets.find(
      (item): item is { name: string; size?: unknown; browser_download_url: string } =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { name?: unknown }).name === 'string' &&
        pattern.test((item as { name: string }).name) &&
        typeof (item as { browser_download_url?: unknown }).browser_download_url === 'string',
    );
    if (!asset) continue;

    document
      .querySelectorAll<HTMLAnchorElement>(`[data-dl="${key}"]`)
      .forEach((link) => (link.href = asset.browser_download_url));

    if (key === 'sums') continue;
    const size = Number(asset.size);
    if (!Number.isFinite(size) || size <= 0) continue;
    sizes[key] = `${(size / MB).toFixed(1)} MB`;
    document
      .querySelectorAll<HTMLElement>(`[data-size-for="${key}"]`)
      .forEach((label) => (label.textContent = sizes[key]));
  }

  if (typeof release.tag_name === 'string') {
    const version = release.tag_name.replace(/^v/, '');
    document.querySelectorAll<HTMLElement>('[data-version]').forEach((el) => (el.textContent = version));
  }

  applyOs();
}

applyOs();
void syncRelease().catch(() => {});
