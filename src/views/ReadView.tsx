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
  onSelect,
  onSave,
  onDelete,
  onDirtyChange,
  onReadingSizeChange,
  readingSize,
  onOpenEntity,
  onOpenCandidate,
  onAdd,
}: {
  chapters: Chapter[];
  entities: Entity[];
  activeId: number | null;
  detail: ChapterDetail | null;
  onSelect: (id: number) => void;
  onSave: (text: string) => Promise<void>;
  onDelete: (renumber: boolean) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onReadingSizeChange: (size: number) => void;
  readingSize: number | null;
  onOpenEntity: (id: number) => void;
  onOpenCandidate: (id: number) => void;
  onAdd: () => void;
}) {
  const [showDelete, setShowDelete] = useState(false);
  const [renumber, setRenumber] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [copied, setCopied] = useState(false);
  // The editor owns the text it is showing. App is told only whether it is
  // dirty, so a chapter change cannot quietly overwrite what was typed.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    try {
      const v = Number(localStorage.getItem('docwriter.readingSize'));
      if (v >= MIN_READ && v <= MAX_READ) return v;
    } catch {}
    return DEFAULT_READ;
  });

  useEffect(() => {
    if (!editing) setDraft(detail?.text ?? '');
  }, [detail?.text, editing]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const changeReadingSize = (next: number) => {
    setFontSize(next);
    onReadingSizeChange(next);
  };

  const startEdit = () => {
    setDraft(detail?.text ?? '');
    setDirty(false);
    setSaveError('');
    setCopied(false);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(detail?.text ?? '');
    setDirty(false);
    setSaveError('');
    setCopied(false);
    setEditing(false);
  };

  const saveDraft = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave(draft);
      setDirty(false);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setSaveError('Could not copy automatically. Select the draft text and copy it manually.');
    }
  };

  useEffect(() => {
    if (!editing) return;
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        if (!saving) void saveDraft();
        return;
      }
      if (ev.key !== 'Escape' || saving) return;
      // Let App close a modal first; Escape in the editor only leaves the editor.
      if (document.querySelector('.overlay')) return;
      if (dirty && !confirm('Discard unsaved changes?')) return;
      cancelEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, saving, draft, dirty, onSave]);

  useEffect(() => {
    document.documentElement.style.setProperty('--text-reading', `${fontSize}px`);
    try {
      localStorage.setItem('docwriter.readingSize', String(fontSize));
    } catch {}
  }, [fontSize]);

  // The book's saved size arrives after the first render; adopt it unless the
  // writer has already picked another.
  useEffect(() => {
    if (readingSize == null || readingSize < MIN_READ || readingSize > MAX_READ) return;
    setFontSize((current) => (current === DEFAULT_READ ? readingSize : current));
  }, [readingSize]);

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
            <button
              disabled={idx <= 0 || saving}
              aria-keyshortcuts="Alt+ArrowLeft"
              title="Previous chapter (Alt+←)"
              onClick={() => onSelect(chapters[idx - 1].id)}
            >
              ← Prev
            </button>
            <button
              disabled={idx >= chapters.length - 1 || saving}
              aria-keyshortcuts="Alt+ArrowRight"
              title="Next chapter (Alt+→)"
              onClick={() => onSelect(chapters[idx + 1].id)}
            >
              Next →
            </button>
            <div style={{ flex: 1 }} />
            <button
              className="icon-btn"
              title="Smaller text"
              aria-label="Decrease text size"
              disabled={fontSize <= MIN_READ}
              onClick={() => changeReadingSize(Math.max(MIN_READ, fontSize - 1))}
            >
              A−
            </button>
            <button
              className="icon-btn"
              title="Larger text"
              aria-label="Increase text size"
              disabled={fontSize >= MAX_READ}
              onClick={() => changeReadingSize(Math.min(MAX_READ, fontSize + 1))}
            >
              A+
            </button>
            {!editing ? (
              <>
                <button onClick={startEdit}>Edit</button>
                <button className="danger" onClick={() => setShowDelete(true)}>
                  Delete chapter
                </button>
              </>
            ) : (
              <>
                <button onClick={cancelEdit}>Cancel</button>
                <button
                  className="primary"
                  disabled={saving}
                  aria-keyshortcuts="Control+S Meta+S"
                  title="Save now (Ctrl+S). The scan continues in the background."
                  onClick={saveDraft}
                >
                  {saving ? 'Saving…' : 'Save & rescan'}
                </button>
              </>
            )}
          </div>

          {saveError && (
            <div className="save-error" role="alert" title={saveError}>
              <div>
                <strong>Couldn’t save this chapter.</strong> Your draft is still here.
              </div>
              <button onClick={saveDraft} disabled={saving}>
                Retry save
              </button>
              <button onClick={copyDraft}>{copied ? 'Copied' : 'Copy draft'}</button>
            </div>
          )}

          {editing ? (
            <textarea
              className="editor-textarea"
              value={draft}
              readOnly={saving}
              onChange={(e) => {
                const next = e.target.value;
                setDraft(next);
                setDirty(next !== (detail?.text ?? ''));
              }}
              spellCheck
            />
          ) : (
            <div className="paper" key={chapter.id}>
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
                Character cards are kept; a card with no remaining appearances moves to Review → Trash,
                where you can restore it.
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
