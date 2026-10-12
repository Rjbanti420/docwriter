import { useEffect, useState } from 'react';
import { api } from '../api';
import type { EntityDetail, Type } from '../types';

export default function EntityPanel({
  entityId,
  types,
  onClose,
  onChanged,
  onOpenChapter,
}: {
  entityId: number;
  types: Type[];
  onClose: () => void;
  onChanged: () => void;
  onOpenChapter: (chapterId: number) => void;
}) {
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState<number | null>(null);
  const [summary, setSummary] = useState('');
  const [tracking, setTracking] = useState('off');
  const [threshold, setThreshold] = useState<string>('');
  const [aliasDraft, setAliasDraft] = useState('');
  const [saved, setSaved] = useState(false);

  async function load() {
    const d: EntityDetail = await api.entity(entityId);
    setDetail(d);
    setName(d.entity.name);
    setTypeId(d.entity.type_id);
    setSummary(d.entity.summary || '');
    setTracking(d.entity.tracking || 'off');
    setThreshold(d.entity.gap_threshold != null ? String(d.entity.gap_threshold) : '');
  }

  useEffect(() => {
    load();
  }, [entityId]);

  const thresholdValid = tracking === 'off' || (threshold.trim() !== '' && Number(threshold) > 0);
  const dirty =
    detail &&
    (name !== detail.entity.name ||
      typeId !== detail.entity.type_id ||
      summary !== (detail.entity.summary || '') ||
      tracking !== (detail.entity.tracking || 'off') ||
      threshold !== (detail.entity.gap_threshold != null ? String(detail.entity.gap_threshold) : ''));

  async function save() {
    if (!thresholdValid) return;
    await api.updateEntity(entityId, {
      name,
      typeId,
      summary,
      tracking,
      gapThreshold: tracking === 'off' ? null : Number(threshold),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    await load();
    onChanged();
  }

  async function addAlias() {
    const a = aliasDraft.trim();
    if (!a) return;
    await api.addAlias(entityId, a);
    setAliasDraft('');
    await load();
  }

  if (!detail) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-body">Loading…</div>
        </div>
      </div>
    );
  }

  const e = detail.entity;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(ev) => ev.stopPropagation()}>
        <div className="modal-head">
          <span className="dot" style={{ background: e.type_color }} />
          <h2>{e.name}</h2>
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="row">
            <div className="field" style={{ flex: 2 }}>
              <label>Name</label>
              <input value={name} onChange={(ev) => setName(ev.target.value)} />
            </div>
            <div className="field">
              <label>Type</label>
              <select value={typeId ?? ''} onChange={(ev) => setTypeId(ev.target.value ? Number(ev.target.value) : null)}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.icon} {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Summary / notes</label>
            <textarea value={summary} onChange={(ev) => setSummary(ev.target.value)} style={{ minHeight: 90 }} />
          </div>

          <div className="row">
            <div className="field">
              <label>Trail tracking</label>
              <select value={tracking} onChange={(ev) => setTracking(ev.target.value)}>
                <option value="off">Off — always around, don't track</option>
                <option value="reappearance">Reappearance — alert when they return</option>
                <option value="absence">Absence — alert when they vanish</option>
              </select>
            </div>
            <div className="field">
              <label>Gap threshold (chapters){tracking !== 'off' && ' — required'}</label>
              <input
                type="number"
                min={1}
                value={threshold}
                disabled={tracking === 'off'}
                onChange={(ev) => setThreshold(ev.target.value)}
                placeholder={tracking === 'off' ? 'n/a' : 'e.g. 3'}
              />
            </div>
          </div>

          <div className="field">
            <label>Aliases</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {detail.aliases.length === 0 && <span className="progress">none yet</span>}
              {detail.aliases.map((a) => (
                <span className="tag" key={a.id}>
                  {a.alias}
                  <button
                    onClick={async () => {
                      await api.removeAlias(entityId, a.id);
                      await load();
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={aliasDraft}
                onChange={(ev) => setAliasDraft(ev.target.value)}
                placeholder="add a spelling variant"
                onKeyDown={(ev) => ev.key === 'Enter' && addAlias()}
              />
              <button onClick={addAlias}>Add</button>
            </div>
          </div>

          <div className="field">
            <label>Appearances ({detail.mentions.length})</label>
            <div className="list" style={{ maxHeight: 220, overflowY: 'auto' }}>
              {detail.mentions.map((m) => (
                <button
                  key={m.id}
                  className="chapter-item"
                  onClick={() => onOpenChapter(m.chapter_id)}
                  style={{ textAlign: 'left' }}
                >
                  <span className="num">ch.{m.chapter_number || '?'}</span>
                  <span className="ct" style={{ whiteSpace: 'normal' }}>
                    {m.context_sentence}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button
            className="danger"
            onClick={async () => {
              if (confirm(`Delete the card for "${e.name}"? Mentions stay in the text but the bible entry is removed.`)) {
                await api.deleteEntity(entityId);
                onChanged();
                onClose();
              }
            }}
          >
            Delete card
          </button>
          <div style={{ flex: 1 }} />
          {saved && <span className="progress">saved ✓</span>}
          <button className="primary" disabled={!dirty || !thresholdValid} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
