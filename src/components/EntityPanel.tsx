import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, ReactNode } from 'react';
import { api } from '../api';
import { fileToDataUrl, getEntityImage, parseFields } from '../entityMedia';
import { getDeath, getLeaderId, getMemberIds, getOperatesInId, getOwnerId } from '../entityRelations';
import { chapterLabel, chapterNumber } from '../chapters';
import type { Chapter, Entity, EntityDetail, PowerLevel, Type } from '../types';

/** Types that may own an Item. Characters, nations and guilds hold things; places and items do not. */
const OWNER_TYPES = ['Character', 'Country', 'Organisation'];

/** Types an Organisation can be led by and staffed with. */
const PERSON_TYPES = ['Character'];

/** Types an Organisation can be said to operate in. */
const PLACE_TYPES = ['Location', 'Country'];

/** Item rank ladder, from the mundane to the singular. */
const ITEM_RANKS = ['Mundane', 'Elusive', 'Hazardous', 'Desolating', 'Cataclysmic', 'Singular'];

/** Default hues for writer-made power levels — cycled as they are created. */
const LEVEL_COLORS = ['#c9741a', '#0f8a7e', '#3f67d6', '#5b9a2f', '#c2487a', '#8b5cf6'];

/** Character "System" — fixed subsections, always present (only the text is editable). */
const SYSTEM_KEYS = [
  ['bloodline', 'Bloodline'],
  ['species', 'Species'],
] as const;

/** Character "History" — the eight fixed subsections; custom ones are added on top. */
const HISTORY_KEYS = [
  ['origin', 'Origin'],
  ['backstory', 'Backstory'],
  ['appearance', 'Appearance'],
  ['distinct_feature', 'Distinct feature'],
  ['motivation', 'Motivation'],
  ['failure', 'Failure'],
  ['success', 'Success'],
  ['regret', 'Regret'],
] as const;

/** One user-created row: an ability, or a custom System/History subsection. */
interface Entry {
  id: string;
  name: string;
  body: string;
}

/** A section with fixed text fields plus a list of user-created ones. */
interface Section {
  values: Record<string, string>;
  custom: Entry[];
}

function uid(): string {
  const c = globalThis.crypto;
  return c && 'randomUUID' in c ? c.randomUUID() : Math.random().toString(36).slice(2);
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parseEntries(v: unknown): Entry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === 'object')
    .map((x) => {
      const row = x as Record<string, unknown>;
      return { id: asString(row.id) || uid(), name: asString(row.name), body: asString(row.body) };
    });
}

function parseSection(v: unknown, keys: readonly (readonly [string, string])[]): Section {
  const src = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const values: Record<string, string> = {};
  for (const [k] of keys) values[k] = asString(src[k]);
  return { values, custom: parseEntries(src.custom) };
}

/** Drop blank rows and blank fixed fields before persisting. */
function buildEntries(entries: Entry[]): Entry[] {
  return entries
    .filter((e) => e.name.trim() !== '' || e.body.trim() !== '')
    .map((e) => ({ id: e.id, name: e.name, body: e.body }));
}

function buildSection(section: Section): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(section.values)) if (v.trim() !== '') out[k] = v;
  const custom = buildEntries(section.custom);
  if (custom.length > 0) out.custom = custom;
  return out;
}

/** Canonical, blank-pruned snapshot that decides whether the Save button lights. */
function characterSnapshot(s: {
  powerLevel: number | null;
  abilities: Entry[];
  system: Section;
  history: Section;
}): string {
  return JSON.stringify({
    powerLevel: s.powerLevel,
    abilities: buildEntries(s.abilities),
    system: buildSection(s.system),
    history: buildSection(s.history),
  });
}

/** How many subsections of a section actually hold something (for the badge). */
function filledCount(s: Section): number {
  return Object.values(s.values).filter((v) => v.trim() !== '').length + buildEntries(s.custom).length;
}

/** Canonical, blank-pruned snapshot that decides whether Save lights for an Organisation. */
function organisationSnapshot(s: {
  description: string;
  leader: number | null;
  members: number[];
  operatesIn: number | null;
  purpose: string;
  accomplishments: Entry[];
}): string {
  return JSON.stringify({
    description: s.description,
    leader: s.leader,
    members: s.members,
    operatesIn: s.operatesIn,
    purpose: s.purpose,
    accomplishments: buildEntries(s.accomplishments),
  });
}

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
  // Item-only fields (kept in the `fields` JSON bag; Origin reuses `summary`).
  const [description, setDescription] = useState('');
  const [rank, setRank] = useState('');
  const [boon, setBoon] = useState('');
  const [curse, setCurse] = useState('');
  const [evolvable, setEvolvable] = useState(false);
  // Character-only state (all kept in the `fields` bag).
  const [powerLevel, setPowerLevel] = useState<number | null>(null);
  const [powerLevels, setPowerLevels] = useState<PowerLevel[]>([]);
  const [abilities, setAbilities] = useState<Entry[]>([]);
  const [system, setSystem] = useState<Section>(() => parseSection(null, SYSTEM_KEYS));
  const [history, setHistory] = useState<Section>(() => parseSection(null, HISTORY_KEYS));
  const charBaseline = useRef('');
  const [aliasDraft, setAliasDraft] = useState('');
  // Organisation-only state (all kept in the `fields` bag; Origin reuses `summary`).
  const [leader, setLeader] = useState<number | null>(null);
  const [members, setMembers] = useState<number[]>([]);
  const [operatesIn, setOperatesIn] = useState<number | null>(null);
  const [purpose, setPurpose] = useState('');
  const [accomplishments, setAccomplishments] = useState<Entry[]>([]);
  const orgBaseline = useRef('');
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
    const fields = parseFields(d.entity.fields);
    setDescription(typeof fields.description === 'string' ? fields.description : '');
    setRank(typeof fields.rank === 'string' ? fields.rank : '');
    setBoon(typeof fields.boon === 'string' ? fields.boon : '');
    setCurse(typeof fields.curse === 'string' ? fields.curse : '');
    setEvolvable(fields.evolvable === true);
    if (d.entity.type_name === 'Character') {
      const nextPower = typeof fields.power_level === 'number' ? fields.power_level : null;
      const nextAbilities = parseEntries(fields.abilities);
      const nextSystem = parseSection(fields.system, SYSTEM_KEYS);
      const nextHistory = parseSection(fields.history, HISTORY_KEYS);
      setPowerLevel(nextPower);
      setAbilities(nextAbilities);
      setSystem(nextSystem);
      setHistory(nextHistory);
      charBaseline.current = characterSnapshot({
        powerLevel: nextPower,
        abilities: nextAbilities,
        system: nextSystem,
        history: nextHistory,
      });
      await loadLevels();
    } else if (d.entity.type_name === 'Organisation') {
      const nextLeader = getLeaderId(d.entity.fields);
      const nextMembers = getMemberIds(d.entity.fields);
      const nextOperates = getOperatesInId(d.entity.fields);
      const nextPurpose = asString(fields.purpose);
      const nextAccomp = parseEntries(fields.accomplishments);
      const nextDesc = asString(fields.description);
      setLeader(nextLeader);
      setMembers(nextMembers);
      setOperatesIn(nextOperates);
      setPurpose(nextPurpose);
      setAccomplishments(nextAccomp);
      setDescription(nextDesc);
      orgBaseline.current = organisationSnapshot({
        description: nextDesc,
        leader: nextLeader,
        members: nextMembers,
        operatesIn: nextOperates,
        purpose: nextPurpose,
        accomplishments: nextAccomp,
      });
    }
  }

  async function loadLevels() {
    const levels = await api.powerLevels();
    setPowerLevels(levels as PowerLevel[]);
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
      if (ev.key !== 'Escape') return;
      // An open dropdown consumes the first Escape; only then close the panel.
      // (Section disclosures also carry aria-expanded, so match the dropdowns.)
      if (document.querySelector('.dw-ie [aria-haspopup="listbox"][aria-expanded="true"]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isItemType = detail?.entity.type_name === 'Item';
  const isCharacterType = detail?.entity.type_name === 'Character';
  const isOrgType = detail?.entity.type_name === 'Organisation';
  const storedFields = detail ? parseFields(detail.entity.fields) : {};
  // Characters no longer expose the trail controls either, but the stored
  // values ride along untouched on save so the dormant-alert engine keeps working.
  const hidesTracking = isItemType || isCharacterType || isOrgType;
  const thresholdValid =
    hidesTracking || tracking === 'off' || (threshold.trim() !== '' && Number(threshold) > 0);
  const dirty =
    !!detail &&
    (name !== detail.entity.name ||
      typeId !== detail.entity.type_id ||
      summary !== (detail.entity.summary || '') ||
      (isItemType
        ? description !== String(storedFields.description ?? '') ||
          rank !== String(storedFields.rank ?? '') ||
          boon !== String(storedFields.boon ?? '') ||
          curse !== String(storedFields.curse ?? '') ||
          evolvable !== (storedFields.evolvable === true)
        : isCharacterType
          ? characterSnapshot({ powerLevel, abilities, system, history }) !== charBaseline.current
          : isOrgType
            ? organisationSnapshot({ description, leader, members, operatesIn, purpose, accomplishments }) !==
              orgBaseline.current
            : tracking !== (detail.entity.tracking || 'off') ||
              threshold !== (detail.entity.gap_threshold != null ? String(detail.entity.gap_threshold) : '')));

  async function save() {
    if (!thresholdValid) return;
    const payload: Record<string, unknown> = {
      name,
      typeId,
      summary,
      tracking,
      gapThreshold: tracking === 'off' ? null : Number(threshold),
    };
    if (isItemType && detail) {
      // Item meta lives in the `fields` bag; merge into a fresh copy so the
      // owner/image values (saved immediately elsewhere) are never clobbered.
      const fields = parseFields(detail.entity.fields);
      const put = (key: string, value: string | boolean) => {
        if (value === '' || value === false) delete fields[key];
        else fields[key] = value;
      };
      put('description', description);
      put('rank', rank);
      put('boon', boon);
      put('curse', curse);
      put('evolvable', evolvable);
      payload.fields = fields;
    } else if (isCharacterType && detail) {
      // Character lore lives in the `fields` bag too; merge into a fresh copy so
      // the image / possessions / death markers are never clobbered.
      const fields = parseFields(detail.entity.fields);
      if (powerLevel == null) delete fields.power_level;
      else fields.power_level = powerLevel;
      const abilityRows = buildEntries(abilities);
      if (abilityRows.length > 0) fields.abilities = abilityRows;
      else delete fields.abilities;
      const systemOut = buildSection(system);
      if (Object.keys(systemOut).length > 0) fields.system = systemOut;
      else delete fields.system;
      const historyOut = buildSection(history);
      if (Object.keys(historyOut).length > 0) fields.history = historyOut;
      else delete fields.history;
      payload.fields = fields;
    } else if (isOrgType && detail) {
      const fields = parseFields(detail.entity.fields);
      if (description === '') delete fields.description;
      else fields.description = description;
      if (purpose === '') delete fields.purpose;
      else fields.purpose = purpose;
      if (leader == null) delete fields.leader;
      else fields.leader = leader;
      if (operatesIn == null) delete fields.operates_in;
      else fields.operates_in = operatesIn;
      if (members.length === 0) delete fields.members;
      else fields.members = members;
      const acc = buildEntries(accomplishments);
      if (acc.length === 0) delete fields.accomplishments;
      else fields.accomplishments = acc;
      payload.fields = fields;
    }
    await api.updateEntity(entityId, payload);
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
      <div className="dw-ie-backdrop" onClick={onClose}>
        <div className="dw-ie" onClick={(ev) => ev.stopPropagation()}>
          <div className="dw-ie__body">
            <div className="dw-ie__empty" style={{ padding: 24 }}>
              Loading…
            </div>
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

  /** Chapter ids the entity is mentioned in — used to light the appearance trail. */
  const seenChapters = new Set(appearances.map((a) => a.id));

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
    <div className="dw-ie-backdrop" onClick={onClose}>
      <div
        className={`dw-ie${full ? ' is-expanded' : ''}`}
        style={{ ['--ie-tone']: e.type_color } as CSSProperties}
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${e.name} details`}
      >
        <header className="dw-ie__head">
          <span className="dw-ie__tile" aria-hidden="true">
            {image ? <img src={image} alt="" /> : e.type_icon}
          </span>
          <div className="dw-ie__titles">
            <h1 className="dw-ie__title">{e.name}</h1>
            <div className="dw-ie__meta">
              <span className="dw-ie__tag">{e.type_name || 'Uncategorised'}</span>
              {death && (
                <span className="dw-ie__died">
                  ☠ Died{deathChapter ? ` · ch.${chapterNumber(deathChapter)}` : ''}
                </span>
              )}
              <button className="dw-ie__link" onClick={() => fileRef.current?.click()}>
                <ImageIcon />
                <span>{image ? 'Replace image' : 'Add image'}</span>
              </button>
              {image && (
                <button className="dw-ie__link" onClick={() => setEntityImage(null)}>
                  <span>Remove image</span>
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
          <div className="dw-ie__actions">
            <button
              className="dw-ie__icon-btn"
              onClick={() => setFull((v) => !v)}
              aria-label={full ? 'Exit full screen' : 'Full screen'}
              title={full ? 'Exit full screen' : 'Full screen'}
            >
              {full ? <ExitIcon /> : <ExpandIcon />}
            </button>
            <button className="dw-ie__icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </header>

        <div className="dw-ie__body">
          <div className="dw-ie__main">
            <div className="dw-ie__row">
              <div className="dw-ie__field dw-ie__grow">
                <label className="dw-ie__label" htmlFor="ie-name">
                  Name
                </label>
                <input
                  id="ie-name"
                  className="dw-ie__input"
                  value={name}
                  onChange={(ev) => setName(ev.target.value)}
                />
              </div>
              <div className="dw-ie__field dw-ie__type">
                <label className="dw-ie__label" htmlFor="ie-type">
                  Type
                </label>
                <div className="dw-ie__select-wrap">
                  <select
                    id="ie-type"
                    className="dw-ie__select"
                    value={typeId ?? ''}
                    onChange={(ev) => setTypeId(ev.target.value ? Number(ev.target.value) : null)}
                  >
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.icon} {t.name}
                      </option>
                    ))}
                  </select>
                  <Chevron />
                </div>
              </div>
            </div>

              {isItem ? (
                <>
                  <div className="dw-ie__field">
                    <label className="dw-ie__label" htmlFor="ie-origin">
                      Origin
                    </label>
                    <textarea
                      id="ie-origin"
                      className="dw-ie__textarea"
                      value={summary}
                      onChange={(ev) => setSummary(ev.target.value)}
                      placeholder="What is the origin of the Item?"
                    />
                  </div>

                  <div className="dw-ie__field">
                    <label className="dw-ie__label" htmlFor="ie-description">
                      Description
                    </label>
                    <textarea
                      id="ie-description"
                      className="dw-ie__textarea dw-ie__textarea--tall"
                      value={description}
                      onChange={(ev) => setDescription(ev.target.value)}
                    />
                  </div>

                  <div className="dw-ie__field">
                    <span className="dw-ie__label">Rank</span>
                    <RankSelect value={rank} onChange={setRank} />
                  </div>

                  <div className="dw-ie__pair">
                    <div className="dw-ie__field">
                      <label className="dw-ie__label dw-ie__label--boon" htmlFor="ie-boon">
                        Boon
                      </label>
                      <textarea
                        id="ie-boon"
                        className="dw-ie__textarea dw-ie__textarea--tall"
                        value={boon}
                        onChange={(ev) => setBoon(ev.target.value)}
                      />
                    </div>
                    <div className="dw-ie__field">
                      <label className="dw-ie__label dw-ie__label--curse" htmlFor="ie-curse">
                        Curse
                      </label>
                      <textarea
                        id="ie-curse"
                        className="dw-ie__textarea dw-ie__textarea--tall"
                        value={curse}
                        onChange={(ev) => setCurse(ev.target.value)}
                      />
                    </div>
                  </div>

                  <div className="dw-ie__switch-row">
                    <div className="dw-ie__switch-text">
                      <span className="dw-ie__switch-title">Evolvable</span>
                      <span className="dw-ie__hint">
                        {evolvable ? 'Can grow and change.' : 'Stays as it is.'}
                      </span>
                    </div>
                    <Switch checked={evolvable} onChange={setEvolvable} label="Evolvable" />
                  </div>
                </>
              ) : isCharacter ? (
                <>
                  <div className="dw-ie__field">
                    <span className="dw-ie__label">Power level</span>
                    <PowerLevelSelect
                      value={powerLevel}
                      levels={powerLevels}
                      usage={(id) =>
                        entities.filter((x) => parseFields(x.fields).power_level === id).length
                      }
                      onChange={setPowerLevel}
                      onRevise={loadLevels}
                      onChanged={onChanged}
                    />
                  </div>

                  <SectionCard title="System" count={filledCount(system) || undefined}>
                    <SubsectionList
                      keys={SYSTEM_KEYS}
                      section={system}
                      onChange={setSystem}
                      addLabel="Add subsection"
                      bodyPlaceholder="Details"
                    />
                  </SectionCard>

                  <SectionCard title="Abilities" count={abilities.length || undefined}>
                    <EntryList
                      entries={abilities}
                      onChange={setAbilities}
                      namePlaceholder="Ability name"
                      bodyPlaceholder="Description"
                      addLabel="Add ability"
                    />
                  </SectionCard>

                  <SectionCard title="History" count={filledCount(history) || undefined}>
                    <SubsectionList
                      keys={HISTORY_KEYS}
                      section={history}
                      onChange={setHistory}
                      addLabel="Add subsection"
                      bodyPlaceholder="Details"
                    />
                  </SectionCard>
                </>
              ) : isOrgType ? (
                <>
                  <div className="dw-ie__field">
                    <label className="dw-ie__label" htmlFor="ie-origin">
                      Origin
                    </label>
                    <textarea
                      id="ie-origin"
                      className="dw-ie__textarea"
                      value={summary}
                      onChange={(ev) => setSummary(ev.target.value)}
                      placeholder="Where the organisation came from"
                    />
                  </div>

                  <div className="dw-ie__field">
                    <label className="dw-ie__label" htmlFor="ie-description">
                      Description
                    </label>
                    <textarea
                      id="ie-description"
                      className="dw-ie__textarea dw-ie__textarea--tall"
                      value={description}
                      onChange={(ev) => setDescription(ev.target.value)}
                    />
                  </div>

                  <div className="dw-ie__field">
                    <span className="dw-ie__label">Leader</span>
                    <EntitySelect
                      label="Leader"
                      value={entities.find((x) => x.id === leader) || null}
                      missingId={leader}
                      candidates={entities.filter((x) => PERSON_TYPES.includes(x.type_name ?? ''))}
                      onPick={(id) => setLeader(id)}
                      onOpenEntity={onOpenEntity}
                      placeholder="No leader"
                      clearLabel="No leader"
                    />
                  </div>

                  <div className="dw-ie__field">
                    <span className="dw-ie__label">Members</span>
                    <EntityMultiSelect
                      entities={entities}
                      value={members}
                      candidates={entities.filter((x) => PERSON_TYPES.includes(x.type_name ?? ''))}
                      onChange={setMembers}
                      onOpenEntity={onOpenEntity}
                      addLabel="add a member…"
                    />
                  </div>

                  <div className="dw-ie__field">
                    <span className="dw-ie__label">Operates in</span>
                    <EntitySelect
                      label="Operates in"
                      value={entities.find((x) => x.id === operatesIn) || null}
                      missingId={operatesIn}
                      candidates={entities.filter((x) => PLACE_TYPES.includes(x.type_name ?? '') && x.id !== entityId)}
                      onPick={(id) => setOperatesIn(id)}
                      onOpenEntity={onOpenEntity}
                      placeholder="Nowhere"
                      clearLabel="Nowhere"
                    />
                  </div>

                  <div className="dw-ie__field">
                    <label className="dw-ie__label" htmlFor="ie-purpose">
                      Purpose
                    </label>
                    <textarea
                      id="ie-purpose"
                      className="dw-ie__textarea dw-ie__textarea--tall"
                      value={purpose}
                      onChange={(ev) => setPurpose(ev.target.value)}
                    />
                  </div>

                  <SectionCard title="Accomplishments" count={buildEntries(accomplishments).length || undefined}>
                    <EntryList
                      entries={accomplishments}
                      onChange={setAccomplishments}
                      namePlaceholder="Title"
                      bodyPlaceholder="Description"
                      addLabel="Add accomplishment"
                      pill
                    />
                  </SectionCard>
                </>
              ) : (
                <>
                  <div className="dw-ie__field">
                    <label className="dw-ie__label" htmlFor="ie-summary">
                      Summary / notes
                    </label>
                    <textarea
                      id="ie-summary"
                      className="dw-ie__textarea"
                      value={summary}
                      onChange={(ev) => setSummary(ev.target.value)}
                    />
                  </div>

                  <div className="dw-ie__field">
                    <label className="dw-ie__label" htmlFor="ie-tracking">
                      Trail tracking
                    </label>
                    <div className="dw-ie__select-wrap">
                      <select
                        id="ie-tracking"
                        className="dw-ie__select"
                        value={tracking}
                        onChange={(ev) => setTracking(ev.target.value)}
                      >
                        <option value="off">Off — always around, don't track</option>
                        <option value="reappearance">Reappearance — alert when they return</option>
                        <option value="absence">Absence — alert when they vanish</option>
                      </select>
                      <Chevron />
                    </div>
                  </div>

                  <div className="dw-ie__field">
                    <label className="dw-ie__label" htmlFor="ie-threshold">
                      Gap threshold (chapters)
                      {tracking !== 'off' && ' — required'}
                    </label>
                    <input
                      id="ie-threshold"
                      className="dw-ie__input"
                      type="number"
                      min={1}
                      value={threshold}
                      disabled={tracking === 'off'}
                      onChange={(ev) => setThreshold(ev.target.value)}
                      placeholder={tracking === 'off' ? 'n/a' : 'e.g. 3'}
                    />
                    {!thresholdValid && (
                      <span className="dw-ie__hint">Enter a positive number of words.</span>
                    )}
                  </div>
                </>
              )}

              {isCharacter && (
                <div className="dw-ie__field">
                  <span className="dw-ie__label">Fate</span>
                  {death ? (
                    <div className="dw-ie__row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="badge badge-dead" title="Deceased">
                        ☠ Died{deathChapter ? ` · ch.${chapterNumber(deathChapter)}` : ''}
                      </span>
                      <button className="dw-ie__link" onClick={resurrect}>
                        Resurrect
                      </button>
                    </div>
                  ) : (
                    <div className="dw-ie__row">
                      <div className="dw-ie__select-wrap dw-ie__grow">
                        <select
                          className="dw-ie__select"
                          value={deathDraft}
                          onChange={(ev) => setDeathDraft(ev.target.value)}
                        >
                          <option value="">died in chapter…</option>
                          {chapters.map((c) => (
                            <option key={c.id} value={c.id}>
                              {chapterLabel(c)}
                            </option>
                          ))}
                        </select>
                        <Chevron />
                      </div>
                      <button
                        className="dw-ie__btn"
                        disabled={!deathDraft}
                        onClick={() => kill(Number(deathDraft))}
                      >
                        ☠ Kill
                      </button>
                    </div>
                  )}
                </div>
              )}
          </div>

          <aside className="dw-ie__aside">
            {isItem ? (
              <div className="dw-ie__field">
                <span className="dw-ie__label">Possessed by</span>
                <OwnerSelect
                  owner={owner ?? null}
                  candidates={ownerCandidates}
                  onPick={setOwner}
                  onOpenEntity={onOpenEntity}
                />
              </div>
            ) : canOwnItems ? (
              <div className="dw-ie__field">
                <span className="dw-ie__label">Possessions</span>
                {possessions.length === 0 && <span className="dw-ie__empty">None yet</span>}
                <div className="dw-ie__alias-list">
                  {possessions.map((it) => (
                    <span className="dw-ie__alias" key={it.id}>
                      <button className="dw-ie__alias-link" onClick={() => onOpenEntity(it.id)} title="Open item">
                        {it.type_icon} {it.name}
                      </button>
                      <button className="dw-ie__x" title="Remove possession" onClick={() => unassignItem(it.id)}>
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
                <div className="dw-ie__select-wrap">
                  <select
                    className="dw-ie__select"
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
                  <Chevron />
                </div>
                <div className="dw-ie__alias-row">
                  <input
                    className="dw-ie__input dw-ie__input--surface"
                    value={newItemName}
                    onChange={(ev) => setNewItemName(ev.target.value)}
                    placeholder="create a new item"
                    onKeyDown={(ev) => ev.key === 'Enter' && createItem()}
                  />
                  <button
                    className="dw-ie__btn"
                    onClick={createItem}
                    disabled={!newItemName.trim() || itemTypeId == null}
                  >
                    Create
                  </button>
                </div>
              </div>
            ) : null}

              <div className="dw-ie__field">
                <span className="dw-ie__label">Aliases</span>
                {detail.aliases.length === 0 ? (
                  <span className="dw-ie__empty">None yet</span>
                ) : (
                  <div className="dw-ie__alias-list">
                    {detail.aliases.map((a) => (
                      <span className="dw-ie__alias" key={a.id}>
                        {a.alias}
                        <button
                          className="dw-ie__x"
                          title="Remove alias"
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
                )}
                <div className="dw-ie__alias-row">
                  <input
                    className="dw-ie__input dw-ie__input--surface"
                    value={aliasDraft}
                    onChange={(ev) => setAliasDraft(ev.target.value)}
                    placeholder="Add a spelling variant"
                    onKeyDown={(ev) => ev.key === 'Enter' && addAlias()}
                  />
                  <button className="dw-ie__btn" onClick={addAlias}>
                    Add
                  </button>
                </div>
              </div>

              <div className="dw-ie__field">
                <div className="dw-ie__label-row">
                  <span className="dw-ie__label">Appearances</span>
                  <span className="dw-ie__count">
                    {appearances.length} {appearances.length === 1 ? 'chapter' : 'chapters'}
                  </span>
                </div>
                <Trail chapters={chapters} seen={seenChapters} onOpenChapter={onOpenChapter} />
                {appearances.length === 0 && <span className="dw-ie__empty">Not seen yet</span>}
              </div>

              <button className="dw-ie__merge" onClick={() => setMergeOpen((v) => !v)}>
                <MergeIcon />
                <span>{mergeOpen ? 'Close merge' : 'Merge another entity'}</span>
              </button>

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
          </aside>
        </div>

        <footer className="dw-ie__foot">
          <button
            className="dw-ie__btn dw-ie__btn--danger"
            onClick={async () => {
              if (confirm(`Move "${e.name}" to trash? You can restore it later from Review → Trash.`)) {
                await api.trashEntities([entityId]);
                onChanged();
                onClose();
              }
            }}
          >
            <TrashIcon />
            <span>Move to trash</span>
          </button>
          <div style={{ flex: 1 }} />
          {saved && <span className="dw-ie__saved">saved ✓</span>}
          <button
            className="dw-ie__btn dw-ie__btn--save"
            disabled={!dirty || !thresholdValid}
            onClick={save}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Item-editor widgets — small, local, no dependencies.                        */
/* -------------------------------------------------------------------------- */

const RANK_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Unranked' },
  ...ITEM_RANKS.map((r) => ({ value: r, label: r })),
];

/** Storage uses '' for unranked; the CSS colours key off a lowercase `data-rank`. */
function rankKey(value: string): string {
  return value ? value.toLowerCase() : 'unranked';
}

/** Close a popover on an outside click or on Escape (taken in the capture phase). */
function useDismiss(ref: { current: HTMLDivElement | null }, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) close();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation(); // a dropdown swallows the first Escape before the panel sees it
      close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [ref, open, close]);
}

/** Rank picker: the chip + 6-step meter, coloured per rank, as a custom listbox. */
function RankSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = RANK_OPTIONS.find((o) => o.value === value) ?? RANK_OPTIONS[0];
  useDismiss(ref, open, () => setOpen(false));

  const meter = (
    <span className="dw-ie__meter" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );

  return (
    <div className="dw-ie__dropdown" ref={ref}>
      <button
        type="button"
        className="dw-ie__trigger"
        data-rank={rankKey(value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Rank"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dw-ie__chip">{RANK_OPTIONS.find((o) => o.value === value)?.label ?? 'Unranked'}</span>
        {meter}
        <Chevron />
      </button>
      <div className="dw-ie__popover" role="listbox" hidden={!open} aria-label="Rank">
        {RANK_OPTIONS.map((o) => (
          <button
            key={o.value || 'unranked'}
            type="button"
            className="dw-ie__option"
            role="option"
            data-rank={rankKey(o.value)}
            aria-selected={o.value === value}
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
          >
            <span className="dw-ie__chip">{o.label}</span>
            {meter}
            <Check />
          </button>
        ))}
      </div>
    </div>
  );
}

function OwnerSelect({
  owner,
  candidates,
  onPick,
  onOpenEntity,
}: {
  owner: Entity | null;
  candidates: Entity[];
  onPick: (id: number | null) => void;
  onOpenEntity: (id: number) => void;
}) {
  return (
    <EntitySelect
      label="Possessed by"
      value={owner}
      candidates={candidates}
      onPick={onPick}
      onOpenEntity={onOpenEntity}
      clearLabel="Nobody"
      placeholder="Assign to…"
    />
  );
}

/** Generic single-entity selector: candidates are grouped by their type. */
function EntitySelect({
  value,
  missingId,
  candidates,
  onPick,
  onOpenEntity,
  label,
  placeholder = 'Assign to…',
  clearLabel = 'Nobody',
}: {
  value: Entity | null;
  /** Stored id that no longer resolves (its entity was trashed) — shown as missing. */
  missingId?: number | null;
  candidates: Entity[];
  onPick: (id: number | null) => void;
  onOpenEntity?: (id: number) => void;
  label: string;
  placeholder?: string;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const groups: { type: string; items: Entity[] }[] = [];
  for (const c of candidates) {
    const type = c.type_name || 'Other';
    const bucket = groups.find((g) => g.type === type);
    if (bucket) bucket.items.push(c);
    else groups.push({ type, items: [c] });
  }

  return (
    <div className="dw-ie__dropdown" ref={ref}>
      <button
        type="button"
        className="dw-ie__trigger dw-ie__trigger--owner"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dw-ie__avatar" aria-hidden="true">
          {value ? value.type_icon : <PersonIcon />}
        </span>
        <span className={`dw-ie__trigger-text${value ? '' : ' is-placeholder'}`}>
          {value ? value.name : missingId != null ? 'Missing entity' : placeholder}
        </span>
        <Chevron />
      </button>
      <div
        className="dw-ie__popover dw-ie__popover--owners"
        role="listbox"
        hidden={!open}
        aria-label={label}
      >
        <button
          type="button"
          className="dw-ie__option dw-ie__option--plain"
          role="option"
          aria-selected={!value}
          onClick={() => {
            onPick(null);
            setOpen(false);
          }}
        >
          <span className="dw-ie__name">{clearLabel}</span>
          <Check />
        </button>
        {groups.map((g) => (
          <div className="dw-ie__group" key={g.type}>
            <div className="dw-ie__group-label">{g.type}</div>
            {g.items.map((c) => (
              <button
                key={c.id}
                type="button"
                className="dw-ie__option"
                role="option"
                aria-selected={value?.id === c.id}
                onDoubleClick={() => onOpenEntity?.(c.id)}
                onClick={() => {
                  onPick(c.id);
                  setOpen(false);
                }}
              >
                <span className="dw-ie__avatar" aria-hidden="true">
                  {c.type_icon}
                </span>
                <span className="dw-ie__name">{c.name}</span>
                <Check />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Evolvable toggle. */
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="dw-ie__switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  );
}

/**
 * Appearances trail: one bar per chapter, lit where the entity is mentioned.
 * Short books show every chapter; long books show a window around the mentions
 * (a 300-chapter book would otherwise be 300 one-pixel bars).
 */
function Trail({
  chapters,
  seen,
  onOpenChapter,
}: {
  chapters: Chapter[];
  seen: Set<number>;
  onOpenChapter: (id: number) => void;
}) {
  if (chapters.length === 0) return <span className="dw-ie__empty">No chapters yet</span>;

  const WINDOW = 40;
  let start = 0;
  let end = chapters.length;
  if (chapters.length > WINDOW * 1.5) {
    const firstSeen = chapters.findIndex((c) => seen.has(c.id));
    let lastSeen = -1;
    for (let i = chapters.length - 1; i >= 0; i -= 1) {
      if (seen.has(chapters[i].id)) {
        lastSeen = i;
        break;
      }
    }
    if (firstSeen === -1) {
      end = WINDOW;
    } else {
      const mid = Math.floor((firstSeen + lastSeen) / 2);
      start = Math.max(0, mid - Math.floor(WINDOW / 2));
      end = Math.min(chapters.length, start + WINDOW);
      start = Math.max(0, end - WINDOW);
    }
  }

  const shown = chapters.slice(start, end);
  const marks = [shown[0], shown[Math.floor(shown.length / 2)], shown[shown.length - 1]];
  const windowed = start > 0 || end < chapters.length;

  return (
    <>
      <div className="dw-ie__trail">
        {shown.map((c) => {
          const on = seen.has(c.id);
          const title = `${chapterLabel(c)}${on ? ' — mentioned' : ''}`;
          return on ? (
            <button
              key={c.id}
              type="button"
              className="dw-ie__tick is-on"
              title={title}
              aria-label={title}
              onClick={() => onOpenChapter(c.id)}
            />
          ) : (
            <i key={c.id} className="dw-ie__tick" title={title} />
          );
        })}
      </div>
      <div className="dw-ie__trail-nums" aria-hidden="true">
        {marks.map((c, i) => (
          <span key={i}>{c ? chapterNumber(c) : ''}</span>
        ))}
      </div>
      {windowed && (
        <span className="dw-ie__hint">
          Showing {shown.length} of {chapters.length} chapters
        </span>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Character system — Power Level, System, Abilities, History widgets.         */
/* -------------------------------------------------------------------------- */

/** A collapsible section card (title + optional count + chevron). */
function SectionCard({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`dw-ie__section${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="dw-ie__section-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dw-ie__section-title">{title}</span>
        {count != null && <span className="dw-ie__count">{count}</span>}
        <Chevron />
      </button>
      {open && <div className="dw-ie__section-body">{children}</div>}
    </section>
  );
}

/** A labelled text area — the editable body of a fixed subsection. */
function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="dw-ie__sub">
      <span className="dw-ie__label">{label}</span>
      <textarea
        className="dw-ie__textarea dw-ie__textarea--sub"
        value={value}
        placeholder={placeholder}
        onChange={(ev) => onChange(ev.target.value)}
      />
    </label>
  );
}

/**
 * A section's subsections as pills: the fixed ones (editable) plus any the
 * writer added. One pill is open at a time and shows its panel below.
 */
function SubsectionList({
  keys,
  section,
  onChange,
  addLabel,
  bodyPlaceholder,
}: {
  keys: readonly (readonly [string, string])[];
  section: Section;
  onChange: (next: Section) => void;
  addLabel: string;
  bodyPlaceholder: string;
}) {
  const [openId, setOpenId] = useState<string | null>(keys.length ? `f:${keys[0][0]}` : null);
  const nameRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const openFixed = openId?.startsWith('f:') ? openId.slice(2) : null;
  const openCustom =
    openId?.startsWith('c:') ? section.custom.find((e) => e.id === openId.slice(2)) ?? null : null;
  const fixedLabel = (key: string) => keys.find(([k]) => k === key)?.[1] ?? '';

  function setValue(key: string, value: string) {
    onChange({ ...section, values: { ...section.values, [key]: value } });
  }

  function patchCustom(id: string, next: Partial<Entry>) {
    onChange({ ...section, custom: section.custom.map((e) => (e.id === id ? { ...e, ...next } : e)) });
  }

  function addCustom() {
    const entry: Entry = { id: uid(), name: '', body: '' };
    onChange({ ...section, custom: [...section.custom, entry] });
    setOpenId(`c:${entry.id}`);
    requestAnimationFrame(() => nameRefs.current[entry.id]?.focus());
  }

  function removeCustom(id: string) {
    onChange({ ...section, custom: section.custom.filter((e) => e.id !== id) });
    if (openId === `c:${id}`) setOpenId(keys.length ? `f:${keys[0][0]}` : null);
  }

  return (
    <div className="dw-ie__subsections">
      <div className="dw-ie__pills" role="tablist">
        {keys.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={openFixed === key}
            className={`dw-ie__pill${openFixed === key ? ' is-open' : ''}`}
            onClick={() => setOpenId(`f:${key}`)}
          >
            <span className="dw-ie__pill-label">{label}</span>
          </button>
        ))}
        {section.custom.map((entry) => {
          const active = openCustom?.id === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`dw-ie__pill${active ? ' is-open' : ''}`}
              onClick={() => setOpenId(`c:${entry.id}`)}
            >
              <span className="dw-ie__pill-label">{entry.name.trim() || 'Untitled'}</span>
            </button>
          );
        })}
        <button
          type="button"
          className="dw-ie__pill dw-ie__pill--add"
          onClick={addCustom}
          aria-label={addLabel}
        >
          <PlusIcon />
          <span>{addLabel}</span>
        </button>
      </div>

      {openFixed && (
        <div className="dw-ie__panel">
          <TextField
            label={fixedLabel(openFixed)}
            value={section.values[openFixed] ?? ''}
            placeholder={`${fixedLabel(openFixed)}…`}
            onChange={(v) => setValue(openFixed, v)}
          />
        </div>
      )}

      {openCustom && (
        <div className="dw-ie__panel">
          <div className="dw-ie__panel-head">
            <input
              ref={(el) => {
                nameRefs.current[openCustom.id] = el;
              }}
              className="dw-ie__input dw-ie__input--surface dw-ie__grow"
              value={openCustom.name}
              placeholder="Subsection name"
              onChange={(ev) => patchCustom(openCustom.id, { name: ev.target.value })}
            />
            <button
              type="button"
              className="dw-ie__del"
              title="Delete subsection"
              aria-label={`Delete ${openCustom.name.trim() || 'subsection'}`}
              onClick={() => removeCustom(openCustom.id)}
            >
              <XIcon />
            </button>
          </div>
          <textarea
            className="dw-ie__textarea dw-ie__textarea--sub"
            value={openCustom.body}
            placeholder={bodyPlaceholder}
            onChange={(ev) => patchCustom(openCustom.id, { body: ev.target.value })}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A list of user-created rows (abilities, custom subsections, accomplishments).
 * A row is compact until opened, then it reveals its name field and body.
 * With `pill`, the collapsed row is a small pill showing only its title.
 */
function EntryList({
  entries,
  onChange,
  label,
  namePlaceholder = 'Name',
  bodyPlaceholder = 'Details',
  addLabel = 'Add',
  pill = false,
}: {
  entries: Entry[];
  onChange: (next: Entry[]) => void;
  label?: string;
  namePlaceholder?: string;
  bodyPlaceholder?: string;
  addLabel?: string;
  pill?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const nameRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function add() {
    const entry: Entry = { id: uid(), name: '', body: '' };
    onChange([...entries, entry]);
    setOpenId(entry.id);
    requestAnimationFrame(() => nameRefs.current[entry.id]?.focus());
  }

  function patch(id: string, next: Partial<Entry>) {
    onChange(entries.map((e) => (e.id === id ? { ...e, ...next } : e)));
  }

  function remove(id: string) {
    onChange(entries.filter((e) => e.id !== id));
    if (openId === id) setOpenId(null);
  }

  return (
    <div className="dw-ie__entries">
      {label && <div className="dw-ie__sub-label">{label}</div>}
      {entries.map((entry) => {
        const open = openId === entry.id;
        const name = entry.name.trim();
        return (
          <div className={pill ? 'dw-ie__sub' : `dw-ie__entry${open ? ' is-open' : ''}`} key={entry.id}>
            <div className="dw-ie__entry-head">
              <button
                type="button"
                className={pill ? `dw-ie__pill${open ? ' is-open' : ''}` : 'dw-ie__entry-toggle'}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : entry.id)}
              >
                {pill ? (
                  <span className={`dw-ie__pill-label${name ? '' : ' is-empty'}`}>{name || 'Untitled'}</span>
                ) : (
                  <>
                    <RowChevron />
                    <span className={`dw-ie__entry-name${name ? '' : ' is-empty'}`}>
                      {name || 'Untitled'}
                    </span>
                  </>
                )}
              </button>
              <button
                type="button"
                className="dw-ie__del"
                title="Delete"
                aria-label={`Delete ${name || (pill ? 'accomplishment' : 'entry')}`}
                onClick={() => remove(entry.id)}
              >
                <XIcon />
              </button>
            </div>
            {open && (
              <div className={pill ? 'dw-ie__panel' : 'dw-ie__entry-body'}>
                <input
                  ref={(el) => {
                    nameRefs.current[entry.id] = el;
                  }}
                  className="dw-ie__input dw-ie__input--surface"
                  value={entry.name}
                  placeholder={namePlaceholder}
                  onChange={(ev) => patch(entry.id, { name: ev.target.value })}
                />
                <textarea
                  className="dw-ie__textarea dw-ie__textarea--sub"
                  value={entry.body}
                  placeholder={bodyPlaceholder}
                  onChange={(ev) => patch(entry.id, { body: ev.target.value })}
                />
              </div>
            )}
          </div>
        );
      })}
      <button type="button" className="dw-ie__add" onClick={add}>
        <PlusIcon />
        <span>{addLabel}</span>
      </button>
    </div>
  );
}

/**
 * Multi-select over a shared candidate list, used by an Organisation's
 * Members. Mirrors the Possessions control: chosen entries are alias chips,
 * and a native select adds the next one. The caller supplies the `.dw-ie__field`
 * wrapper and its label.
 */
function EntityMultiSelect({
  entities,
  value,
  candidates,
  onChange,
  onOpenEntity,
  addLabel = 'add one…',
}: {
  entities: Entity[];
  value: number[];
  candidates: Entity[];
  onChange: (ids: number[]) => void;
  onOpenEntity?: (id: number) => void;
  addLabel?: string;
}) {
  const selected = value
    .map((id) => entities.find((x) => x.id === id))
    .filter((e): e is Entity => !!e);
  const missing = value.filter((id) => !entities.some((x) => x.id === id));
  const unused = candidates.filter((c) => !value.includes(c.id));

  return (
    <>
      {selected.length === 0 && missing.length === 0 && <span className="dw-ie__empty">None yet</span>}
      <div className="dw-ie__alias-list">
        {selected.map((c) => (
          <span className="dw-ie__alias" key={c.id}>
            <button
              type="button"
              className="dw-ie__alias-link"
              onClick={() => onOpenEntity?.(c.id)}
              title={`Open ${c.name}`}
            >
              {c.type_icon} {c.name}
            </button>
            <button
              type="button"
              className="dw-ie__x"
              title="Remove"
              aria-label={`Remove ${c.name}`}
              onClick={() => onChange(value.filter((x) => x !== c.id))}
            >
              ✕
            </button>
          </span>
        ))}
        {missing.map((id) => (
          <span className="dw-ie__alias" key={`missing-${id}`} title="This entity is in the trash">
            <span className="dw-ie__empty">Missing entity</span>
            <button
              type="button"
              className="dw-ie__x"
              title="Remove"
              aria-label="Remove missing entity"
              onClick={() => onChange(value.filter((x) => x !== id))}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="dw-ie__select-wrap">
        <select
          className="dw-ie__select"
          value=""
          disabled={unused.length === 0}
          onChange={(ev) => {
            if (ev.target.value) onChange([...value, Number(ev.target.value)]);
          }}
        >
          <option value="">{unused.length === 0 ? 'nobody to add' : addLabel}</option>
          {unused.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Chevron />
      </div>
    </>
  );
}

/**
 * Power-level picker: the Item Rank dropdown, but the ladder is the writer's
 * own and each rung carries a colour. Levels are managed inline (add / rename /
 * recolour / delete); deleting one that is in use warns and sets those
 * characters back to Unranked.
 */
function PowerLevelSelect({
  value,
  levels,
  usage,
  onChange,
  onRevise,
  onChanged,
}: {
  value: number | null;
  levels: PowerLevel[];
  usage: (id: number) => number;
  onChange: (id: number | null) => void;
  onRevise: () => Promise<void>;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftColor, setDraftColor] = useState(LEVEL_COLORS[0]);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const colourTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useDismiss(ref, open, () => {
    setOpen(false);
    setRenaming(null);
  });

  const current = levels.find((l) => l.id === value) ?? null;
  const currentIndex = current ? levels.findIndex((l) => l.id === current.id) : -1;

  async function add() {
    const name = draft.trim();
    if (!name) return;
    const created = await api.addPowerLevel(name, draftColor);
    setDraft('');
    setDraftColor(LEVEL_COLORS[(levels.length + 1) % LEVEL_COLORS.length]);
    await onRevise();
    onChange(created.id);
  }

  async function commitRename(id: number) {
    const name = renameDraft.trim();
    setRenaming(null);
    if (!name) return;
    await api.updatePowerLevel(id, { name });
    await onRevise();
    onChanged();
  }

  // A colour input fires continuously while the picker is open, so settle
  // before hitting the server.
  function recolour(id: number, color: string) {
    if (colourTimer.current) clearTimeout(colourTimer.current);
    colourTimer.current = setTimeout(() => {
      colourTimer.current = null;
      void (async () => {
        await api.updatePowerLevel(id, { color });
        await onRevise();
        onChanged();
      })();
    }, 300);
  }

  async function remove(id: number) {
    const level = levels.find((l) => l.id === id);
    const used = usage(id);
    const msg = used
      ? `Delete “${level?.name ?? 'this level'}”? ${used} character${used === 1 ? '' : 's'} will be set back to Unranked.`
      : `Delete “${level?.name ?? 'this level'}”?`;
    if (!window.confirm(msg)) return;
    await api.deletePowerLevel(id);
    if (value === id) onChange(null);
    await onRevise();
    onChanged();
  }

  return (
    <div className="dw-ie__dropdown" ref={ref}>
      <button
        type="button"
        className="dw-ie__trigger"
        style={current?.color ? ({ '--rank': current.color } as CSSProperties) : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Power level"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dw-ie__chip">{current ? current.name : 'Unranked'}</span>
        {levels.length > 0 && (
          <span className="dw-ie__meter dw-ie__meter--ladder" aria-hidden="true">
            {levels.map((l, i) => (
              <i key={l.id} className={i <= currentIndex ? 'is-on' : ''} />
            ))}
          </span>
        )}
        <Chevron />
      </button>
      <div
        className="dw-ie__popover dw-ie__popover--levels"
        role="listbox"
        hidden={!open}
        aria-label="Power level"
      >
        <button
          type="button"
          className="dw-ie__option dw-ie__option--plain"
          role="option"
          aria-selected={value == null}
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          <span className="dw-ie__name">Unranked</span>
          <Check />
        </button>
        {levels.map((level) => {
          const selected = value === level.id;
          return (
            <div
              className="dw-ie__level"
              role="option"
              aria-selected={selected}
              key={level.id}
              data-testid="power-level-option"
              style={level.color ? ({ '--rank': level.color } as CSSProperties) : undefined}
            >
              <input
                type="color"
                className="dw-ie__swatch"
                value={level.color || '#8a91a0'}
                title={`Colour for ${level.name}`}
                aria-label={`Colour for ${level.name}`}
                onChange={(ev) => recolour(level.id, ev.target.value)}
              />
              {renaming === level.id ? (
                <input
                  className="dw-ie__input dw-ie__input--surface dw-ie__level-rename"
                  autoFocus
                  value={renameDraft}
                  onChange={(ev) => setRenameDraft(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') commitRename(level.id);
                    if (ev.key === 'Escape') {
                      ev.stopPropagation();
                      setRenaming(null);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="dw-ie__level-pick"
                  onClick={() => {
                    onChange(level.id);
                    setOpen(false);
                  }}
                >
                  <span className="dw-ie__chip dw-ie__chip--sm">{level.name}</span>
                  <Check />
                </button>
              )}
              <button
                type="button"
                className="dw-ie__del"
                title="Rename level"
                aria-label={`Rename ${level.name}`}
                onClick={() => {
                  setRenaming(level.id);
                  setRenameDraft(level.name);
                }}
              >
                <PencilIcon />
              </button>
              <button
                type="button"
                className="dw-ie__del"
                title="Delete level"
                aria-label={`Delete ${level.name}`}
                onClick={() => remove(level.id)}
              >
                <XIcon />
              </button>
            </div>
          );
        })}
        <div className="dw-ie__alias-row dw-ie__level-add">
          <input
            type="color"
            className="dw-ie__swatch"
            value={draftColor}
            title="Colour for the new level"
            aria-label="New level colour"
            onChange={(ev) => setDraftColor(ev.target.value)}
          />
          <input
            className="dw-ie__input dw-ie__input--surface"
            value={draft}
            placeholder="New level…"
            onChange={(ev) => setDraft(ev.target.value)}
            onKeyDown={(ev) => ev.key === 'Enter' && add()}
          />
          <button className="dw-ie__btn" onClick={add} disabled={!draft.trim()}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

/* Inline icons — bundled in the markup, so the app stays offline. */
function Chevron() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** A row disclosure: points right when closed, down when open. */
function RowChevron() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function Check() {
  return (
    <svg className="dw-ie__check" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21a7 7 0 0 1 14 0" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 16-5-5-9 9" />
    </svg>
  );
}

function MergeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4v6a5 5 0 0 0 5 5h5" />
      <path d="m14 12 3 3-3 3" />
      <path d="M7 20v-6" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function ExitIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4L20 8l-4-4L4 16z" />
      <path d="m14 6 4 4" />
    </svg>
  );
}
