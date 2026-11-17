import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ExportMeta } from '../types';
import { applyDensity, applyFontReading, applyFontUi, applyTheme } from '../appearance';
import {
  KEY_ACTIONS,
  acceleratorFromEvent,
  bindings,
  formatAccelerator,
  isMac,
  loadBindings,
  resetBindings,
  setBinding,
} from '../shortcuts';
import { desktop, openBookAt, pickBook } from '../desktop';

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
const KEY_GROUPS = [...new Set(KEY_ACTIONS.map((action) => action.group))].map((group) => ({
  group,
  actions: KEY_ACTIONS.filter((action) => action.group === group),
}));

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
  const [keys, setKeys] = useState<Record<string, string>>(() => ({ ...bindings() }));
  const [capturing, setCapturing] = useState<string | null>(null);
  const [keyError, setKeyError] = useState('');
  const [keyErrorFor, setKeyErrorFor] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const noticeTimer = useRef<number | null>(null);
  // The profile saves when a field is left, and once more if the page is closed
  // with an edit still unsaved. A ref, because the unmount cleanup cannot see
  // later renders.
  const profileNow = useRef({ name: '', email: '', dirty: false });

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
      profileNow.current.name = m.profileName ?? '';
      profileNow.current.email = m.profileEmail ?? '';
    }).catch(() => {});
  }, []);

  useEffect(() => {
    void loadBindings().then(() => setKeys({ ...bindings() }));
  }, []);

  useEffect(() => {
    try { setTheme(localStorage.getItem(THEME_KEY) || 'mocha'); } catch {}
    try { setDensity(localStorage.getItem(DENSITY_KEY) || 'comfortable'); } catch {}
    try { setFontUi(localStorage.getItem(FONT_UI_KEY) || 'Hanken Grotesk'); } catch {}
    try { setFontReading(localStorage.getItem(FONT_READING_KEY) || 'Spectral'); } catch {}
    try {
      const storedName = localStorage.getItem('docwriter.profile.name') || '';
      const storedEmail = localStorage.getItem('docwriter.profile.email') || '';
      setName(storedName);
      setEmail(storedEmail);
      profileNow.current.name = storedName;
      profileNow.current.email = storedEmail;
    } catch {}
  }, []);

  // Settings is a page, not a dialog, but it replaces the writer's place in the
  // book; the title takes focus so the keyboard starts at the top of it.
  useEffect(() => {
    titleRef.current?.focus();
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  // The status pill sits under the top bar, whose height changes when it wraps.
  useEffect(() => {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const track = () =>
      document.documentElement.style.setProperty(
        '--topbar-h',
        `${Math.round(bar.getBoundingClientRect().height)}px`,
      );
    track();
    const ro = new ResizeObserver(track);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  // Leaving Settings must not drop a typed name the way a plain field would:
  // the page saves it on the way out.
  useEffect(() => {
    return () => {
      if (profileNow.current.dirty) void saveProfile(false);
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

  function changeProfile(field: 'name' | 'email', value: string) {
    if (field === 'name') setName(value);
    else setEmail(value);
    profileNow.current[field] = value;
    profileNow.current.dirty = true;
  }

  async function saveProfile(announce: boolean) {
    const p = profileNow.current;
    if (!p.dirty) return;
    p.dirty = false;
    try {
      localStorage.setItem('docwriter.profile.name', p.name);
      localStorage.setItem('docwriter.profile.email', p.email);
    } catch {}
    if (!(await remember({ profile_name: p.name, profile_email: p.email }))) {
      p.dirty = true;
      return;
    }
    if (announce) say('Profile saved.');
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

  // Capturing a chord has to happen in the capture phase: the app's own key
  // layer (and Escape closing Settings) must not act on the keys being recorded.
  useEffect(() => {
    if (!capturing) return;
    const actionId = capturing;
    const onKey = (ev: KeyboardEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        setCapturing(null);
        setKeyError('');
        setKeyErrorFor(null);
        return;
      }
      const result = acceleratorFromEvent(ev);
      if (!result) return; // only modifiers so far: keep waiting
      if ('error' in result) {
        setKeyError(result.error ?? 'That key cannot be used.');
        setKeyErrorFor(actionId);
        return;
      }
      void saveKey(actionId, result.value);
    };
    // A click anywhere else is a way out. Without this the page stays armed
    // and the next stray keypress becomes a binding.
    const onPointer = (ev: PointerEvent) => {
      if ((ev.target as Element | null)?.closest(`[data-key-action="${actionId}"]`)) return;
      setCapturing(null);
      setKeyError('');
      setKeyErrorFor(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [capturing]);

  async function saveKey(id: string, accelerator: string) {
    const result = await setBinding(id, accelerator);
    if (!result.ok) {
      setKeyError(result.error ?? 'Could not save that shortcut.');
      setKeyErrorFor(id);
      return;
    }
    setKeys({ ...bindings() });
    setCapturing(null);
    setKeyError('');
    setKeyErrorFor(null);
    say('Shortcut saved.');
  }

  async function resetKeys() {
    const ok = confirm('Put every shortcut back to its default? Your custom keys will be forgotten.');
    if (!ok) return;
    const result = await resetBindings();
    if (!result.ok) {
      setKeyError(result.error ?? 'Could not reset the shortcuts.');
      return;
    }
    setKeys({ ...bindings() });
    setCapturing(null);
    setKeyError('');
    setKeyErrorFor(null);
    say('Shortcuts reset to defaults.');
  }

  // Settings is entered through the app's own guard, so nothing is dirty here.
  async function openAnotherBook() {
    const filePath = await pickBook('open');
    if (!filePath) return;
    const problem = await openBookAt(filePath);
    if (problem) setError(problem);
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
            Look, keyboard and profile are kept as you go.
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
        <p className="progress notice" role="status">{notice}</p>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Look</h2>
        <div className="field">
          <label>Theme</label>
          <div className="segmented">
            {THEMES.map(t => (
              <button
                key={t.id}
                className={theme === t.id ? 'active' : ''}
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

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Profile</h2>
        <div className="field">
          <label htmlFor="set-name">Name</label>
          <input
            id="set-name"
            value={name}
            onChange={(e) => changeProfile('name', e.target.value)}
            onBlur={() => void saveProfile(true)}
          />
        </div>
        <div className="field">
          <label htmlFor="set-email">Email</label>
          <input
            id="set-email"
            value={email}
            onChange={(e) => changeProfile('email', e.target.value)}
            onBlur={() => void saveProfile(true)}
          />
        </div>
        <p className="card-note" style={{ margin: '10px 0 0' }}>
          Saved when you leave a field, and if you close the page mid-edit.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Export</h2>
        <p className="card-note">
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
        <p className="card-note">
          Saves a complete, self-contained copy of this book — the whole database, including
          everything written since the last checkpoint.
        </p>
        <p className="card-note">
          This book is one file: <code className="book-path">{meta?.bookPath || '…'}</code>
        </p>
        <p className="card-note">
          To move a book to another computer, take that file with you and choose{' '}
          <strong>Open book…</strong> there — every chapter, card and setting travels with it.
        </p>
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="btn-secondary" disabled={backingUp} onClick={downloadBackup}>
            {backingUp ? 'Preparing…' : 'Download a backup'}
          </button>
          <button className="btn-secondary" disabled={!desktop()} onClick={() => void openAnotherBook()}>
            Open book…
          </button>
        </div>
      </section>

      {/* Reference, not a preference: it stays folded until the writer asks. */}
      <details className="card kbcard">
        <summary className="kbcard__sum">
          <h2 className="kbcard__title">Keyboard</h2>
          <span className="kbcard__count">{KEY_ACTIONS.length} shortcuts</span>
          <svg className="kbcard__chev" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="kbcard__body">
          <p className="card-note">
            The app’s own shortcuts. Keys that belong to a panel — Escape, Tab, the arrows inside a
            list — stay with the panel. Choose a key, then press the combination you want; it saves
            at once and Escape cancels.
          </p>
          {KEY_GROUPS.map(({ group, actions }) => (
            <div className="kbset" key={group}>
              <h3 className="kbset__title">{group}</h3>
              {actions.map((action) => (
                <Fragment key={action.id}>
                  <div className="kbset__row">
                    <span className="kbset__label">{action.label}</span>
                    <button
                      className={`kbset__key${capturing === action.id ? ' is-capturing' : ''}`}
                      data-key-action={action.id}
                      aria-label={
                        capturing === action.id
                          ? `Waiting for keys for ${action.label}. Press Escape to cancel.`
                          : `Change ${action.label}, currently ${formatAccelerator(keys[action.id], isMac())}`
                      }
                      onClick={() => {
                        setCapturing(action.id);
                        setKeyError('');
                        setKeyErrorFor(null);
                      }}
                    >
                      {capturing === action.id ? 'Press keys…' : formatAccelerator(keys[action.id], isMac())}
                    </button>
                  </div>
                  {capturing === action.id && (
                    <p className="kbset__hint" role="status">
                      Press the new combination · Esc to cancel
                    </p>
                  )}
                  {keyError && keyErrorFor === action.id && (
                    <p className="kbset__error" role="alert">{keyError}</p>
                  )}
                </Fragment>
              ))}
            </div>
          ))}
          <div className="actions">
            <button className="btn-secondary" onClick={() => void resetKeys()}>
              Reset to defaults
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
