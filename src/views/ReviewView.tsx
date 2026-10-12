import { useState } from 'react';
import type { Candidate, ReviewData, Type } from '../types';

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
        <button onClick={() => onResolve(c, 'ignore')}>Ignore</button>
      </div>
    </div>
  );
}

export default function ReviewView({
  review,
  types,
  onResolve,
  onAlertState,
  onOpenEntity,
  onTriageAll,
}: {
  review: ReviewData;
  types: Type[];
  onResolve: (c: Candidate, action: string, extra?: Record<string, unknown>) => void;
  onAlertState: (id: number, state: string) => void;
  onOpenEntity: (id: number) => void;
  onTriageAll: () => void;
}) {
  const [tab, setTab] = useState<'names' | 'alerts'>('names');
  const unread = review.alerts.filter((a) => a.state === 'unread').length;

  return (
    <div className="main-inner">
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Review</h1>
      <p className="progress" style={{ marginTop: 0 }}>
        Everything waiting on your input lives here.
      </p>
      <div className="tabs">
        <button className={tab === 'names' ? 'active' : ''} onClick={() => setTab('names')}>
          New names {review.pending.length > 0 && <span className="badge">{review.pending.length}</span>}
        </button>
        <button className={tab === 'alerts' ? 'active' : ''} onClick={() => setTab('alerts')}>
          Trail alerts {unread > 0 && <span className="badge">{unread}</span>}
        </button>
      </div>

      {tab === 'names' && (
        <>
          {review.pending.length > 1 && (
            <div className="toolbar">
              <button className="primary" onClick={onTriageAll}>
                Triage one by one ({review.pending.length})
              </button>
            </div>
          )}
          {review.pending.length === 0 ? (
            <div className="empty-state">No new names waiting. Paste a chapter to scan it.</div>
          ) : (
            <div className="list">
              {review.pending.map((c) => (
                <CandidateRow key={c.id} c={c} types={types} onResolve={onResolve} />
              ))}
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
                      <span className={`alert-kind ${a.kind}`}>{a.kind}</span>
                      <div className="cand-name" style={{ marginTop: 4 }}>
                        <span className="dot" style={{ background: a.type_color, marginRight: 6 }} />
                        <button className="ghost" style={{ padding: 0 }} onClick={() => onOpenEntity(a.entity_id)}>
                          {a.entity_name}
                        </button>
                      </div>
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
    </div>
  );
}
