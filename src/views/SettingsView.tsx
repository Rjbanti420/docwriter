import { useEffect, useState } from 'react';

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
  { id: 'Inter', label: 'Inter' },
  { id: 'system-ui', label: 'System UI' },
];

const READING_FONTS = [
  { id: 'Literata', label: 'Literata' },
  { id: 'Georgia', label: 'Georgia' },
  { id: 'Source Serif 4', label: 'Source Serif 4' },
  { id: 'serif', label: 'Serif (generic)' },
];

export default function SettingsView({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState('mocha');
  const [density, setDensity] = useState('comfortable');
  const [fontUi, setFontUi] = useState('Inter');
  const [fontReading, setFontReading] = useState('Literata');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [libraryPath, setLibraryPath] = useState('');

  useEffect(() => {
    try { setTheme(localStorage.getItem(THEME_KEY) || 'mocha'); } catch {}
    try { setDensity(localStorage.getItem(DENSITY_KEY) || 'comfortable'); } catch {}
    try { setFontUi(localStorage.getItem(FONT_UI_KEY) || 'Inter'); } catch {}
    try { setFontReading(localStorage.getItem(FONT_READING_KEY) || 'Literata'); } catch {}
    try { setName(localStorage.getItem('docwriter.profile.name') || ''); } catch {}
    try { setEmail(localStorage.getItem('docwriter.profile.email') || ''); } catch {}
    try { setLibraryPath(localStorage.getItem('docwriter.libraryPath') || (process.env.HOME||'') + '/Documents/DocWriter'); } catch {}
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
      const val = f === 'system-ui' ? 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' : "'Inter', system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
      document.documentElement.style.setProperty('--font-ui', val);
    } catch {}
  }

  function applyFontReading(f: string) {
    setFontReading(f);
    try {
      localStorage.setItem(FONT_READING_KEY, f);
      const val = f === 'Georgia' ? "'Georgia', serif" : f === 'serif' ? 'serif' : "'Literata', Georgia, serif";
      document.documentElement.style.setProperty('--font-reading', val);
    } catch {}
  }

  function saveProfile() {
    try { localStorage.setItem('docwriter.profile.name', name); localStorage.setItem('docwriter.profile.email', email); localStorage.setItem('docwriter.libraryPath', libraryPath); } catch {}
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
