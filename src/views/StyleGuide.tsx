/**
 * Hidden design-token reference, reachable at #styleguide (no nav entry).
 * It renders every token so a theme change can be checked at a glance.
 * Phase 0 scaffold; grows as the redesign lands.
 */

const TYPE_COLORS: Array<{ name: string; icon: string; color: string }> = [
  { name: 'Character', icon: '👤', color: '#d97706' },
  { name: 'Country', icon: '🏳', color: '#059669' },
  { name: 'Organisation', icon: '🏛', color: '#7c3aed' },
  { name: 'Location', icon: '📍', color: '#0284c7' },
  { name: 'Item', icon: '🗡', color: '#db2777' },
];

const SWATCHES: Array<{ token: string; group: string }> = [
  { group: 'Surfaces', token: '--color-base' },
  { group: 'Surfaces', token: '--color-surface' },
  { group: 'Surfaces', token: '--color-surface-2' },
  { group: 'Surfaces', token: '--color-overlay' },
  { group: 'Text', token: '--color-text' },
  { group: 'Text', token: '--color-text-secondary' },
  { group: 'Text', token: '--color-text-faint' },
  { group: 'Text', token: '--color-text-subtle' },
  { group: 'Text', token: '--color-text-reading' },
  { group: 'Borders', token: '--color-border' },
  { group: 'Borders', token: '--color-border-strong' },
  { group: 'Accent', token: '--color-accent' },
  { group: 'Accent', token: '--color-accent-hover' },
  { group: 'Accent', token: '--color-accent-soft' },
  { group: 'Interactive', token: '--color-chip-bg' },
  { group: 'Interactive', token: '--color-tag-bg' },
  { group: 'Marks', token: '--color-mark-unknown' },
  { group: 'Marks', token: '--color-mark-unknown-hover' },
  { group: 'States', token: '--color-danger' },
  { group: 'States', token: '--color-danger-border' },
  { group: 'States', token: '--color-danger-bg' },
  { group: 'States', token: '--color-warn-bg' },
  { group: 'States', token: '--color-warn-border' },
  { group: 'States', token: '--color-warn-text' },
  { group: 'States', token: '--color-positive' },
  { group: 'States', token: '--color-caution' },
];

function Swatch({ token }: { token: string }) {
  return (
    <div className="sg-swatch">
      <div className="fill" style={{ background: `var(${token})` }} />
      <div className="meta">
        <strong>{token.replace('--color-', '')}</strong>
        {token}
      </div>
    </div>
  );
}

export default function StyleGuide() {
  const groups = [...new Set(SWATCHES.map((s) => s.group))];

  return (
    <div className="sg">
      <h1>Design tokens</h1>
      <p>
        Hidden reference page — reach it by adding <code>#styleguide</code> to the URL. Not linked
        from the app.
      </p>

      {groups.map((g) => (
        <section key={g}>
          <h2>{g}</h2>
          <div className="sg-swatches">
            {SWATCHES.filter((s) => s.group === g).map((s) => (
              <Swatch key={s.token} token={s.token} />
            ))}
          </div>
        </section>
      ))}

      <section>
        <h2>Typography</h2>
        <div className="sg-stack">
          <div style={{ fontSize: 24, fontWeight: 700 }}>Headline — 24px bold</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Section — 20px bold</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Modal title — 16px semibold</div>
          <div>Body — 14px UI sans, the default interface text.</div>
          <div style={{ color: 'var(--color-text-secondary)' }}>Secondary — muted helper text.</div>
          <div style={{ color: 'var(--color-text-faint)' }}>Faint — captions and counts.</div>
          <div className="reader-text" style={{ maxWidth: 640 }}>
            Reading text — 18px serif at 1.75 line-height. Ash walked the ridge at dawn, and the
            valley below still held the rain from the night before.
          </div>
        </div>
      </section>

      <section>
        <h2>Buttons</h2>
        <div className="sg-row">
          <button>Default</button>
          <button className="primary">Primary</button>
          <button className="ghost">Ghost</button>
          <button className="danger">Danger</button>
          <button disabled>Disabled</button>
        </div>
      </section>

      <section>
        <h2>Inputs</h2>
        <div className="sg-row" style={{ alignItems: 'stretch' }}>
          <input placeholder="Text input" style={{ width: 200 }} />
          <select style={{ width: 160 }} defaultValue="a">
            <option value="a">👤 Character</option>
            <option value="b">📍 Location</option>
          </select>
        </div>
      </section>

      <section>
        <h2>Chips, badges &amp; dots</h2>
        <div className="sg-row">
          <span className="chip">dialogue</span>
          <span className="chip">frequency</span>
          <span className="badge">3</span>
          <span className="tag">
            Ash
            <button>✕</button>
          </span>
          {TYPE_COLORS.map((t) => (
            <span className="sg-row" key={t.name} style={{ gap: 6 }}>
              <span className="dot" style={{ background: t.color }} />
              <span style={{ fontSize: 13 }}>{t.name}</span>
            </span>
          ))}
        </div>
      </section>

      <section>
        <h2>Tabs</h2>
        <div className="tabs">
          <button className="active">New names</button>
          <button>Trail alerts</button>
          <button>Rejected</button>
          <button>Trash</button>
        </div>
      </section>

      <section>
        <h2>Cards &amp; states</h2>
        <div className="entity-grid">
          <button className="entity-card">
            <div className="nm">
              <span className="dot" style={{ background: '#d97706' }} />
              Ash
            </div>
            <div className="sub">14 mentions · ch.1–9</div>
            <div className="sub" style={{ color: 'var(--color-caution)' }}>tracking · reappearance ≥3</div>
          </button>
          <div className="card">
            <div className="cand-name">
              Kite <span className="progress">4× · ch.2 · 72%</span>
            </div>
            <div className="cand-context">…came down from the pass.</div>
            <div className="lookalike" style={{ marginTop: 8 }}>Looks like <strong>Kite</strong> — same thing</div>
          </div>
        </div>
      </section>

      <section>
        <h2>Reader marks</h2>
        <div className="reader-text" style={{ maxWidth: 640 }}>
          <span className="mention" style={{ borderBottomColor: '#d97706' }}>Ash</span> met{' '}
          <span className="mention unknown">Jenna</span> at the ford.{' '}
          <span className="kbd">Enter</span> accept · <span className="kbd">L</span> later
        </div>
      </section>
    </div>
  );
}
