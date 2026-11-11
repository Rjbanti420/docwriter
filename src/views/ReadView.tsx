import { useEffect, useState } from 'react';
import ReaderText from '../components/ReaderText';
import type { Chapter, ChapterDetail, Entity } from '../types';

const READ_SIZE_KEY = 'docwriter.readingSize';
const MIN_READ = 15;
const MAX_READ = 26;
const DEFAULT_READ = 19;

export default function ReadView({
  chapters,
  entities,
  activeId,
  detail,
  editing,
  draft,
  setDraft,
  onSelect,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  onOpenEntity,
  onOpenCandidate,
  onAdd,
}: {
  chapters: Chapter[];
  entities: Entity[];
  activeId: number | null;
  detail: ChapterDetail | null;
  editing: boolean;
  draft: string;
  setDraft: (s: string) => void;
  onSelect: (id: number) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => Promise<void>;
  onDelete: (renumber: boolean) => Promise<void>;
  onOpenEntity: (id: number) => void;
  onOpenCandidate: (id: number) => void;
  onAdd: () => void;
}) {
  const [showDelete, setShowDelete] = useState(false);
  const [renumber, setRenumber] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    try {
      const v = Number(localStorage.getItem('docwriter.readingSize'));
      if (v >= MIN_READ && v <= MAX_READ) return v;
    } catch {}
    return DEFAULT_READ;
  });

  useEffect(() => {
    document.documentElement.style.setProperty('--text-reading', `${fontSize}px`);
    try {
      localStorage.setItem('docwriter.readingSize', String(fontSize));
    } catch {}
  }, [fontSize]);

  if (chapters.length === 0) {
    return (
      <div className="main-inner">
        <div className="empty-state">
          No chapters yet.
          <div style={{ marginTop: 16 }}>
            <button className="primary" onClick={onAdd}>
              Paste your first chapter
            </button>
          </div>
        </div>
      </div>
    );
  }

  const idx = chapters.findIndex((c) => c.id === activeId);
  const chapter = detail?.chapter;

  return (
    <div className="main-inner">
      {chapter && (
        <>
          <div className="toolbar">
            <button disabled={idx <= 0} onClick={() => onSelect(chapters[idx - 1].id)}>
              ← Prev
            </button>
            <button disabled={idx >= chapters.length - 1} onClick={() => onSelect(chapters[idx + 1].id)}>
              Next →
            </button>
            <div style={{ flex: 1 }} />
            <button
              className="icon-btn"
              title="Smaller text"
              aria-label="Decrease text size"
              disabled={fontSize <= MIN_READ}
              onClick={() => setFontSize((s) => Math.max(MIN_READ, s - 1))}
            >
              A−
            </button>
            <button
              className="icon-btn"
              title="Larger text"
              aria-label="Increase text size"
              disabled={fontSize >= MAX_READ}
              onClick={() => setFontSize((s) => Math.min(MAX_READ, s + 1))}
            >
              A+
            </button>
            {!editing ? (
              <>
                <button onClick={onEdit}>Edit</button>
                <button className="danger" onClick={() => setShowDelete(true)}>
                  Delete chapter
                </button>
              </>
            ) : (
              <>
                <button onClick={onCancel}>Cancel</button>
                <button
                  className="primary"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await onSave();
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? 'Saving & scanning…' : 'Save & rescan'}
                </button>
              </>
            )}
          </div>

          {editing ? (
            <textarea
              className="editor-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck
            />
          ) : (
            <div className="paper">
              <div className="paper-inner">
                <div className="paper-head">
                  <div className="paper-meta">
                    <span className="label-mono">
                      {chapter.number ? `Chapter ${chapter.number}` : 'Chapter'}
                    </span>
                    <span className="progress">{chapter.word_count} words</span>
                  </div>
                  {chapter.title ? <h1 className="paper-title">{chapter.title}</h1> : null}
                </div>
                <ReaderText
                  text={detail!.text}
                  mentions={detail!.mentions}
                  candidates={detail!.candidates}
                  entities={entities}
                  onMention={onOpenEntity}
                  onUnknown={onOpenCandidate}
                />
              </div>
            </div>
          )}
        </>
      )}

      {showDelete && chapter && (
        <div className="overlay" onClick={() => setShowDelete(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Delete Chapter {chapter.number || ''}?</h2>
            </div>
            <div className="modal-body">
              <p>
                This removes the chapter, its text, and every mention, scan and alert that came from it.
                Character cards are kept; a card with no remaining appearances gets flagged in Review.
              </p>
              <div className="field">
                <label>Numbering</label>
                <label style={{ fontWeight: 400, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="radio" style={{ width: 'auto' }} checked={!renumber} onChange={() => setRenumber(false)} />
                  Keep the gap — later chapters keep their numbers
                </label>
                <label style={{ fontWeight: 400, display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <input type="radio" style={{ width: 'auto' }} checked={renumber} onChange={() => setRenumber(true)} />
                  Renumber — shift later chapters down
                </label>
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setShowDelete(false)}>Cancel</button>
              <button
                className="danger"
                onClick={async () => {
                  setShowDelete(false);
                  await onDelete(renumber);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
