import { useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { getEntityImage } from '../entityMedia';
import { getDeath } from '../entityRelations';
import { chapterNumber } from '../chapters';
import type { Chapter, Entity, Type } from '../types';

export default function BibleView({
  entities,
  chapters,
  types,
  onOpenEntity,
  onChanged,
}: {
  entities: Entity[];
  chapters: Chapter[];
  types: Type[];
  onOpenEntity: (id: number) => void;
  onChanged: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState<number | null>(types[0]?.id ?? null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function trashSelected() {
    if (!selected.size || busy) return;
    const n = selected.size;
    if (!confirm(`Move ${n} ${n === 1 ? 'entity' : 'entities'} to trash? You can restore them from Review → Trash.`)) return;
    setBusy(true);
    try {
      await api.trashEntities([...selected]);
      exitSelect();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const groups = new Map<string, Entity[]>();
  for (const e of entities) {
    const key = e.type_name || 'Uncategorised';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  const groupEntries = [...groups.entries()];
  const typeCount = groups.size;
  const shownGroups = filter === 'all' ? groupEntries : groupEntries.filter(([k]) => k === filter);

  return (
    <div className="main-inner bible">
      <div className="reader-head">
        <div className="reader-head__titles">
          <h1>The Bible</h1>
          <p className="reader-head__sub">
            {entities.length} {entities.length === 1 ? 'entity' : 'entities'} · {typeCount}{' '}
            {typeCount === 1 ? 'type' : 'types'}
          </p>
        </div>
        <div className="reader-head__actions">
          {selectMode ? (
            <>
              <button className="btn-secondary" onClick={() => setSelected(new Set(entities.map((x) => x.id)))}>
                Select all
              </button>
              <button className="btn-secondary" onClick={exitSelect}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn-secondary" onClick={() => setSelectMode(true)} disabled={entities.length === 0}>
                Select
              </button>
              <button className="btn-primary" onClick={() => setShowNew((v) => !v)}>＋ New entity</button>
            </>
          )}
        </div>
      </div>

      {selectMode && (
        <div className="select-bar">
          <span className="progress">{selected.size} selected</span>
          <div style={{ flex: 1 }} />
          <button className="btn-danger" disabled={selected.size === 0 || busy} onClick={trashSelected}>
            Move to trash
          </button>
        </div>
      )}

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
              className="btn-primary"
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
            <button className="btn-secondary" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      {entities.length === 0 ? (
        <div className="empty-state">
          The bible is empty. Paste a chapter and accept some names to start building it.
        </div>
      ) : (
        <>
          <div className="chips">
            <button
              className={`chip${filter === 'all' ? ' is-active' : ''}`}
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              All · {entities.length}
            </button>
            {groupEntries.map(([typeName, list]) => (
              <button
                key={typeName}
                className={`chip${filter === typeName ? ' is-active' : ''}`}
                aria-pressed={filter === typeName}
                onClick={() => setFilter((f) => (f === typeName ? 'all' : typeName))}
              >
                <span className="d" style={{ ['--e']: list[0].type_color } as CSSProperties} />
                {typeName} · {list.length}
              </button>
            ))}
          </div>

          {shownGroups.map(([typeName, list]) => (
            <div className="entity-group" key={typeName}>
              <div className="group-head">
                <span className="group-label">{typeName}</span>
                <span className="group-count">{list.length}</span>
                <span className="group-rule" />
              </div>
              <div className="entity-grid">
                {list.map((e) => {
                  const image = getEntityImage(e.fields);
                  const death = e.type_name === 'Character' ? getDeath(e.fields) : null;
                  const deathChapter = death?.chapter != null ? chapters.find((c) => c.id === death.chapter) : undefined;
                  return (
                    <button
                      className={`entity-card${death ? ' dead' : ''}${selectMode ? ' selecting' : ''}${selected.has(e.id) ? ' selected' : ''}`}
                      key={e.id}
                      onClick={() => (selectMode ? toggleSelect(e.id) : onOpenEntity(e.id))}
                    >
                      <div className="card-head">
                        {selectMode && (
                          <span className={`pick${selected.has(e.id) ? ' on' : ''}`} aria-hidden="true">
                            {selected.has(e.id) ? '✓' : ''}
                          </span>
                        )}
                        {image ? (
                          <img className="card-icon card-photo" src={image} alt="" loading="lazy" />
                        ) : (
                          <span className="card-icon" style={{ ['--e']: e.type_color } as CSSProperties}>
                            {e.type_icon}
                          </span>
                        )}
                        <div className="nm">
                          {death && <span title="Deceased">† </span>}
                          {e.name}
                        </div>
                      </div>
                      <div className="sub card-meta">
                        <span>{e.mention_count} mentions</span>
                        {e.first_chapter ? (
                          <span className="pill">ch.{e.first_chapter}–{e.last_chapter}</span>
                        ) : null}
                      </div>
                      {death && (
                        <div className="sub" style={{ color: 'var(--color-danger)' }}>
                          ☠ died{deathChapter ? ` in ch.${chapterNumber(deathChapter)}` : ''}
                        </div>
                      )}
                      {e.tracking !== 'off' && (
                        <div className="sub" style={{ color: 'var(--color-caution)' }}>
                          tracking · {e.tracking}
                          {e.gap_threshold ? ` ≥${e.gap_threshold}` : ''}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
