import { useState } from 'react';
import type { Candidate, Entity, IgnoredToken, ReviewData, Type } from '../types';

// SQLite stores `datetime('now')` as "YYYY-MM-DD HH:MM:SS" in UTC.
function formatTrashed(ts?: string | null): string {
  if (!ts) return 'trashed';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return `trashed ${ts}`;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'trashed today';
  if (days === 1) return 'trashed yesterday';
  if (days < 30) return `trashed ${days} days ago`;
  return `trashed ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function CandidateRow({
  c,
  types,
  onResolve,
}: {
  c: Candidate;
  types: Type[];
  onResolve: (c: Candidate, action: string, extra?: Record<string, unknown>) => void;
}) {
  const [typeId, setTypeId] = useState<number | null>(
    c.suggested_type_id ?? types.find((t) => t.name === 'Character')?.id ?? null
  );
  const contexts: string[] = (() => {
    try {
      return JSON.parse(c.contexts || '[]');
    } catch {
      return [];
    }
  })();
  const signals: string[] = (() => {
    try {
      return JSON.parse(c.signals || '[]');
    } catch {
      return [];
    }
  })();

  return (
    <div className="card">
      <div className="cand-row">
        <div>
          <div className="cand-name">
            {c.surface_text}{' '}
            <span className="progress">
              {c.occurrences}× · ch.{c.chapter_number || '?'} · {Math.round(c.confidence * 100)}%
            </span>
          </div>
          {contexts[0] && <div className="cand-context">{contexts[0]}</div>}
          {signals.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {signals.map((s) => (
                <span className="chip" key={s}>
                  {s}
                </span>
              ))}
            </div>
          )}
          {c.possible_name && (
            <div className="lookalike">
              Looks like <strong>{c.possible_name}</strong> —{' '}
              <button
                className="ghost"
                style={{ padding: '0 4px', textDecoration: 'underline' }}
                onClick={() => onResolve(c, 'merge', { entityId: c.possible_entity_id })}
              >
                same thing
              </button>
            </div>
          )}
        </div>
        <div style={{ minWidth: 160 }}>
          <select
            value={typeId ?? ''}
            onChange={(e) => setTypeId(e.target.value ? Number(e.target.value) : null)}
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon} {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="actions">
        <button className="primary" onClick={() => onResolve(c, 'accept', { typeId })}>
          Accept
        </button>
        <button onClick={() => onResolve(c, 'later')}>Later</button>
        <button onClick={() => onResolve(c, 'ignore')}>Ignore — never ask again</button>
      </div>
    </div>
  );
}

export default function ReviewView({
  review,
  types,
  ignored,
  trash,
  onResolve,
  onAlertState,
  onOpenEntity,
  onOpenGun,
  onTriageAll,
  onUnignore,
  onRestore,
  onDeleteForever,
}: {
  review: ReviewData;
  types: Type[];
  ignored: IgnoredToken[];
  trash: Entity[];
  onResolve: (c: Candidate, action: string, extra?: Record<string, unknown>) => void;
  onAlertState: (id: number, state: string) => void;
  onOpenEntity: (id: number) => void;
  onOpenGun: (id: number) => void;
  onTriageAll: () => void;
  onUnignore: (id: number) => void;
  onRestore: (id: number) => void;
  onDeleteForever: (id: number) => void;
}) {
  const [tab, setTab] = useState<'names' | 'alerts' | 'rejected' | 'trash'>('names');
  const [showMore, setShowMore] = useState(false);
  const [selectedTrash, setSelectedTrash] = useState<number[]>([]);

  const primary = review.pending.filter((c) => c.tier !== 'demoted');
  const demoted = review.pending.filter((c) => c.tier === 'demoted');
  const unread = review.alerts.filter((a) => a.state === 'unread').length;

  const allTrashSelected = trash.length > 0 && selectedTrash.length === trash.length;
  const toggleTrash = (id: number) =>
    setSelectedTrash((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAllTrash = () => setSelectedTrash(allTrashSelected ? [] : trash.map((e) => e.id));
  const clearTrashSelection = () => setSelectedTrash([]);
  const restoreSelected = async () => {
    const ids = selectedTrash;
    clearTrashSelection();
    for (const id of ids) await onRestore(id);
  };
  const deleteSelected = () => {
    if (selectedTrash.length === 0) return;
    if (confirm(`Permanently delete ${selectedTrash.length} card(s)? This cannot be undone.`)) {
      const ids = selectedTrash;
      clearTrashSelection();
      for (const id of ids) onDeleteForever(id);
    }
  };

  return (
    <div className="main-inner">
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Review</h1>
      <p className="progress" style={{ marginTop: 0 }}>
        Everything waiting on your input lives here.
      </p>
      <div className="tabs">
        <button className={tab === 'names' ? 'active' : ''} onClick={() => setTab('names')}>
          New names {primary.length > 0 && <span className="badge">{primary.length}</span>}
        </button>
        <button className={tab === 'alerts' ? 'active' : ''} onClick={() => setTab('alerts')}>
          Trail alerts {unread > 0 && <span className="badge">{unread}</span>}
        </button>
        <button className={tab === 'rejected' ? 'active' : ''} onClick={() => setTab('rejected')}>
          Rejected {ignored.length > 0 && <span className="badge">{ignored.length}</span>}
        </button>
        <button className={tab === 'trash' ? 'active' : ''} onClick={() => setTab('trash')}>
          Trash {trash.length > 0 && <span className="badge">{trash.length}</span>}
        </button>
      </div>

      {tab === 'names' && (
        <>
          {primary.length > 1 && (
            <div className="toolbar">
              <button className="primary" onClick={onTriageAll}>
                Triage one by one ({primary.length})
              </button>
            </div>
          )}
          {primary.length === 0 && demoted.length === 0 ? (
            <div className="empty-state">No new names waiting. Paste a chapter to scan it.</div>
          ) : (
            <div className="list">
              {primary.map((c) => (
                <CandidateRow key={c.id} c={c} types={types} onResolve={onResolve} />
              ))}
            </div>
          )}

          {demoted.length > 0 && (
            <div style={{ marginTop: 18 }}>
              {!showMore ? (
                <button onClick={() => setShowMore(true)}>
                  Show {demoted.length} more low-confidence
                </button>
              ) : (
                <>
                  <p className="progress">
                    Low confidence — mostly capitalised common words. Accept any that are real names;
                    ignore the rest and they never come back.
                  </p>
                  <div className="list">
                    {demoted.map((c) => (
                      <CandidateRow key={c.id} c={c} types={types} onResolve={onResolve} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'alerts' && (
        <>
          {review.alerts.length === 0 ? (
            <div className="empty-state">
              No trail alerts. Turn on tracking for a character to be told when they reappear or go missing.
            </div>
          ) : (
            <div className="list">
              {review.alerts.map((a) => (
                <div className="card" key={a.id}>
                  <div className="alert-row">
                    <div style={{ flex: 1 }}>
                      <span className={`alert-kind ${a.kind}`}>{a.kind.replace(/_/g, ' ')}</span>
                      {a.kind === 'gun_ready' ? (
                        <div className="cand-name" style={{ marginTop: 4 }}>
                          <button
                            className="ghost"
                            style={{ padding: 0 }}
                            onClick={() => a.gun_id != null && onOpenGun(a.gun_id)}
                          >
                            {a.gun_title}
                          </button>
                        </div>
                      ) : (
                        <div className="cand-name" style={{ marginTop: 4 }}>
                          <span className="dot" style={{ background: a.type_color, marginRight: 6 }} />
                          <button
                            className="ghost"
                            style={{ padding: 0 }}
                            onClick={() => a.entity_id != null && onOpenEntity(a.entity_id)}
                          >
                            {a.entity_name}
                          </button>
                        </div>
                      )}
                      <div className="cand-meta">
                        {a.detail} {a.chapter_number && `· chapter ${a.chapter_number}`}
                      </div>
                    </div>
                    <div className="actions" style={{ marginTop: 0 }}>
                      {a.state === 'unread' && <button onClick={() => onAlertState(a.id, 'read')}>Mark read</button>}
                      <button onClick={() => onAlertState(a.id, 'resolved')}>Resolve</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'rejected' && (
        <>
          <p className="progress">
            Words you ignored. The scanner will never surface these again in this book. Restore one if you
            ignored it by mistake.
          </p>
          {ignored.length === 0 ? (
            <div className="empty-state">Nothing rejected yet.</div>
          ) : (
            <div className="list">
              {ignored.map((t) => (
                <div className="card" key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }} className="cand-name">
                    {t.normalized}
                  </div>
                  <button onClick={() => onUnignore(t.id)}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'trash' && (
        <>
          <p className="progress">
            Cards that lost their last appearance (usually because their only chapter was deleted). Restore
            one, or delete it for good.
          </p>
          {trash.length === 0 ? (
            <div className="empty-state">Trash is empty.</div>
          ) : (
            <>
              <div className="toolbar dw-trash-bar">
                <label className="dw-check">
                  <input type="checkbox" checked={allTrashSelected} onChange={toggleAllTrash} />
                  Select all
                </label>
                {selectedTrash.length > 0 && (
                  <div className="dw-trash-bulk">
                    <span className="progress">{selectedTrash.length} selected</span>
                    <button className="btn-primary" onClick={restoreSelected}>
                      Restore
                    </button>
                    <button className="btn-danger" onClick={deleteSelected}>
                      Delete forever
                    </button>
                    <button className="btn-secondary" onClick={clearTrashSelection}>
                      Clear
                    </button>
                  </div>
                )}
              </div>
              <ul className="dw-list">
                {trash.map((e) => (
                  <li className="dw-card dw-trash" key={e.id}>
                    <input
                      type="checkbox"
                      className="dw-trash__check"
                      checked={selectedTrash.includes(e.id)}
                      onChange={() => toggleTrash(e.id)}
                      aria-label={`Select ${e.name}`}
                    />
                    <div className="dw-trash__body">
                      <div className="dw-trash__name">
                        <span className="dot" style={{ background: e.type_color }} />
                        {e.name}
                      </div>
                      <div className="dw-card-meta">
                        <span className="dw-ref">{e.type_name || 'Uncategorised'}</span>
                        <span>{formatTrashed(e.trashed_at)}</span>
                      </div>
                    </div>
                    <div className="dw-trash__actions">
                      <button className="btn-secondary" onClick={() => onRestore(e.id)}>
                        Restore
                      </button>
                      <button
                        className="btn-danger"
                        onClick={() => {
                          if (confirm(`Permanently delete "${e.name}"? This cannot be undone.`)) onDeleteForever(e.id);
                        }}
                      >
                        Delete forever
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
