import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { Candidate, Entity, Mention } from '../types';

interface Marker {
  start: number;
  end: number;
  kind: 'known' | 'unknown';
  entityId?: number;
  candidateId?: number;
  color?: string;
  title?: string;
}

interface HoverState {
  entity: Entity;
  rect: DOMRect;
}

export default function ReaderText({
  text,
  mentions,
  candidates,
  entities,
  onMention,
  onUnknown,
}: {
  text: string;
  mentions: Mention[];
  candidates: Candidate[];
  entities: Entity[];
  onMention: (entityId: number) => void;
  onUnknown: (candidateId: number) => void;
}) {
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const [hover, setHover] = useState<HoverState | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const closeSoon = () => {
    clearClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setHover(null);
    }, 140);
  };

  useEffect(() => {
    setHover(null);
  }, [text]);

  useEffect(() => {
    if (!hover) return;
    const close = () => setHover(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [hover]);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    []
  );

  const { nodes } = useMemo(() => {
    const marks: Marker[] = [];
    for (const m of mentions) {
      marks.push({
        start: m.start_off,
        end: m.end_off,
        kind: 'known',
        entityId: m.entity_id,
        color: m.type_color,
        title: `${m.name} · ${m.type_name}`,
      });
    }
    for (const c of candidates) {
      let positions: Array<{ start: number; end: number }> = [];
      try {
        positions = JSON.parse(c.positions || '[]');
      } catch {
        positions = [];
      }
      for (const p of positions) {
        marks.push({ start: p.start, end: p.end, kind: 'unknown', candidateId: c.id, title: `${c.surface_text} · not yet triaged` });
      }
    }
    // known first at equal start, longer first, then skip overlaps
    marks.sort((a, b) => a.start - b.start || (a.kind === b.kind ? b.end - a.end : a.kind === 'known' ? -1 : 1));
    const chosen: Marker[] = [];
    let cursor = 0;
    for (const mk of marks) {
      if (mk.start < cursor || mk.end <= mk.start) continue;
      chosen.push(mk);
      cursor = mk.end;
    }

    const out: Array<string | JSX.Element> = [];
    let pos = 0;
    chosen.forEach((mk, i) => {
      if (mk.start > pos) out.push(text.slice(pos, mk.start));
      const cls = mk.kind === 'known' ? 'mention' : 'mention unknown';
      const style =
        mk.kind === 'known' ? ({ ['--e']: mk.color } as CSSProperties) : undefined;
      out.push(
        <span
          key={`m${i}`}
          className={cls}
          style={style}
          title={mk.kind === 'unknown' ? mk.title : undefined}
          onMouseEnter={(ev) => {
            if (mk.kind !== 'known' || !mk.entityId || document.querySelector('.highlights-off')) return;
            const entity = entityById.get(mk.entityId);
            if (!entity) return;
            clearClose();
            setHover({ entity, rect: ev.currentTarget.getBoundingClientRect() });
          }}
          onMouseLeave={closeSoon}
          onClick={() => (mk.kind === 'known' ? onMention(mk.entityId!) : onUnknown(mk.candidateId!))}
        >
          {text.slice(mk.start, mk.end)}
        </span>
      );
      pos = mk.end;
    });
    if (pos < text.length) out.push(text.slice(pos));
    return { nodes: out };
  }, [text, mentions, candidates, entityById, onMention, onUnknown]);

  const cardWidth = hover ? Math.min(300, window.innerWidth - 24) : 0;
  const cardLeft = hover
    ? Math.min(
        Math.max(hover.rect.left + hover.rect.width / 2, cardWidth / 2 + 12),
        window.innerWidth - cardWidth / 2 - 12
      )
    : 0;
  const cardAbove =
    !!hover && window.innerHeight - hover.rect.bottom < 210 && hover.rect.top > 210;
  const cardTop = hover ? (cardAbove ? hover.rect.top - 8 : hover.rect.bottom + 8) : 0;
  const typeColor = hover?.entity.type_color || 'var(--color-character)';
  const mentionsCount = hover?.entity.mention_count ?? 0;
  const firstChapter = hover?.entity.first_chapter;
  const lastChapter = hover?.entity.last_chapter;
  const chapterRange =
    firstChapter && lastChapter
      ? `ch.${firstChapter}${lastChapter !== firstChapter ? `–${lastChapter}` : ''}`
      : '';

  return (
    <div className="reader-text">
      {nodes}
      {hover &&
        createPortal(
          <div
            className={`entity-hover-card${cardAbove ? ' is-above' : ''}`}
            style={
              {
                left: cardLeft,
                top: cardTop,
                ['--e']: typeColor,
              } as CSSProperties
            }
            onMouseEnter={clearClose}
            onMouseLeave={closeSoon}
            onClick={() => {
              setHover(null);
              onMention(hover.entity.id);
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                setHover(null);
                onMention(hover.entity.id);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={`Open ${hover.entity.name}`}
          >
            <div className="entity-hover-card__head">
              <span className="entity-hover-card__dot" />
              <span className="entity-hover-card__name">{hover.entity.name}</span>
            </div>
            <div className="entity-hover-card__type">
              {hover.entity.type_name || 'Uncategorised'}
            </div>
            <p className="entity-hover-card__summary">
              {hover.entity.summary?.trim() || 'No summary yet.'}
            </p>
            <div className="entity-hover-card__meta">
              <span>
                {mentionsCount
                  ? `${mentionsCount} mention${mentionsCount === 1 ? '' : 's'}`
                  : 'No appearances'}
              </span>
              {chapterRange && <span>{chapterRange}</span>}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
