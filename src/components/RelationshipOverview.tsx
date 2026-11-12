import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { EntityRelationship } from '../types';

interface GraphNode {
  id: number;
  name: string;
  icon: string | null;
  trashed: boolean;
  x: number;
  y: number;
}

// Circle layout in graph coordinates (0–100). Deterministic, so the same data
// always draws the same picture and no edge is placed by chapter or date.
function layoutNodes(rows: EntityRelationship[]): GraphNode[] {
  const byId = new Map<number, Omit<GraphNode, 'x' | 'y'>>();
  const add = (id: number, name: string, icon: string | null, trashed: boolean) => {
    if (!byId.has(id)) byId.set(id, { id, name, icon, trashed });
  };
  for (const row of rows) {
    add(row.source_id, row.source_name, row.source_type_icon, Boolean(row.source_trashed_at));
    add(row.target_id, row.target_name, row.target_type_icon, Boolean(row.target_trashed_at));
  }
  const sorted = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  const count = Math.max(sorted.length, 1);
  return sorted.map((node, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return { ...node, x: 50 + 44 * Math.cos(angle), y: 50 + 44 * Math.sin(angle) };
  });
}

// Read-only overview of authored relationships. It lists edges that exist in
// the book and nothing else: no inferred graph, no sorted-by-mention guess.
export default function RelationshipOverview({ onOpenEntity }: { onOpenEntity: (id: number) => void }) {
  const [rows, setRows] = useState<EntityRelationship[] | null>(null);
  const [query, setQuery] = useState('');
  const [label, setLabel] = useState('all');
  const [view, setView] = useState<'list' | 'graph'>('list');
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

  // One colour per label, taken from the full label list so filtering never
  // repaints the graph. The chips double as the legend.
  const toneOf = useMemo(() => {
    const map = new Map<string, number>();
    labels.forEach(([name], index) => map.set(name, index % 8));
    return map;
  }, [labels]);

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

  const nodes = useMemo(() => layoutNodes(shown), [shown]);
  const positions = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

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
        <div className="rel-view" role="group" aria-label="Relationship view">
          <button
            type="button"
            className={view === 'list' ? 'is-active' : ''}
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            type="button"
            className={view === 'graph' ? 'is-active' : ''}
            aria-pressed={view === 'graph'}
            onClick={() => setView('graph')}
          >
            Graph
          </button>
        </div>
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
            <span className={`rel-swatch rel-c${toneOf.get(name) ?? 0}`} aria-hidden="true" />
            {name} · {count}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="dw-empty">No relationships match that filter.</div>
      ) : view === 'graph' ? (
        <div className="rel-graph-wrap">
          <p className="progress rel-graph__note">
            Every line is an edge you wrote, pointing from source to target. Colour follows the label, so the chips
            above are the legend. Nodes sit in alphabetical order; the circle is a layout, not a timeline.
          </p>
          <div className="rel-graph">
            <svg className="rel-graph__edges" viewBox="0 0 100 100" aria-hidden="true">
              <defs>
                {labels.map(([name], index) => (
                  <marker
                    key={name}
                    id={`rel-arrow-${index % 8}`}
                    className={`rel-c${index % 8}`}
                    viewBox="0 0 10 10"
                    refX="7"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M0,0 L10,5 L0,10 z" />
                  </marker>
                ))}
              </defs>
              {shown.map((row) => {
                const from = positions.get(row.source_id);
                const to = positions.get(row.target_id);
                if (!from || !to) return null;
                // Stop the line at the chip edge so the arrowhead stays visible
                // instead of disappearing under the node.
                const half = (node: GraphNode) => Math.min(13, 5 + node.name.length * 0.7);
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const length = Math.hypot(dx, dy) || 1;
                const ux = dx / length;
                const uy = dy / length;
                const tone = toneOf.get(row.label) ?? 0;
                return (
                  <line
                    key={row.id}
                    className={`rel-c${tone}`}
                    x1={from.x + ux * half(from)}
                    y1={from.y + uy * half(from)}
                    x2={to.x - ux * half(to)}
                    y2={to.y - uy * half(to)}
                    markerEnd={`url(#rel-arrow-${tone})`}
                  />
                );
              })}
            </svg>
            {nodes.map((node) => (
              <button
                type="button"
                key={node.id}
                className={`rel-graph__node${node.trashed ? ' is-trashed' : ''}`}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
                title={node.name}
                onClick={() => onOpenEntity(node.id)}
              >
                {node.icon && <span aria-hidden="true">{node.icon}</span>}
                <span className="rel-graph__name">{node.name}</span>
              </button>
            ))}
          </div>
        </div>
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
