const link=document.createElement('link'); link.rel='stylesheet'; link.href='/fonts.css'; document.head.appendChild(link);
import { createRoot } from 'react-dom/client';
import App from './App';
import StyleGuide from './views/StyleGuide';
import { applyDensity, applyFontReading, applyFontUi, applyReadingSize, applyTheme, MAX_READ, MIN_READ } from './appearance';
import './styles.css';

// A hidden dev reference for the design tokens, reachable at #styleguide.
const showStyleGuide = window.location.hash === '#styleguide';

// Boot from localStorage so the first paint is already right in the browser.
// App re-applies the copy in the book once /api/meta answers, because the
// packaged app gets a new origin (and empty storage) on every launch.
const read = (key: string) => {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};

applyTheme(read('docwriter.theme'));
applyDensity(read('docwriter.density'));
applyFontUi(read('docwriter.fontUi'));
applyFontReading(read('docwriter.fontReading'));
const storedRead = Number(read('docwriter.readingSize'));
if (storedRead >= MIN_READ && storedRead <= MAX_READ) applyReadingSize(storedRead);

createRoot(document.getElementById('root')!).render(showStyleGuide ? <StyleGuide /> : <App />);
