import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { Candidate, Mention } from '../types';

interface Marker {
  start: number;
  end: number;
  kind: 'known' | 'unknown';
  entityId?: number;
  candidateId?: number;
  color?: string;
  title?: string;
}

export default function ReaderText({
  text,
  mentions,
  candidates,
  onMention,
  onUnknown,
}: {
  text: string;
  mentions: Mention[];
  candidates: Candidate[];
  onMention: (entityId: number) => void;
  onUnknown: (candidateId: number) => void;
}) {
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
          title={mk.title}
          onClick={() => (mk.kind === 'known' ? onMention(mk.entityId!) : onUnknown(mk.candidateId!))}
        >
          {text.slice(mk.start, mk.end)}
        </span>
      );
      pos = mk.end;
    });
    if (pos < text.length) out.push(text.slice(pos));
    return { nodes: out };
  }, [text, mentions, candidates, onMention, onUnknown]);

  return <div className="reader-text">{nodes}</div>;
}
