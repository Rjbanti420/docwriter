import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ExportMeta } from '../types';

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
  const [libraryPath, setLibraryPath] = useState('');
  const [meta, setMeta] = useState<ExportMeta | null>(null);
  const [exporting, setExporting] = useState(false);

  // The reminder state lives in the book, so Settings reads it from the API
  // rather than from localStorage — which the packaged app loses every launch.
  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    try { setTheme(localStorage.getItem(THEME_KEY) || 'mocha'); } catch {}
    try { setDensity(localStorage.getItem(DENSITY_KEY) || 'comfortable'); } catch {}
    try { setFontUi(localStorage.getItem(FONT_UI_KEY) || 'Hanken Grotesk'); } catch {}
    try { setFontReading(localStorage.getItem(FONT_READING_KEY) || 'Spectral'); } catch {}
    try { setName(localStorage.getItem('docwriter.profile.name') || ''); } catch {}
    try { setEmail(localStorage.getItem('docwriter.profile.email') || ''); } catch {}
    try { setLibraryPath(localStorage.getItem('docwriter.libraryPath') || '~/Documents/DocWriter'); } catch {}
  }, []);

  function applyTheme(t: string) {
    setTheme(t);
    try { localStorage.setItem(THEME_KEY, t); document.documentElement.setAttribute('data-theme', t); } catch {}
  }

  function applyDensity(d: string) {
    setDensity(d);
    try { localStorage.setItem(DENSITY_KEY, d); document.documentElement.setAttribute('data-density', d); } catch {}
  }

  function applyFontUi(f: string) {
    setFontUi(f);
    try {
      localStorage.setItem(FONT_UI_KEY, f);
      const stacks: Record<string, string> = {
        'Hanken Grotesk': "'Hanken Grotesk', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        'Inter': "'Inter', system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        'system-ui': 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
      };
      document.documentElement.style.setProperty('--font-ui', stacks[f] || stacks['Hanken Grotesk']);
    } catch {}
  }

  function applyFontReading(f: string) {
    setFontReading(f);
    try {
      localStorage.setItem(FONT_READING_KEY, f);
      const stacks: Record<string, string> = {
        'Spectral': "'Spectral', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
        'Literata': "'Literata', Georgia, 'Source Serif 4', serif",
        'Georgia': "'Georgia', serif",
        'Source Serif 4': "'Source Serif 4', Georgia, serif",
        'serif': 'serif',
      };
      document.documentElement.style.setProperty('--font-reading', stacks[f] || stacks['Spectral']);
    } catch {}
  }

  function saveProfile() {
    try { localStorage.setItem('docwriter.profile.name', name); localStorage.setItem('docwriter.profile.email', email); localStorage.setItem('docwriter.libraryPath', libraryPath); } catch {}
  }

  async function exportBook() {
    setExporting(true);
    try {
      // exportMarkdown stamps the date itself, once the file is really on disk.
      if (await api.exportMarkdown()) setMeta(await api.meta());
    } catch {
      alert('Could not write the export.');
    } finally {
      setExporting(false);
    }
  }

  async function changeNudge(nudge: string) {
    try {
      setMeta(await api.setMeta({ export_nudge: nudge }));
    } catch {
      alert('Could not save that reminder setting.');
    }
  }

  return (
    <div className="main-inner">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <h1 style={{margin:0,fontSize:20}}>Profile / Settings</h1>
        <button className="ghost" onClick={onClose}>✕</button>
      </div>

      <section style={{marginBottom:16}} className="card">
        <h2 style={{margin:'0 0 10px',fontSize:16}}>User</h2>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e)=>setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Email (placeholder for future sync)</label>
          <input value={email} onChange={(e)=>setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Library path</label>
          <input value={libraryPath} onChange={(e)=>setLibraryPath(e.target.value)} />
        </div>
        <div className="actions"><button className="primary" onClick={saveProfile}>Save profile</button></div>
      </section>

      <section style={{marginBottom:16}} className="card">
        <h2 style={{margin:'0 0 10px',fontSize:16}}>Projects</h2>
        <p className="progress" style={{marginTop:0,marginBottom:8}}>Library folder: <code>{libraryPath || '~/Documents/DocWriter'}</code></p>
        <div className="actions" style={{marginTop:0}}>
          <button onClick={async ()=>{ try{ const list=await (await import('../api')).api.projects(); alert('Projects: '+list.length); }catch(e){alert('err');}}}>Load projects</button>
        </div>
      </section>

      <section style={{marginBottom:16}} className="card">
        <h2 style={{margin:'0 0 10px',fontSize:16}}>Export</h2>
        <p className="progress" style={{marginTop:0,marginBottom:8}}>
          Writes the whole book to one Markdown file — every chapter’s current draft, the Bible and
          Planning. Images, Trash and the Review queue stay behind.
          {meta?.lastExportAt && <> Last exported {meta.lastExportAt}.</>}
        </p>
        <div className="actions" style={{marginTop:0}}>
          <button className="primary" disabled={exporting} onClick={exportBook}>
            {exporting ? 'Exporting…' : 'Export as Markdown'}
          </button>
        </div>
        <div className="field" style={{marginTop:12,marginBottom:0}}>
          <label>Remind me to export</label>
          <select value={meta?.nudge ?? 'daily'} disabled={!meta} onChange={(e)=>changeNudge(e.target.value)}>
            {NUDGE_CHOICES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </section>

      <section style={{marginBottom:16}} className="card">
        <h2 style={{margin:'0 0 10px',fontSize:16}}>Backup</h2>
        <p className="progress" style={{marginTop:0,marginBottom:8}}>
          Saves a complete, self-contained copy of this book — the whole database, including
          everything written since the last checkpoint.
        </p>
        <div className="actions" style={{marginTop:0}}>
          <button className="primary" onClick={() => api.backup().catch(() => alert('Could not create the backup.'))}>
            Download a backup
          </button>
        </div>
      </section>

      <section className="card">
        <h2 style={{margin:'0 0 10px',fontSize:16}}>Interface</h2>
        <div className="field">
          <label>Theme</label>
          <div className="type-row">
            {THEMES.map(t => <button key={t.id} className={theme===t.id?'type-btn sel':'type-btn'} onClick={()=>applyTheme(t.id)}>{t.label}</button>)}
          </div>
        </div>
        <div className="field">
          <label>Density</label>
          <div className="segmented">
            <button aria-pressed={density==='comfortable'} className={density==='comfortable'?'active':''} onClick={()=>applyDensity('comfortable')}>Comfortable</button>
            <button aria-pressed={density==='compact'} className={density==='compact'?'active':''} onClick={()=>applyDensity('compact')}>Compact</button>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>UI font</label>
            <select value={fontUi} onChange={(e)=>applyFontUi(e.target.value)}>
              {UI_FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Reading font</label>
            <select value={fontReading} onChange={(e)=>applyFontReading(e.target.value)}>
              {READING_FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}
