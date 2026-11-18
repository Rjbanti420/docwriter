import { useEffect, useRef, useState } from 'react';
import ReaderText from '../components/ReaderText';
import { chapterNumber } from '../chapters';
import type { Chapter, ChapterDetail, Entity } from '../types';
import { bindings, matchesAccelerator } from '../shortcuts';

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
  focusEntity,
  onOpenEntity,
  onOpenCandidate,
  onAdd,
  onSample,
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
  /** Entity whose mentions should be highlighted when the chapter opens. */
  focusEntity?: number | null;
  onOpenEntity: (id: number) => void;
  onOpenCandidate: (id: number) => void;
  onAdd: () => void;
  /** Adds the bundled sample chapter, so a blank book can show the loop. */
  onSample: () => Promise<void>;
}) {
  const [showDelete, setShowDelete] = useState(false);
  const [renumber, setRenumber] = useState(false);
  const cancelDeleteRef = useRef<HTMLButtonElement | null>(null);
  const deleteReturnRef = useRef<HTMLElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [copied, setCopied] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleError, setSampleError] = useState('');
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

  // A dialog that takes focus and gives it back, so a mis-click is recoverable.
  const openDelete = () => {
    deleteReturnRef.current = document.activeElement as HTMLElement | null;
    setShowDelete(true);
  };

  const closeDelete = () => {
    setShowDelete(false);
    deleteReturnRef.current?.focus();
    deleteReturnRef.current = null;
  };

  useEffect(() => {
    if (showDelete) cancelDeleteRef.current?.focus();
  }, [showDelete]);

  // The chapter is long enough that the scrollbar is not a position. A hairline
  // at the window edge tracks it without taking a single line of reading room.
  useEffect(() => {
    const scroller = progressRef.current?.closest('.main');
    if (!scroller) return;
    const update = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      const ratio = max > 0 ? scroller.scrollTop / max : 0;
      progressRef.current?.style.setProperty('--reading-progress', String(ratio));
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      scroller.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [detail?.chapter?.id, detail?.text]);

  const toTop = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Zero, not the paper: scrollIntoView would tuck the chapter head under the
    // sticky topbar. The toolbar belongs at the top of the chapter too.
    progressRef.current
      ?.closest('.main')
      ?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    if (!editing) return;
    const onKey = (ev: KeyboardEvent) => {
      if (matchesAccelerator(ev, bindings().saveChapter)) {
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
          No chapters yet. Paste a chapter from your draft — or start with a sample and see
          what the app does with it.
          <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="primary" onClick={onAdd}>
              Paste your first chapter
            </button>
            <button
              className="btn-secondary"
              disabled={sampleBusy}
              onClick={async () => {
                setSampleBusy(true);
                setSampleError('');
                try {
                  await onSample();
                } catch {
                  setSampleError('Could not add the sample chapter.');
                } finally {
                  setSampleBusy(false);
                }
              }}
            >
              {sampleBusy ? 'Adding…' : 'Try a sample chapter'}
            </button>
          </div>
          {sampleError && (
            <p className="card-note" role="alert" style={{ marginTop: 12 }}>
              {sampleError}
            </p>
          )}
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
          <div className="reading-progress" ref={progressRef} aria-hidden="true" />
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
                {/* Destructive, but not the loudest thing on a reading page. */}
                <button className="danger-quiet" onClick={openDelete}>
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

          <div className="paper" key={chapter.id}>
            <div className="paper-inner">
              <div className="paper-head">
                <div className="paper-meta">
                  {/* An untitled chapter still needs the page's only h1, and the
                      kicker is already the line the reader sees there. */}
                  {chapter.title ? (
                    <span className="label-mono">Chapter {chapterNumber(chapter)}</span>
                  ) : (
                    <h1 className="label-mono">Chapter {chapterNumber(chapter)}</h1>
                  )}
                  <span className="progress">{chapter.word_count.toLocaleString('en-US')} words</span>
                </div>
                {chapter.title ? <h1 className="paper-title">{chapter.title}</h1> : null}
                {detail!.candidates.length > 0 ? (
                  // Kept in the layout while editing so the prose does not jump
                  // a line when Edit is pressed.
                  <p
                    className={`mark-legend${editing ? ' is-hidden' : ''}`}
                    aria-hidden={editing || undefined}
                  >
                    Solid underlines are names in your Bible. Dotted ones are new — open one to add it.
                  </p>
                ) : null}
              </div>
              {editing ? (
                <textarea
                  className="editor-textarea"
                  aria-label={`Chapter ${chapterNumber(chapter)} text`}
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
                <ReaderText
                  text={detail!.text}
                  mentions={detail!.mentions}
                  candidates={detail!.candidates}
                  entities={entities}
                  focusEntityId={focusEntity}
                  onMention={onOpenEntity}
                  onUnknown={onOpenCandidate}
                />
              )}
              {!editing && (
                <div className="chapter-end">
                  <span>End of Chapter {chapterNumber(chapter)}</span>
                  {idx >= chapters.length - 1 ? (
                    <button onClick={toTop}>Back to top</button>
                  ) : (
                    <button onClick={() => onSelect(chapters[idx + 1].id)}>Next chapter →</button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {showDelete && chapter && (
        <div className="overlay" onClick={closeDelete}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-chapter-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(ev) => {
              if (ev.key !== 'Tab') return;
              const items = ev.currentTarget.querySelectorAll<HTMLElement>('button, input');
              const first = items[0];
              const last = items[items.length - 1];
              if (ev.shiftKey && document.activeElement === first) {
                ev.preventDefault();
                last.focus();
              } else if (!ev.shiftKey && document.activeElement === last) {
                ev.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="modal-head">
              <h2 id="delete-chapter-title">Delete Chapter {chapter.number || ''}?</h2>
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
              <button ref={cancelDeleteRef} onClick={closeDelete}>
                Cancel
              </button>
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
