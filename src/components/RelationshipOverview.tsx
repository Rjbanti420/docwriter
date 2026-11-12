import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { EntityRelationship } from '../types';

// Read-only overview of authored relationships. It lists edges that exist in
// the book and nothing else: no inferred graph, no sorted-by-mention guess.
export default function RelationshipOverview({ onOpenEntity }: { onOpenEntity: (id: number) => void }) {
  const [rows, setRows] = useState<EntityRelationship[] | null>(null);
  const [query, setQuery] = useState('');
  const [label, setLabel] = useState('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .allRelationships()
      .then((next) => live && setRows(next))
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, []);

  const labels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (rows ?? []).filter((row) => {
      if (label !== 'all' && row.label !== label) return false;
      if (!term) return true;
      return [row.source_name, row.target_name, row.label, row.notes]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [rows, label, query]);

  if (error) return <div className="dw-empty">Could not load relationships: {error}</div>;
  if (rows === null) return <div className="dw-empty">Loading relationships…</div>;
  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <h2>No relationships yet.</h2>
        <p>Open a card and add one under Relationships. Each edge is shown here exactly as you wrote it.</p>
      </div>
    );
  }

  return (
    <div className="rel-overview">
      <div className="rel-tools">
        <input
          type="search"
          value={query}
          placeholder="Search cards, labels or notes"
          aria-label="Search relationships"
          onChange={(ev) => setQuery(ev.target.value)}
        />
        <span className="progress">
          {shown.length} of {rows.length} {rows.length === 1 ? 'relationship' : 'relationships'}
        </span>
      </div>

      <div className="chips">
        <button
          className={`chip${label === 'all' ? ' is-active' : ''}`}
          aria-pressed={label === 'all'}
          onClick={() => setLabel('all')}
        >
          All · {rows.length}
        </button>
        {labels.map(([name, count]) => (
          <button
            key={name}
            className={`chip${label === name ? ' is-active' : ''}`}
            aria-pressed={label === name}
            onClick={() => setLabel((current) => (current === name ? 'all' : name))}
          >
            {name} · {count}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="dw-empty">No relationships match that filter.</div>
      ) : (
        <ul className="rel-list">
          {shown.map((row) => (
            <li className="rel-row" key={row.id}>
              <button type="button" className="rel-end" onClick={() => onOpenEntity(row.source_id)}>
                {row.source_type_icon && <span className="rel-icon">{row.source_type_icon}</span>}
                <span className="rel-name">{row.source_name}</span>
                {row.source_trashed_at && <span className="rel-tag">trash</span>}
              </button>
              <span className="rel-label">
                <span aria-hidden="true">→ </span>
                {row.label}
              </span>
              <button type="button" className="rel-end" onClick={() => onOpenEntity(row.target_id)}>
                {row.target_type_icon && <span className="rel-icon">{row.target_type_icon}</span>}
                <span className="rel-name">{row.target_name}</span>
                {row.target_trashed_at && <span className="rel-tag">trash</span>}
              </button>
              {row.notes && <p className="rel-notes">{row.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
