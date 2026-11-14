import { useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { createEntityWithConflictPrompt } from '../nameConflict';
import { getDeath } from '../entityRelations';
import { chapterNumber } from '../chapters';
import type { Chapter, Entity, Type } from '../types';

type StateFilter = 'mentioned' | 'unmentioned' | 'dead' | 'tracking';

const STATE_CHIPS: [StateFilter, string][] = [
  ['mentioned', 'Mentioned'],
  ['unmentioned', 'Unmentioned'],
  ['dead', 'Dead'],
  ['tracking', 'Tracking'],
];

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
  const [sort, setSort] = useState<'name' | 'mentions'>('name');
  const [compact, setCompact] = useState(false);
  const [states, setStates] = useState<Set<StateFilter>>(new Set());

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
  const typeEntries = filter === 'all' ? groupEntries : groupEntries.filter(([k]) => k === filter);

  const isDead = (e: Entity) => e.type_name === 'Character' && !!getDeath(e.fields);
  const isTracking = (e: Entity) => e.tracking !== 'off';
  const mentions = (e: Entity) => e.mention_count ?? 0;
  const matchesState = (e: Entity) => {
    if (states.size === 0) return true;
    if (states.has('mentioned') && mentions(e) > 0) return true;
    if (states.has('unmentioned') && mentions(e) === 0) return true;
    if (states.has('dead') && isDead(e)) return true;
    if (states.has('tracking') && isTracking(e)) return true;
    return false;
  };

  // Counts follow the type filter, so each chip shows what it would add to the current view.
  const pool = typeEntries.flatMap(([, list]) => list);
  const stateCounts: Record<StateFilter, number> = { mentioned: 0, unmentioned: 0, dead: 0, tracking: 0 };
  for (const e of pool) {
    if (mentions(e) > 0) stateCounts.mentioned += 1;
    else stateCounts.unmentioned += 1;
    if (isDead(e)) stateCounts.dead += 1;
    if (isTracking(e)) stateCounts.tracking += 1;
  }

  const byName = (a: Entity, b: Entity) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const sortList = (list: Entity[]) =>
    [...list].sort(sort === 'name' ? byName : (a, b) => mentions(b) - mentions(a) || byName(a, b));
  const shownGroups = typeEntries
    .map(([name, list]) => [name, sortList(list.filter(matchesState))] as const)
    .filter(([, list]) => list.length > 0);

  function toggleState(s: StateFilter) {
    setStates((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function clearFilters() {
    setStates(new Set());
    setFilter('all');
  }

  return (
    <div className={`main-inner bible${compact ? ' is-compact' : ''}`}>
      <div className="reader-head">
        <div className="reader-head__titles">
          <h1>The Bible</h1>
          <p className="reader-head__sub">
            {entities.length} {entities.length === 1 ? 'entity' : 'entities'} · {typeCount}{' '}
            {typeCount === 1 ? 'type' : 'types'}
          </p>
        </div>
        <div className="reader-head__actions">
          <select
            className="bible-sort"
            aria-label="Sort cards"
            value={sort}
            onChange={(e) => setSort(e.target.value as 'name' | 'mentions')}
          >
            <option value="name">Name A–Z</option>
            <option value="mentions">Most mentioned</option>
          </select>
          <button
            className="btn-secondary"
            aria-pressed={compact}
            onClick={() => setCompact((v) => !v)}
            title={compact ? 'Show full cards' : 'Show compact rows'}
          >
            {compact ? 'Cards' : 'Compact'}
          </button>
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
                if (!(await createEntityWithConflictPrompt({ name, typeId }))) return;
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
          <div className="chips chips--stacked">
            <div className="chips-row">
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
            <div className="chips-row">
              <span className="chips-label">Show</span>
              {STATE_CHIPS.map(([key, label]) => (
                <button
                  key={key}
                  className={`chip${states.has(key) ? ' is-active' : ''}`}
                  aria-pressed={states.has(key)}
                  onClick={() => toggleState(key)}
                >
                  {label} · {stateCounts[key]}
                </button>
              ))}
            </div>
          </div>

          {shownGroups.length === 0 && (
            <div className="empty-state">
              No cards match these filters.{' '}
              <button className="btn-secondary" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}

          {shownGroups.map(([typeName, list]) => (
            <div className="entity-group" key={typeName}>
              <h2 className="group-head">
                <span className="group-label">{typeName}</span>
                <span className="group-count">{list.length}</span>
                <span className="group-rule" aria-hidden="true" />
              </h2>
              <div className="entity-grid">
                {list.map((e) => {
                  const image = e.has_image ? `/api/entities/${e.id}/image` : null;
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
                        <div className="badge badge-dead">
                          died{deathChapter ? ` in ch.${chapterNumber(deathChapter)}` : ''}
                        </div>
                      )}
                      {e.tracking !== 'off' && (
                        <div className="sub card-tracking" style={{ color: 'var(--color-caution)' }}>
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
