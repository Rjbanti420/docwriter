import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ExportMeta } from '../types';
import { applyDensity, applyFontReading, applyFontUi, applyTheme } from '../appearance';

const THEME_KEY = 'docwriter.theme';
const DENSITY_KEY = 'docwriter.density';
const FONT_UI_KEY = 'docwriter.fontUi';
const FONT_READING_KEY = 'docwriter.fontReading';

const THEMES = [
  { id: 'mocha', label: 'Mocha (dark)' },
  { id: 'light', label: 'Light' },
  { id: 'sepia', label: 'Sepia' },
];

const UI_FONTS = [
  { id: 'Hanken Grotesk', label: 'Hanken Grotesk' },
  { id: 'Inter', label: 'Inter' },
  { id: 'system-ui', label: 'System UI' },
];

const READING_FONTS = [
  { id: 'Spectral', label: 'Spectral' },
  { id: 'Literata', label: 'Literata' },
  { id: 'Georgia', label: 'Georgia' },
  { id: 'Source Serif 4', label: 'Source Serif 4' },
  { id: 'serif', label: 'Serif (generic)' },
];

/** How often to be reminded to export. `off` is a first-class choice, not a hidden one. */
const NUDGE_CHOICES = [
  { id: 'off', label: 'No reminder' },
  { id: 'daily', label: 'Every day' },
  { id: 'weekly', label: 'Every week' },
  { id: 'monthly', label: 'Every month' },
];

export default function SettingsView({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState('mocha');
  const [density, setDensity] = useState('comfortable');
  const [fontUi, setFontUi] = useState('Hanken Grotesk');
  const [fontReading, setFontReading] = useState('Spectral');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [meta, setMeta] = useState<ExportMeta | null>(null);
  const [exporting, setExporting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const noticeTimer = useRef<number | null>(null);

  // The reminder and appearance live in the book, so Settings reads them from
  // the API rather than localStorage — which the packaged app loses every launch.
  useEffect(() => {
    api.meta().then((m) => {
      setMeta(m);
      if (m.theme) setTheme(m.theme);
      if (m.density) setDensity(m.density);
      if (m.fontUi) setFontUi(m.fontUi);
      if (m.fontReading) setFontReading(m.fontReading);
      if (m.profileName) setName(m.profileName);
      if (m.profileEmail) setEmail(m.profileEmail);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    try { setTheme(localStorage.getItem(THEME_KEY) || 'mocha'); } catch {}
    try { setDensity(localStorage.getItem(DENSITY_KEY) || 'comfortable'); } catch {}
    try { setFontUi(localStorage.getItem(FONT_UI_KEY) || 'Hanken Grotesk'); } catch {}
    try { setFontReading(localStorage.getItem(FONT_READING_KEY) || 'Spectral'); } catch {}
    try { setName(localStorage.getItem('docwriter.profile.name') || ''); } catch {}
    try { setEmail(localStorage.getItem('docwriter.profile.email') || ''); } catch {}
  }, []);

  // Settings is a page, not a dialog, but it replaces the writer's place in the
  // book; the title takes focus so the keyboard starts at the top of it.
  useEffect(() => {
    titleRef.current?.focus();
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const say = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2500);
  };

  // Appearance applies before the write, so a failed write must not undo the
  // visible change — it reports instead.
  const remember = async (patch: Record<string, string>) => {
    try {
      setMeta(await api.setMeta(patch));
      return true;
    } catch {
      setError('Could not save that to the book. It applies now, but may not survive a restart.');
      return false;
    }
  };

  function applyThemeChoice(t: string) {
    setTheme(t);
    try { localStorage.setItem(THEME_KEY, t); } catch {}
    applyTheme(t);
    void remember({ theme: t });
  }

  function applyDensityChoice(d: string) {
    setDensity(d);
    try { localStorage.setItem(DENSITY_KEY, d); } catch {}
    applyDensity(d);
    void remember({ density: d });
  }

  function applyFontUiChoice(f: string) {
    setFontUi(f);
    try { localStorage.setItem(FONT_UI_KEY, f); } catch {}
    applyFontUi(f);
    void remember({ font_ui: f });
  }

  function applyFontReadingChoice(f: string) {
    setFontReading(f);
    try { localStorage.setItem(FONT_READING_KEY, f); } catch {}
    applyFontReading(f);
    void remember({ font_reading: f });
  }

  async function saveProfile() {
    try {
      localStorage.setItem('docwriter.profile.name', name);
      localStorage.setItem('docwriter.profile.email', email);
    } catch {}
    if (await remember({ profile_name: name, profile_email: email })) say('Profile saved.');
  }

  async function exportBook() {
    setExporting(true);
    setError('');
    try {
      // exportMarkdown stamps the date itself, once the file is really on disk.
      if (await api.exportMarkdown()) {
        setMeta(await api.meta());
        say('Exported as Markdown.');
      }
    } catch {
      setError('Could not write the export.');
    } finally {
      setExporting(false);
    }
  }

  async function downloadBackup() {
    if (backingUp) return;
    setBackingUp(true);
    setError('');
    try {
      await api.backup();
      say('Backup downloaded.');
    } catch {
      setError('Could not create the backup.');
    } finally {
      setBackingUp(false);
    }
  }

  async function changeNudge(nudge: string) {
    try {
      setMeta(await api.setMeta({ export_nudge: nudge }));
      say('Reminder saved.');
    } catch {
      setError('Could not save that reminder setting.');
    }
  }

  return (
    <div className="main-inner">
      <div className="reader-head">
        <div className="reader-head__titles">
          <h1 ref={titleRef} tabIndex={-1}>Settings</h1>
          <p className="reader-head__sub">
            Look is saved as you choose it; your profile saves with the button.
          </p>
        </div>
        <div className="reader-head__actions">
          <button className="ghost" aria-label="Close settings" onClick={onClose}>✕</button>
        </div>
      </div>

      {error && (
        <div className="save-error" role="alert">
          <div>
            <strong>That didn’t go through.</strong> {error}
          </div>
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      {notice && (
        <p className="progress" role="status">{notice}</p>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>User</h2>
        <div className="field">
          <label htmlFor="set-name">Name</label>
          <input id="set-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="set-email">Email (placeholder for future sync)</label>
          <input id="set-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="actions"><button className="btn-secondary" onClick={saveProfile}>Save profile</button></div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Export</h2>
        <p className="progress" style={{ marginTop: 0, marginBottom: 8 }}>
          Writes the whole book to one Markdown file — every chapter’s current draft, the Bible and
          Planning. Images, Trash and the Review queue stay behind.
          {meta?.lastExportAt && <> Last exported {meta.lastExportAt}.</>}
        </p>
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="primary" disabled={exporting} onClick={exportBook}>
            {exporting ? 'Exporting…' : 'Export as Markdown'}
          </button>
        </div>
        <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
          <label htmlFor="set-nudge">Remind me to export</label>
          <select id="set-nudge" value={meta?.nudge ?? 'daily'} disabled={!meta} onChange={(e) => changeNudge(e.target.value)}>
            {NUDGE_CHOICES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Backup</h2>
        <p className="progress" style={{ marginTop: 0, marginBottom: 8 }}>
          Saves a complete, self-contained copy of this book — the whole database, including
          everything written since the last checkpoint.
        </p>
        <p className="progress" style={{ marginTop: 0, marginBottom: 12 }}>
          This book is one file: <code className="book-path">{meta?.bookPath || '…'}</code>
        </p>
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="btn-secondary" disabled={backingUp} onClick={downloadBackup}>
            {backingUp ? 'Preparing…' : 'Download a backup'}
          </button>
        </div>
      </section>

      <section className="card">
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Interface</h2>
        <div className="field">
          <label>Theme</label>
          <div className="type-row">
            {THEMES.map(t => (
              <button
                key={t.id}
                className={theme === t.id ? 'type-btn sel' : 'type-btn'}
                aria-pressed={theme === t.id}
                onClick={() => applyThemeChoice(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Density</label>
          <div className="segmented">
            <button aria-pressed={density === 'comfortable'} className={density === 'comfortable' ? 'active' : ''} onClick={() => applyDensityChoice('comfortable')}>Comfortable</button>
            <button aria-pressed={density === 'compact'} className={density === 'compact' ? 'active' : ''} onClick={() => applyDensityChoice('compact')}>Compact</button>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="set-font-ui">UI font</label>
            <select id="set-font-ui" value={fontUi} onChange={(e) => applyFontUiChoice(e.target.value)}>
              {UI_FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="set-font-reading">Reading font</label>
            <select id="set-font-reading" value={fontReading} onChange={(e) => applyFontReadingChoice(e.target.value)}>
              {READING_FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}
