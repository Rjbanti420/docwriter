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

createRoot(document.getElementById('root')!).render(showStyleGuide ? <StyleGuide /> : <App />);
