const link=document.createElement('link'); link.rel='stylesheet'; link.href='/fonts.css'; document.head.appendChild(link);
import { createRoot } from 'react-dom/client';
import App from './App';
import StyleGuide from './views/StyleGuide';
import './styles.css';

// A hidden dev reference for the design tokens, reachable at #styleguide.
const showStyleGuide = window.location.hash === '#styleguide';

// Theme bootstrap: mocha default (dark-first), persisted in localStorage.
// Interface theme switch comes in Phase 5; this sets the initial theme.
const THEME_KEY = 'docwriter.theme';
const validThemes = new Set(['mocha', 'light', 'sepia']);
const stored = typeof window !== 'undefined' ? window.localStorage.getItem(THEME_KEY) : null;
const theme = stored && validThemes.has(stored) ? stored : 'mocha';
document.documentElement.setAttribute('data-theme', theme);
if (typeof window !== 'undefined' && (!stored || stored !== theme)) {
  window.localStorage.setItem(THEME_KEY, theme);
}

// Density bootstrap: comfortable default, toggled from Settings → Interface.
const DENSITY_KEY = 'docwriter.density';
const validDensities = new Set(['comfortable', 'compact']);
const storedDensity = typeof window !== 'undefined' ? window.localStorage.getItem(DENSITY_KEY) : null;
const density = storedDensity && validDensities.has(storedDensity) ? storedDensity : 'comfortable';
document.documentElement.setAttribute('data-density', density);

// Reading text size, driven by the reader toolbar (A− / A+), applied on load.
const READ_KEY = 'docwriter.readingSize';
const storedRead = typeof window !== 'undefined' ? Number(window.localStorage.getItem(READ_KEY)) : NaN;
if (storedRead >= 15 && storedRead <= 26) {
  document.documentElement.style.setProperty('--text-reading', `${storedRead}px`);
}

createRoot(document.getElementById('root')!).render(showStyleGuide ? <StyleGuide /> : <App />);
