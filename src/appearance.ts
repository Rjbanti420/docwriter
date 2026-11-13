// Appearance is stored in localStorage and in the book's meta table. The
// packaged app serves each run from a fresh port, so its origin — and its
// localStorage — resets on launch; the meta copy is what actually survives.

export const UI_FONT_STACKS: Record<string, string> = {
  'Hanken Grotesk': "'Hanken Grotesk', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  'Inter': "'Inter', system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  'system-ui': 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
};

export const READING_FONT_STACKS: Record<string, string> = {
  'Spectral': "'Spectral', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
  'Literata': "'Literata', Georgia, 'Source Serif 4', serif",
  'Georgia': "'Georgia', serif",
  'Source Serif 4': "'Source Serif 4', Georgia, serif",
  'serif': 'serif',
};

export const MIN_READ = 15;
export const MAX_READ = 26;

export function applyTheme(theme: string) {
  const valid = theme === 'light' || theme === 'sepia' ? theme : 'mocha';
  document.documentElement.setAttribute('data-theme', valid);
}

export function applyDensity(density: string) {
  document.documentElement.setAttribute('data-density', density === 'compact' ? 'compact' : 'comfortable');
}

export function applyFontUi(font: string) {
  document.documentElement.style.setProperty('--font-ui', UI_FONT_STACKS[font] ?? UI_FONT_STACKS['Hanken Grotesk']);
}

export function applyFontReading(font: string) {
  document.documentElement.style.setProperty(
    '--font-reading',
    READING_FONT_STACKS[font] ?? READING_FONT_STACKS['Spectral']
  );
}

export function applyReadingSize(size: number | null) {
  if (size == null || !Number.isFinite(size)) return;
  const clamped = Math.min(MAX_READ, Math.max(MIN_READ, Math.round(size)));
  document.documentElement.style.setProperty('--text-reading', `${clamped}px`);
}
