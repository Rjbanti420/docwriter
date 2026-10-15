import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import { api } from '../api';
import { fileToDataUrl, getEntityImage, parseFields } from '../entityMedia';
import { getDeath, getOwnerId } from '../entityRelations';
import { chapterLabel, chapterNumber } from '../chapters';
import type { Chapter, Entity, EntityDetail, Type } from '../types';

/** Types that may own an Item. Characters, nations and guilds hold things; places and items do not. */
const OWNER_TYPES = ['Character', 'Country', 'Organisation'];

export default function EntityPanel({
  entityId,
  entities,
  chapters,
  types,
  onClose,
  onChanged,
  onOpenChapter,
  onOpenEntity,
}: {
  entityId: number;
  entities: Entity[];
  chapters: Chapter[];
  types: Type[];
  onClose: () => void;
  onChanged: () => void;
  onOpenChapter: (id: number) => void;
  onOpenEntity: (id: number) => void;
}) {
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState<number | null>(null);
  const [summary, setSummary] = useState('');
  const [tracking, setTracking] = useState('off');
  const [threshold, setThreshold] = useState('');
  const [aliasDraft, setAliasDraft] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeTarget, setMergeTarget] = useState<Entity | null>(null);
  const [merging, setMerging] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [deathDraft, setDeathDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const d: EntityDetail = await api.entity(entityId);
    setDetail(d);
    setName(d.entity.name);
    setTypeId(d.entity.type_id);
    setSummary(d.entity.summary);
    setTracking(d.entity.tracking);
    setThreshold(d.entity.gap_threshold != null ? String(d.entity.gap_threshold) : '');
    setImage(getEntityImage(d.entity.fields));
  }

  useEffect(() => {
    setFull(false);
    setMergeOpen(false);
    setMergeQuery('');
    setMergeTarget(null);
    load();
  }, [entityId]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  /** Absorb a duplicate card: the server moves everything onto this one. */
  async function doMerge() {
    if (!mergeTarget || merging) return;
    setMerging(true);
    try {
      await api.mergeEntity(entityId, mergeTarget.id);
      setMergeOpen(false);
      setMergeTarget(null);
      setMergeQuery('');
      await load();
      onChanged();
    } finally {
      setMerging(false);
    }
  }

  async function setEntityImage(next: string | null) {
    if (!detail) return;
    const fields = parseFields(detail.entity.fields);
    if (next) fields.image = next;
    else delete fields.image;
    await api.updateEntity(entityId, { fields });
    await load();
    onChanged();
  }

  async function onPickImage(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    try {
      await setEntityImage(await fileToDataUrl(file));
    } catch {
      /* unreadable image — leave the current one in place */
    }
  }

  const itemTypeId = types.find((t) => t.name === 'Item')?.id ?? null;

  /** Item side: set (or clear) this item's single owner. */
  async function setOwner(nextOwner: number | null) {
    if (!detail) return;
    const fields = parseFields(detail.entity.fields);
    if (nextOwner == null) delete fields.owner;
    else fields.owner = nextOwner;
    await api.updateEntity(entityId, { fields });
    await load();
    onChanged();
  }

  async function assignItem(itemId: number) {
    const item = entities.find((x) => x.id === itemId);
    if (!item) return;
    const fields = parseFields(item.fields);
    fields.owner = entityId;
    await api.updateEntity(itemId, { fields });
    await load();
    onChanged();
  }

  async function unassignItem(itemId: number) {
    const item = entities.find((x) => x.id === itemId);
    if (!item) return;
    const fields = parseFields(item.fields);
    delete fields.owner;
    await api.updateEntity(itemId, { fields });
    await load();
    onChanged();
  }

  async function createItem() {
    const n = newItemName.trim();
    if (!n || itemTypeId == null) return;
    const created = await api.createEntity({ name: n, typeId: itemTypeId });
    await api.updateEntity(created.id, { fields: { owner: entityId } });
    setNewItemName('');
    await load();
    onChanged();
  }

  /** Mark deceased: keeps the card and its history, just records the fate. */
  async function kill(chapterId: number) {
    if (!detail) return;
    const fields = parseFields(detail.entity.fields);
    fields.death = { chapter: chapterId, at: new Date().toISOString() };
    await api.updateEntity(entityId, { fields });
    setDeathDraft('');
    await load();
    onChanged();
  }

  async function resurrect() {
    if (!detail) return;
    const fields = parseFields(detail.entity.fields);
    delete fields.death;
    await api.updateEntity(entityId, { fields });
    await load();
    onChanged();
  }

  if (!detail) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal entity-modal" onClick={(ev) => ev.stopPropagation()}>
          <div className="modal-body">
            <div className="entity-note">Loading…</div>
          </div>
        </div>
      </div>
    );
  }

  const e = detail.entity;

  const isItem = e.type_name === 'Item';
  const isCharacter = e.type_name === 'Character';
  const canOwnItems = OWNER_TYPES.includes(e.type_name ?? '');
  // Only a person can die; an item, place or nation has no fate of its own.
  const death = isCharacter ? getDeath(e.fields) : null;
  const deathChapter = death?.chapter != null ? chapters.find((c) => c.id === death.chapter) : undefined;

  const ownerId = getOwnerId(e.fields);
  const owner = ownerId != null ? entities.find((x) => x.id === ownerId) : undefined;
  const possessions = entities.filter((x) => x.type_name === 'Item' && getOwnerId(x.fields) === e.id);
  const addableItems = entities.filter((x) => x.type_name === 'Item' && getOwnerId(x.fields) !== e.id);
  const ownerCandidates = entities.filter((x) => OWNER_TYPES.includes(x.type_name ?? '') && x.id !== e.id);

  // One row per chapter, however many times the name was mentioned there.
  const appearances = (() => {
    const byChapter = new Map<
      number,
      { id: number; number: string; title: string; order: number; count: number }
    >();
    for (const m of detail.mentions) {
      const existing = byChapter.get(m.chapter_id);
      if (existing) existing.count += 1;
      else
        byChapter.set(m.chapter_id, {
          id: m.chapter_id,
          number: m.chapter_number,
          title: m.chapter_title,
          order: m.chapter_order,
          count: 1,
        });
    }
    return [...byChapter.values()].sort((a, b) => a.order - b.order);
  })();

  // Cards the merge picker can offer: every other live card (the survivor
  // itself is excluded), narrowed by name or type as the search is typed.
  const mergeMatches = (() => {
    const q = mergeQuery.trim().toLowerCase();
    const others = entities.filter((x) => x.id !== e.id);
    const hit = q
      ? others.filter(
          (x) => x.name.toLowerCase().includes(q) || (x.type_name ?? '').toLowerCase().includes(q)
        )
      : others;
    return hit.slice(0, 40);
  })();

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className={`modal entity-modal${full ? ' full' : ''}`}
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${e.name} details`}
      >
        <div className="modal-head">
          {image ? (
            <img className="entity-photo" src={image} alt="" />
          ) : (
            <span className="entity-icon" style={{ ['--e']: e.type_color } as CSSProperties}>
              {e.type_icon}
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="entity-name">
              {death && <span title="Deceased">† </span>}
              {e.name}
            </div>
            <div className="cand-meta">{e.type_name || 'Uncategorised'}</div>
            {death && (
              <div className="cand-meta" style={{ color: 'var(--color-danger)' }}>
                ☠ Died{deathChapter ? ` · ch.${chapterNumber(deathChapter)}` : ''}
              </div>
            )}
            <div className="entity-image-actions">
              <button className="ghost" onClick={() => fileRef.current?.click()}>
                {image ? 'Replace image' : 'Add image'}
              </button>
              {image && (
                <button className="ghost" onClick={() => setEntityImage(null)}>
                  Remove
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={onPickImage}
              />
            </div>
          </div>
          <button
            className="icon-btn"
            onClick={() => setFull((v) => !v)}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
            title={full ? 'Exit full screen' : 'Full screen'}
          >
            {full ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="entity-cols">
            <div className="entity-col">
              <div className="field">
                <label>Name</label>
                <input value={name} onChange={(ev) => setName(ev.target.value)} />
              </div>

              <div className="field">
                <label>Type</label>
                <select
                  value={typeId ?? ''}
                  onChange={(ev) => setTypeId(ev.target.value ? Number(ev.target.value) : null)}
                >
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.icon} {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Summary / notes</label>
                <textarea value={summary} onChange={(ev) => setSummary(ev.target.value)} style={{ minHeight: 90 }} />
              </div>

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

              {isCharacter && (
                <div className="field">
                  <label>Fate</label>
                  {death ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="badge badge-dead" title="Deceased">
                        ☠ Died{deathChapter ? ` · ch.${chapterNumber(deathChapter)}` : ''}
                      </span>
                      <button className="ghost" onClick={resurrect}>
                        Resurrect
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select value={deathDraft} onChange={(ev) => setDeathDraft(ev.target.value)}>
                        <option value="">died in chapter…</option>
                        {chapters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {chapterLabel(c)}
                          </option>
                        ))}
                      </select>
                      <button disabled={!deathDraft} onClick={() => kill(Number(deathDraft))}>
                        ☠ Kill
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="entity-col">
              {isItem ? (
                <div className="field">
                  <label>Possessed by</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {owner ? (
                      <span className="tag">
                        <button className="tag-link" onClick={() => onOpenEntity(owner.id)} title="Open owner">
                          {owner.type_icon} {owner.name}
                        </button>
                        <button title="Clear owner" onClick={() => setOwner(null)}>
                          ✕
                        </button>
                      </span>
                    ) : (
                      <span className="progress">nobody</span>
                    )}
                  </div>
                  <select
                    value=""
                    onChange={(ev) => {
                      if (ev.target.value) setOwner(Number(ev.target.value));
                    }}
                  >
                    <option value="">{owner ? 'reassign to…' : 'assign to…'}</option>
                    {ownerCandidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.type_icon} {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : canOwnItems ? (
                <div className="field">
                  <label>Possessions</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {possessions.length === 0 && <span className="progress">none yet</span>}
                    {possessions.map((it) => (
                      <span className="tag" key={it.id}>
                        <button className="tag-link" onClick={() => onOpenEntity(it.id)} title="Open item">
                          {it.type_icon} {it.name}
                        </button>
                        <button title="Remove possession" onClick={() => unassignItem(it.id)}>
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                  <select
                    value=""
                    onChange={(ev) => {
                      if (ev.target.value) assignItem(Number(ev.target.value));
                    }}
                    disabled={addableItems.length === 0}
                  >
                    <option value="">{addableItems.length === 0 ? 'no items to add' : 'add an item…'}</option>
                    {addableItems.map((it) => {
                      const heldBy = getOwnerId(it.fields);
                      const holder = heldBy != null ? entities.find((x) => x.id === heldBy) : undefined;
                      return (
                        <option key={it.id} value={it.id}>
                          {it.name}
                          {holder ? ` · held by ${holder.name}` : ''}
                        </option>
                      );
                    })}
                  </select>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <input
                      value={newItemName}
                      onChange={(ev) => setNewItemName(ev.target.value)}
                      placeholder="create a new item"
                      onKeyDown={(ev) => ev.key === 'Enter' && createItem()}
                    />
                    <button onClick={createItem} disabled={!newItemName.trim() || itemTypeId == null}>
                      Create
                    </button>
                  </div>
                </div>
              ) : null}

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
                <div className="merge-row">
                  <button className="ghost" onClick={() => setMergeOpen((v) => !v)}>
                    {mergeOpen ? 'Close' : 'Merge another entity…'}
                  </button>
                </div>
                {mergeOpen && (
                  <div className="merge-picker">
                    <input
                      autoFocus
                      value={mergeQuery}
                      onChange={(ev) => {
                        setMergeQuery(ev.target.value);
                        setMergeTarget(null);
                      }}
                      placeholder="search for the duplicate card by name…"
                    />
                    <div className="merge-list">
                      {mergeMatches.length === 0 ? (
                        <span className="progress">no other card matches</span>
                      ) : (
                        mergeMatches.map((x) => (
                          <button
                            key={x.id}
                            className={`chapter-item${mergeTarget?.id === x.id ? ' sel' : ''}`}
                            onClick={() => setMergeTarget(x)}
                          >
                            <span className="ct">
                              {x.type_icon} {x.name}
                            </span>
                            <span className="cand-meta">
                              {x.type_name || 'Uncategorised'} · {x.mention_count ?? 0} mention
                              {(x.mention_count ?? 0) === 1 ? '' : 's'}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                    {mergeTarget && (
                      <div className="merge-confirm">
                        <div>
                          <strong>{mergeTarget.name}</strong> is absorbed into{' '}
                          <strong>{e.name}</strong> — its name becomes an alias, and its{' '}
                          {mergeTarget.mention_count ?? 0} mention
                          {(mergeTarget.mention_count ?? 0) === 1 ? '' : 's'}, aliases, items and
                          linked review items move over. Then its card goes to Trash.
                        </div>
                        <div className="actions">
                          <button className="btn-danger" disabled={merging} onClick={doMerge}>
                            {merging ? 'Merging…' : 'Merge & move card to Trash'}
                          </button>
                          <button className="ghost" onClick={() => setMergeTarget(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="field">
                <label>
                  Appearances ({appearances.length} {appearances.length === 1 ? 'chapter' : 'chapters'})
                </label>
                <div className="list entity-appearances">
                  {appearances.length === 0 && <span className="progress">not seen yet</span>}
                  {appearances.map((ch) => (
                    <button
                      key={ch.id}
                      className="chapter-item"
                      onClick={() => onOpenChapter(ch.id)}
                      title={`${ch.count} ${ch.count === 1 ? 'mention' : 'mentions'}`}
                    >
                      <span className="ct" style={{ whiteSpace: 'normal' }}>
                        {chapterLabel({ number: ch.number, title: ch.title, sort_order: ch.order })}
                      </span>
                      <span className="cnt">{ch.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button
            className="danger"
            onClick={async () => {
              if (confirm(`Move "${e.name}" to trash? You can restore it later from Review → Trash.`)) {
                await api.trashEntities([entityId]);
                onChanged();
                onClose();
              }
            }}
          >
            Move to trash
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
