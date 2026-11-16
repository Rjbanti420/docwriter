import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { chapterLabel } from '../chapters';
import type { Chapter, Entity } from '../types';

const MAX_HITS = 6;

export default function SearchBox({
  chapters,
  entities,
  onOpenChapter,
  onOpenEntity,
}: {
  chapters: Chapter[];
  entities: Entity[];
  onOpenChapter: (id: number) => void;
  onOpenEntity: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const query = q.trim().toLowerCase();

  // Match the label the row actually shows ("Chapter 1 — The Gate"), or an
  // untitled chapter is invisible to the writer's own word for it.
  const chapterMatches = useMemo(
    () =>
      query
        ? chapters.filter(
            (c) =>
              chapterLabel(c).toLowerCase().includes(query) ||
              String(c.number || '').toLowerCase().includes(query)
          )
        : [],
    [query, chapters]
  );

  const entityMatches = useMemo(
    () =>
      query
        ? entities.filter(
            (e) =>
              e.name.toLowerCase().includes(query) ||
              (e.aliases ?? []).some((alias) => alias.toLowerCase().includes(query)) ||
              (e.type_name || '').toLowerCase().includes(query)
          )
        : [],
    [query, entities]
  );

  const chapterHits = chapterMatches.slice(0, MAX_HITS);
  const entityHits = entityMatches.slice(0, MAX_HITS);
  const hitCount = chapterHits.length + entityHits.length;
  const totalCount = chapterMatches.length + entityMatches.length;

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(hit: { kind: 'chapter' | 'entity'; id: number }) {
    if (hit.kind === 'chapter') onOpenChapter(hit.id);
    else onOpenEntity(hit.id);
    setQ('');
    setOpen(false);
    rootRef.current?.querySelector('input')?.blur();
  }

  function onKeyDown(ev: KeyboardEvent<HTMLInputElement>) {
    if (ev.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!hitCount) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      setActive((i) => {
        const next = ev.key === 'ArrowDown' ? i + 1 : i - 1;
        return (next + hitCount) % hitCount;
      });
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const hit =
        active < chapterHits.length
          ? { kind: 'chapter' as const, id: chapterHits[active].id }
          : { kind: 'entity' as const, id: entityHits[active - chapterHits.length].id };
      pick(hit);
    }
  }

  const showPop = open && query.length > 0;
  const activeId =
    showPop && hitCount > 0
      ? active < chapterHits.length
        ? `search-c-${chapterHits[active].id}`
        : `search-e-${entityHits[active - chapterHits.length].id}`
      : undefined;

  return (
    <div className="search" ref={rootRef}>
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
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        value={q}
        onChange={(ev) => {
          setQ(ev.target.value);
          setOpen(true);
        }}
        onFocus={() => query.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search chapters & entities…"
        aria-label="Search chapters and entities"
        aria-keyshortcuts="Control+K Meta+K"
        title="Search chapters and entities (Ctrl+K)"
        role="combobox"
        aria-expanded={showPop}
        aria-controls={showPop ? 'search-results' : undefined}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        autoComplete="off"
      />
      <span className="sr-only" role="status">
        {showPop
          ? totalCount === 0
            ? 'No matches'
            : totalCount > hitCount
              ? `${hitCount} of ${totalCount} results. Keep typing to narrow.`
              : `${totalCount} ${totalCount === 1 ? 'result' : 'results'}`
          : ''}
      </span>
      {showPop && (
        <div className="search-pop" id="search-results" role="listbox">
          {hitCount === 0 && <div className="search-empty">No matches</div>}

          {chapterHits.length > 0 && <div className="search-group">Chapters</div>}
          {chapterHits.map((c, i) => (
            <button
              key={`c${c.id}`}
              type="button"
              role="option"
              id={`search-c-${c.id}`}
              aria-selected={active === i}
              className={`search-row${active === i ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick({ kind: 'chapter', id: c.id })}
            >
              <span className="search-row-label">
                {c.title || `Chapter ${c.number || ''}`.trim() || 'Untitled chapter'}
              </span>
              <span className="search-row-meta">{c.number ? `Ch. ${c.number}` : 'Chapter'}</span>
            </button>
          ))}

          {entityHits.length > 0 && <div className="search-group">Entities</div>}
          {entityHits.map((e, i) => {
            const gi = chapterHits.length + i;
            return (
              <button
                key={`e${e.id}`}
                type="button"
                role="option"
                id={`search-e-${e.id}`}
                aria-selected={active === gi}
                className={`search-row${active === gi ? ' active' : ''}`}
                onMouseEnter={() => setActive(gi)}
                onClick={() => pick({ kind: 'entity', id: e.id })}
              >
                <span className="search-row-label">{e.name}</span>
                <span className="search-row-meta">{e.type_name || 'Entity'}</span>
              </button>
            );
          })}
          {totalCount > hitCount && (
            <div className="search-more">
              Showing {hitCount} of {totalCount} matches — keep typing to narrow.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
