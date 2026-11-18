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
