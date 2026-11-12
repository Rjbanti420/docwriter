import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { chapterLabel } from '../chapters';
import { parseFields } from '../entityMedia';
import type {
  Chapter,
  Entity,
  Gun,
  Question,
  TimelineEvent,
  TimelineEventInput,
  TimelineKind,
  TimelineRole,
} from '../types';

type Tab = 'map' | 'story';
type KindFilter = 'all' | TimelineKind;

interface MapMarker {
  key: string;
  kind: 'gun' | 'question' | 'death';
  label: string;
  title: string;
  action?: () => void;
}

interface LinkDraft {
  id: number;
  name: string;
  role: TimelineRole;
  type_color?: string | null;
}

const KINDS: Array<{ id: TimelineKind; label: string }> = [
  { id: 'event', label: 'Event' },
  { id: 'birth', label: 'Birth' },
  { id: 'death', label: 'Death' },
  { id: 'battle', label: 'Battle' },
  { id: 'reveal', label: 'Reveal' },
  { id: 'travel', label: 'Travel' },
  { id: 'other', label: 'Other' },
];

const ROLE_LABEL: Record<TimelineRole, string> = {
  participant: 'Person',
  location: 'Place',
  item: 'Item',
};

function kindLabel(kind: string): string {
  return KINDS.find((k) => k.id === kind)?.label ?? kind;
}

function roleFor(entity: Entity): TimelineRole {
  const type = (entity.type_name ?? '').toLowerCase();
  if (type === 'location') return 'location';
  if (type === 'item') return 'item';
  return 'participant';
}

function deathChapterId(entity: Entity): number | null {
  const death = parseFields(entity.fields).death;
  if (!death || typeof death !== 'object') return null;
  const id = Number((death as { chapter?: unknown }).chapter);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function chapterFor(event: TimelineEvent, chapters: Chapter[]): Chapter | undefined {
  return event.chapter_id == null ? undefined : chapters.find((c) => c.id === event.chapter_id);
}

function anchorLabel(event: TimelineEvent, chapters: Chapter[]): string {
  const chapter = chapterFor(event, chapters);
  if (chapter) return chapterLabel(chapter);
  if (event.chapter_number) {
    return `Chapter ${event.chapter_number}${event.chapter_title ? ` — ${event.chapter_title}` : ''}`;
  }
  return 'Unplaced';
}

function EventEditor({
  event,
  chapters,
  entities,
  onClose,
  onSaved,
}: {
  event: TimelineEvent | 'new';
  chapters: Chapter[];
  entities: Entity[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = event === 'new';
  const [title, setTitle] = useState(isNew ? '' : event.title);
  const [summary, setSummary] = useState(isNew ? '' : event.summary);
  const [chapterId, setChapterId] = useState<number | null>(isNew ? null : event.chapter_id);
  const [storyTime, setStoryTime] = useState(isNew ? '' : event.story_time);
  const [kind, setKind] = useState<TimelineKind>(isNew ? 'event' : event.kind);
  const [links, setLinks] = useState<LinkDraft[]>(
    isNew
      ? []
      : event.entities.map((link) => ({
          id: link.entity_id,
          name: link.name,
          role: link.role,
          type_color: link.type_color,
        }))
  );
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const term = query.trim().toLowerCase();
  const hits = term
    ? entities
        .filter(
          (entity) =>
            !links.some((link) => link.id === entity.id) &&
            `${entity.name} ${entity.type_name ?? ''}`.toLowerCase().includes(term)
        )
        .slice(0, 6)
    : [];

  const addLink = (entity: Entity) => {
    if (links.some((link) => link.id === entity.id)) return;
    setLinks([...links, { id: entity.id, name: entity.name, role: roleFor(entity), type_color: entity.type_color }]);
    setQuery('');
  };

  const save = async () => {
    if (!title.trim()) {
      setError('Give the event a title.');
      return;
    }
    setSaving(true);
    setError('');
    const input: TimelineEventInput = {
      title: title.trim(),
      summary,
      chapterId,
      storyTime,
      kind,
      entities: links.map((link) => ({ entityId: link.id, role: link.role })),
    };
    try {
      if (isNew) await api.createTimelineEvent(input);
      else await api.updateTimelineEvent(event.id, input);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal tl-editor"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? 'New story event' : 'Edit story event'}
      >
        <div className="modal-head">
          <h2>{isNew ? 'New story event' : 'Edit story event'}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label htmlFor="tl-title">Event</label>
            <input
              id="tl-title"
              autoFocus
              value={title}
              onChange={(ev) => setTitle(ev.target.value)}
              placeholder="e.g. Mara learns who signed the order"
            />
          </div>

          <div className="fields-2">
            <div className="field">
              <label htmlFor="tl-chapter">Manuscript chapter</label>
              <select
                id="tl-chapter"
                value={chapterId ?? ''}
                onChange={(ev) => setChapterId(ev.target.value ? Number(ev.target.value) : null)}
              >
                <option value="">Unplaced / planned</option>
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapterLabel(chapter)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="tl-kind">Kind</label>
              <select id="tl-kind" value={kind} onChange={(ev) => setKind(ev.target.value as TimelineKind)}>
                {KINDS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="tl-time">Story time</label>
            <input
              id="tl-time"
              value={storyTime}
              onChange={(ev) => setStoryTime(ev.target.value)}
              placeholder="e.g. three winters before the siege"
            />
          </div>

          <div className="field">
            <label htmlFor="tl-summary">What happens</label>
            <textarea
              id="tl-summary"
              rows={4}
              value={summary}
              onChange={(ev) => setSummary(ev.target.value)}
              placeholder="A sentence or two is enough."
            />
          </div>

          <div className="field">
            <label>Linked cards</label>
            {links.length > 0 && (
              <div className="tl-links">
                {links.map((link) => (
                  <span className="tl-link" key={link.id}>
                    <i style={{ background: link.type_color ?? 'var(--color-accent)' }} />
                    {link.name}
                    <small>{ROLE_LABEL[link.role]}</small>
                    <button
                      type="button"
                      aria-label={`Remove ${link.name}`}
                      onClick={() => setLinks(links.filter((item) => item.id !== link.id))}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder="Search a character, place, or item…"
              aria-label="Search cards to link"
            />
            {hits.length > 0 && (
              <div className="tl-picker">
                {hits.map((entity) => (
                  <button type="button" key={entity.id} onClick={() => addLink(entity)}>
                    <i style={{ background: entity.type_color ?? 'var(--color-accent)' }} />
                    <span>{entity.name}</span>
                    <small>{ROLE_LABEL[roleFor(entity)]}</small>
                  </button>
                ))}
              </div>
            )}
            {term && hits.length === 0 && <p className="progress">No matching cards.</p>}
          </div>

          {error && (
            <div className="save-error" role="alert">
              <div>{error}</div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Add event' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventCard({
  event,
  order,
  canUp,
  canDown,
  busy,
  chapters,
  onEdit,
  onDelete,
  onMove,
  onOpenChapter,
  onOpenEntity,
}: {
  event: TimelineEvent;
  order: number;
  canUp: boolean;
  canDown: boolean;
  busy: boolean;
  chapters: Chapter[];
  onEdit: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onOpenChapter: (id: number) => void;
  onOpenEntity: (id: number) => void;
}) {
  const chapter = chapterFor(event, chapters);
  return (
    <li className="tl-event" data-kind={event.kind}>
      <span className="tl-event__order" aria-hidden="true">
        {order}
      </span>
      <div className="tl-event__body">
        <div className="tl-event__meta">
          <span className="tl-kind">{kindLabel(event.kind)}</span>
          {event.story_time && <span className="tl-time">{event.story_time}</span>}
          <span className={`tl-anchor${chapter ? '' : ' is-unplaced'}`}>{anchorLabel(event, chapters)}</span>
        </div>
        <h3>{event.title}</h3>
        {event.summary && <p>{event.summary}</p>}
        {event.entities.length > 0 && (
          <div className="tl-links">
            {event.entities.map((link) => (
              <button
                type="button"
                className="tl-link"
                key={`${link.entity_id}-${link.role}`}
                onClick={() => onOpenEntity(link.entity_id)}
                title={`Open ${link.name}`}
              >
                <i style={{ background: link.type_color ?? 'var(--color-accent)' }} />
                {link.name}
                <small>{ROLE_LABEL[link.role]}</small>
              </button>
            ))}
          </div>
        )}
        <div className="tl-event__actions">
          {chapter && (
            <button className="btn-secondary" onClick={() => onOpenChapter(chapter.id)}>
              Open chapter
            </button>
          )}
          <button className="btn-secondary" onClick={onEdit}>
            Edit
          </button>
          <button className="ghost" onClick={() => onMove(-1)} disabled={busy || !canUp} aria-label="Move earlier">
            ↑
          </button>
          <button className="ghost" onClick={() => onMove(1)} disabled={busy || !canDown} aria-label="Move later">
            ↓
          </button>
          <button className="btn-danger" onClick={onDelete} disabled={busy}>
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

export default function TimelineView({
  chapters,
  entities,
  onOpenChapter,
  onOpenEntity,
  onOpenGun,
}: {
  chapters: Chapter[];
  entities: Entity[];
  onOpenChapter: (id: number) => void;
  onOpenEntity: (id: number) => void;
  onOpenGun: (id: number) => void;
}) {
  const [tab, setTab] = useState<Tab>('map');
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [guns, setGuns] = useState<Gun[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<TimelineEvent | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [mapActiveOnly, setMapActiveOnly] = useState(false);

  const chapterSig = chapters
    .map((c) => `${c.id}:${c.number}:${c.title}:${c.sort_order}:${c.word_count}`)
    .join('|');
  const entitySig = entities.map((e) => `${e.id}:${e.name}:${e.fields}`).join('|');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextEvents, nextGuns, nextQuestions] = await Promise.all([
        api.timelineEvents(),
        api.guns(),
        api.questions(),
      ]);
      setEvents(nextEvents);
      setGuns(nextGuns);
      setQuestions(nextQuestions);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, chapterSig, entitySig]);

  const eventCountByChapter = useMemo(() => {
    const counts = new Map<number, number>();
    for (const event of events) {
      if (event.chapter_id != null) counts.set(event.chapter_id, (counts.get(event.chapter_id) ?? 0) + 1);
    }
    return counts;
  }, [events]);

  const markersByChapter = useMemo(() => {
    const map = new Map<number, MapMarker[]>();
    const add = (chapterId: number | null | undefined, marker: MapMarker) => {
      if (chapterId == null) return;
      const rows = map.get(chapterId) ?? [];
      rows.push(marker);
      map.set(chapterId, rows);
    };

    for (const gun of guns) {
      if (gun.appearance_chapter_id != null) {
        add(gun.appearance_chapter_id, {
          key: `gun-${gun.id}-planted`,
          kind: 'gun',
          label: 'Gun',
          title: `Planted: ${gun.title}`,
          action: () => onOpenGun(gun.id),
        });
      }
      if (gun.planned_chapter_id != null) {
        add(gun.planned_chapter_id, {
          key: `gun-${gun.id}-payoff`,
          kind: 'gun',
          label: 'Payoff',
          title: `Payoff planned: ${gun.title}`,
          action: () => onOpenGun(gun.id),
        });
      }
    }

    for (const question of questions) {
      if (question.source_chapter_id != null) {
        add(question.source_chapter_id, {
          key: `question-${question.id}-source`,
          kind: 'question',
          label: 'Question',
          title: `Raised: ${question.text}`,
        });
      }
      if (question.delivered_chapter_id != null) {
        add(question.delivered_chapter_id, {
          key: `question-${question.id}-delivered`,
          kind: 'question',
          label: 'Answered',
          title: `Answered: ${question.text}`,
        });
      }
    }

    for (const entity of entities) {
      const chapterId = deathChapterId(entity);
      if (chapterId != null) {
        add(chapterId, {
          key: `death-${entity.id}`,
          kind: 'death',
          label: 'Death',
          title: `${entity.name} dies`,
          action: () => onOpenEntity(entity.id),
        });
      }
    }

    return map;
  }, [guns, questions, entities, onOpenGun, onOpenEntity]);

  const totalWords = useMemo(() => chapters.reduce((sum, chapter) => sum + (chapter.word_count || 0), 0), [chapters]);
  const maxWords = useMemo(
    () => Math.max(1, ...chapters.map((chapter) => chapter.word_count || 0)),
    [chapters]
  );

  const activeChapterCount = useMemo(
    () =>
      chapters.filter(
        (chapter) => eventCountByChapter.has(chapter.id) || markersByChapter.has(chapter.id)
      ).length,
    [chapters, eventCountByChapter, markersByChapter]
  );
  const mapChapters = mapActiveOnly
    ? chapters.filter((chapter) => eventCountByChapter.has(chapter.id) || markersByChapter.has(chapter.id))
    : chapters;

  const counts = useMemo(() => {
    const next: Record<string, number> = { all: events.length };
    for (const kind of KINDS) next[kind.id] = 0;
    for (const event of events) next[event.kind] = (next[event.kind] ?? 0) + 1;
    return next;
  }, [events]);

  const shownEvents = useMemo(() => {
    const term = query.trim().toLowerCase();
    return events.filter((event) => {
      if (kindFilter !== 'all' && event.kind !== kindFilter) return false;
      if (!term) return true;
      const haystack = [
        event.title,
        event.summary,
        event.story_time,
        ...event.entities.map((link) => link.name),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [events, kindFilter, query]);

  const moveEvent = async (id: number, direction: -1 | 1) => {
    const index = events.findIndex((event) => event.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= events.length) return;
    const next = events.slice();
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setEvents(next);
    setBusy(true);
    try {
      await api.reorderTimelineEvents(next.map((event) => event.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteEvent = async (event: TimelineEvent) => {
    if (!confirm(`Delete “${event.title}”?`)) return;
    setBusy(true);
    try {
      await api.deleteTimelineEvent(event.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openNew = () => {
    setTab('story');
    setEditor('new');
  };

  return (
    <div className="main-inner">
      <div className="reader-head">
        <div className="reader-head__titles">
          <h1>Timeline</h1>
          <p className="reader-head__sub">
            {chapters.length} chapter{chapters.length === 1 ? '' : 's'} · {totalWords.toLocaleString()} words ·{' '}
            {events.length} event{events.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="reader-head__actions">
          <button className="btn-primary" onClick={openNew}>
            ＋ New event
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Timeline views">
        <button
          role="tab"
          aria-selected={tab === 'map'}
          className={tab === 'map' ? 'active' : ''}
          onClick={() => setTab('map')}
        >
          Map
        </button>
        <button
          role="tab"
          aria-selected={tab === 'story'}
          className={tab === 'story' ? 'active' : ''}
          onClick={() => setTab('story')}
        >
          Story
          {events.length > 0 && <span className="dw-chip-count">{events.length}</span>}
        </button>
      </div>

      {error && (
        <div className="save-error" role="alert">
          <div>{error}</div>
          <button className="btn-secondary" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {!loaded && loading ? (
        <div className="empty-state">Loading timeline…</div>
      ) : tab === 'map' ? (
        <>
          <p className="progress timeline-note">
            Map is manuscript order. Story order is separate, so a flashback can still sit where it belongs in the
            chronology.
          </p>
          <div className="tl-map-tools">
            <div className="dw-filters">
              <button
                className={`dw-chip${mapActiveOnly ? '' : ' is-active'}`}
                aria-pressed={!mapActiveOnly}
                onClick={() => setMapActiveOnly(false)}
              >
                All chapters
                <span className="dw-chip-count">{chapters.length}</span>
              </button>
              <button
                className={`dw-chip${mapActiveOnly ? ' is-active' : ''}`}
                aria-pressed={mapActiveOnly}
                onClick={() => setMapActiveOnly(true)}
              >
                Events &amp; markers
                <span className="dw-chip-count">{activeChapterCount}</span>
              </button>
            </div>
          </div>
          {chapters.length === 0 ? (
            <div className="dw-empty">No chapters yet. Paste one from Read when you are ready.</div>
          ) : mapChapters.length === 0 ? (
            <div className="dw-empty">Nothing placed on the map yet.</div>
          ) : (
            <div className="tl-map">
              {mapChapters.map((chapter) => {
                const markers = markersByChapter.get(chapter.id) ?? [];
                const eventCount = eventCountByChapter.get(chapter.id) ?? 0;
                const words = chapter.word_count || 0;
                return (
                  <div className="tl-chapter" key={chapter.id}>
                    <button className="tl-chapter__open" onClick={() => onOpenChapter(chapter.id)}>
                      <span className="tl-chapter__label">{chapterLabel(chapter)}</span>
                      <span className="tl-chapter__bar" aria-hidden="true">
                        <i style={{ width: `${Math.max(2, (words / maxWords) * 100)}%` }} />
                      </span>
                      <span className="tl-chapter__stats">
                        {words.toLocaleString()} words
                        {eventCount > 0 && ` · ${eventCount} event${eventCount === 1 ? '' : 's'}`}
                      </span>
                    </button>
                    {markers.length > 0 && (
                      <div className="tl-chapter__markers">
                        {markers.slice(0, 4).map((marker) =>
                          marker.action ? (
                            <button
                              type="button"
                              className={`tl-marker tl-marker--${marker.kind}`}
                              key={marker.key}
                              title={marker.title}
                              onClick={marker.action}
                            >
                              {marker.label}
                            </button>
                          ) : (
                            <span
                              className={`tl-marker tl-marker--${marker.kind}`}
                              key={marker.key}
                              title={marker.title}
                            >
                              {marker.label}
                            </span>
                          )
                        )}
                        {markers.length > 4 && <span className="tl-marker">+{markers.length - 4}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="progress timeline-note">
            Events are explicit. Use ↑ and ↓ to set story order; the chapter is only where the scene appears.
          </p>
          <div className="tl-story-tools">
            <input
              className="tl-search"
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder="Search events or linked cards…"
              aria-label="Search story events"
            />
            <div className="dw-filters">
              <button
                className={`dw-chip${kindFilter === 'all' ? ' is-active' : ''}`}
                aria-pressed={kindFilter === 'all'}
                onClick={() => setKindFilter('all')}
              >
                All
                <span className="dw-chip-count">{counts.all}</span>
              </button>
              {KINDS.map((kind) => (
                <button
                  key={kind.id}
                  className={`dw-chip${kindFilter === kind.id ? ' is-active' : ''}`}
                  aria-pressed={kindFilter === kind.id}
                  onClick={() => setKindFilter(kind.id)}
                >
                  {kind.label}
                  <span className="dw-chip-count">{counts[kind.id] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          {events.length === 0 ? (
            <div className="empty-state">
              <h2>No story events yet.</h2>
              <p>Record what happens, when it happens, and who or what it involves. Chapter order is not story order.</p>
              <button className="btn-primary" onClick={openNew}>
                Add the first event
              </button>
            </div>
          ) : shownEvents.length === 0 ? (
            <div className="dw-empty">No events match that filter.</div>
          ) : (
            <ul className="tl-events">
              {shownEvents.map((event) => {
                const index = events.findIndex((item) => item.id === event.id);
                return (
                  <EventCard
                    key={event.id}
                    event={event}
                    order={index + 1}
                    canUp={index > 0}
                    canDown={index < events.length - 1}
                    busy={busy}
                    chapters={chapters}
                    onEdit={() => setEditor(event)}
                    onDelete={() => void deleteEvent(event)}
                    onMove={(direction) => void moveEvent(event.id, direction)}
                    onOpenChapter={onOpenChapter}
                    onOpenEntity={onOpenEntity}
                  />
                );
              })}
            </ul>
          )}
        </>
      )}

      {editor && (
        <EventEditor
          key={editor === 'new' ? 'new' : editor.id}
          event={editor}
          chapters={chapters}
          entities={entities}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
