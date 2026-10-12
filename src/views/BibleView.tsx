import { useState } from 'react';
import { api } from '../api';
import type { Entity, Type } from '../types';

export default function BibleView({
  entities,
  types,
  onOpenEntity,
  onChanged,
}: {
  entities: Entity[];
  types: Type[];
  onOpenEntity: (id: number) => void;
  onChanged: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState<number | null>(types[0]?.id ?? null);

  const groups = new Map<string, Entity[]>();
  for (const e of entities) {
    const key = e.type_name || 'Uncategorised';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  return (
    <div className="main-inner">
      <div className="reader-head">
        <h1>The Bible</h1>
        <button onClick={() => setShowNew((v) => !v)}>＋ New entity</button>
      </div>

      {showNew && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="row">
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. House Vane" />
            </div>
            <div className="field">
              <label>Type</label>
              <select value={typeId ?? ''} onChange={(e) => setTypeId(Number(e.target.value))}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.icon} {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="actions">
            <button
              className="primary"
              disabled={!name.trim()}
              onClick={async () => {
                await api.createEntity({ name, typeId });
                setName('');
                setShowNew(false);
                onChanged();
              }}
            >
              Create
            </button>
            <button onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      {entities.length === 0 ? (
        <div className="empty-state">
          The bible is empty. Paste a chapter and accept some names to start building it.
        </div>
      ) : (
        [...groups.entries()].map(([typeName, list]) => (
          <div className="entity-group" key={typeName}>
            <h3>
              {list[0]?.type_icon} {typeName} · {list.length}
            </h3>
            <div className="entity-grid">
              {list.map((e) => (
                <button className="entity-card" key={e.id} onClick={() => onOpenEntity(e.id)}>
                  <div className="nm">
                    <span className="dot" style={{ background: e.type_color }} />
                    {e.name}
                  </div>
                  <div className="sub">
                    {e.mention_count} mentions
                    {e.first_chapter ? ` · ch.${e.first_chapter}–${e.last_chapter}` : ''}
                  </div>
                  {e.tracking !== 'off' && (
                    <div className="sub" style={{ color: '#b45309' }}>
                      tracking · {e.tracking}
                      {e.gap_threshold ? ` ≥${e.gap_threshold}` : ''}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
