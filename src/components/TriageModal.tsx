import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Candidate, Type } from '../types';

export default function TriageModal({
  items,
  index,
  types,
  onResolve,
  onNavigate,
  onClose,
}: {
  items: Candidate[];
  index: number;
  types: Type[];
  onResolve: (candidate: Candidate, action: string, extra?: Record<string, unknown>) => void;
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const [typeId, setTypeId] = useState<number | null>(null);
  const [full, setFull] = useState<Candidate | null>(null);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [bulkTypeId, setBulkTypeId] = useState<number | null>(
    () => types.find((t) => t.name === 'Character')?.id ?? types[0]?.id ?? null
  );
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  useEffect(() => {
    if (item) {
      const fallback = types.find((t) => t.name === 'Character')?.id ?? types[0]?.id ?? null;
      setTypeId(item.suggested_type_id ?? fallback);
    }
  }, [item?.id, types]);

  // Review rows carry one context to stay small; the modal fetches the full
  // occurrence list only for the row actually open.
  useEffect(() => {
    let cancelled = false;
    setFull(null);
    if (!item) return;
    api
      .candidate(item.id)
      .then((c: Candidate) => {
        if (!cancelled) setFull(c);
      })
      .catch(() => {
        /* resolved or deleted meanwhile */
      });
    return () => {
      cancelled = true;
    };
  }, [item?.id]);

  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const toggleSelected = (id: number) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () => setSelectedIds(allSelected ? [] : items.map((it) => it.id));
  const bulkResolve = async (action: string, extra?: Record<string, unknown>) => {
    const chosen = items.filter((it) => selectedIds.includes(it.id));
    setSelectedIds([]);
    for (const it of chosen) await onResolve(it, action, extra);
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!item) return;
      if (view === 'grid') {
        if (e.key === 'Escape') onClose();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        onResolve(item, 'accept', { typeId });
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const i = types.findIndex((t) => t.id === typeId);
        const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + types.length) % types.length;
        setTypeId(types[next].id);
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        onResolve(item, 'later');
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        onResolve(item, 'ignore');
      } else if (e.key === 'Escape') {
        onClose();
      } else if (/^[1-9]$/.test(e.key)) {
        const t = types[Number(e.key) - 1];
        if (t) {
          setTypeId(t.id);
          onResolve(item, 'accept', { typeId: t.id });
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, typeId, view, types, onResolve, onClose]);

  if (!item) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>Triage</h2>
          </div>
          <div className="modal-body">
            <div className="empty-state">Nothing left to triage. 🎉</div>
          </div>
          <div className="modal-foot">
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  const contexts: string[] = (() => {
    try {
      return JSON.parse((full && full.id === item.id ? full.contexts : item.contexts) || '[]');
    } catch {
      return [];
    }
  })();
  const signals: string[] = (() => {
    try {
      return JSON.parse(item.signals || '[]');
    } catch {
      return [];
    }
  })();

  return (
    <div className="overlay" onClick={onClose}>
      <div className={`modal${view === 'grid' ? ' wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{view === 'grid' ? 'Triage all' : 'New name found'}</h2>
          <span className="progress">
            {index + 1} / {items.length}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className={view === 'list' ? 'primary' : ''} onClick={() => setView('list')}>
              List
            </button>
            <button
              className={view === 'grid' ? 'primary' : ''}
              onClick={() => {
                setView('grid');
                setSelectedIds([]);
              }}
            >
              Grid
            </button>
          </div>
        </div>
        <div className="modal-body">
          {view === 'grid' ? (
            <>
              <div className="toolbar" style={{ marginTop: 0, marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  Select all
                </label>
                <span className="progress">{selectedIds.length} selected</span>
              </div>

              <div className="entity-grid">
                {items.map((it) => (
                  <label
                    key={it.id}
                    className={`entity-card${selectedIds.includes(it.id) ? ' sel' : ''}`}
                    style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(it.id)}
                      onChange={() => toggleSelected(it.id)}
                    />
                    <span style={{ flex: 1 }}>
                      <span className="nm">{it.surface_text}</span>
                      <span className="sub">
                        {it.occurrences}× · ch.{it.chapter_number || '?'} ·{' '}
                        {Math.round(it.confidence * 100)}%
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="field" style={{ marginTop: 16 }}>
                <label>Accept selected as</label>
                <div className="type-row">
                  {types.map((t) => (
                    <button
                      key={t.id}
                      className={`type-btn${bulkTypeId === t.id ? ' sel' : ''}`}
                      style={{ color: t.color }}
                      onClick={() => setBulkTypeId(t.id)}
                    >
                      <span>{t.icon}</span>
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
          <div className="cand-name" style={{ fontSize: 22 }}>
            {item.surface_text}
          </div>
          <div className="cand-meta">
            appears {item.occurrences}× · chapter {item.chapter_number || '?'} · confidence{' '}
            {Math.round(item.confidence * 100)}%
          </div>

          {item.possible_entity_id && (
            <div className="lookalike">
              Looks similar to <strong>{item.possible_name}</strong>.
              <div className="actions">
                <button onClick={() => onResolve(item, 'merge', { entityId: item.possible_entity_id })}>
                  Same thing (add as alias)
                </button>
                <button onClick={() => onResolve(item, 'accept', { typeId })}>Different — create new</button>
              </div>
            </div>
          )}

          {contexts.length > 0 && (
            <div style={{ marginTop: 14 }}>
              {contexts.map((c, i) => (
                <div className="cand-context" key={i}>
                  {c}
                </div>
              ))}
            </div>
          )}

          <div className="field" style={{ marginTop: 16 }}>
            <label>What is it? (pre-filled guess)</label>
            <div className="type-row">
              {types.map((t, i) => (
                <button
                  key={t.id}
                  className={`type-btn${typeId === t.id ? ' sel' : ''}`}
                  style={{ color: t.color }}
                  onClick={() => setTypeId(t.id)}
                >
                  <span>{t.icon}</span>
                  {t.name}
                  {i < 9 && <span className="kbd" style={{ marginLeft: 4 }}>{i + 1}</span>}
                </button>
              ))}
            </div>
          </div>

          {signals.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {signals.map((s) => (
                <span className="chip" key={s}>
                  {s}
                </span>
              ))}
            </div>
          )}

          <div className="kbd-hint">
            <span className="kbd">Enter</span> accept · <span className="kbd">1–9</span> accept as type ·{' '}
            <span className="kbd">←/→</span> change type · <span className="kbd">L</span> later ·{' '}
            <span className="kbd">X</span> ignore · <span className="kbd">Esc</span> close
          </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          {view === 'grid' ? (
            <>
              <button onClick={onClose}>Close</button>
              <button disabled={selectedIds.length === 0} onClick={() => bulkResolve('ignore')}>
                Ignore selected
              </button>
              <button disabled={selectedIds.length === 0} onClick={() => bulkResolve('later')}>
                Later selected
              </button>
              <button
                className="primary"
                disabled={selectedIds.length === 0 || bulkTypeId == null}
                onClick={() => bulkResolve('accept', { typeId: bulkTypeId })}
              >
                Accept selected
              </button>
            </>
          ) : (
            <>
              <button onClick={() => onResolve(item, 'ignore')}>Ignore</button>
              <button onClick={() => onResolve(item, 'later')}>Later</button>
              {index > 0 && <button className="ghost" onClick={() => onNavigate(index - 1)}>← Back</button>}
              <button className="primary" onClick={() => onResolve(item, 'accept', { typeId })}>
                Accept
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
