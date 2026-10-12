import { useState } from 'react';
import ReaderText from '../components/ReaderText';
import type { Chapter, ChapterDetail } from '../types';

export default function ReadView({
  chapters,
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
          <div className="reader-head">
            <h1>
              {chapter.number ? `Chapter ${chapter.number}` : 'Chapter'}
              {chapter.title ? <small>{chapter.title}</small> : null}
            </h1>
            <span className="progress">{chapter.word_count} words</span>
          </div>

          <div className="toolbar">
            <button disabled={idx <= 0} onClick={() => onSelect(chapters[idx - 1].id)}>
              ← Prev
            </button>
            <button disabled={idx >= chapters.length - 1} onClick={() => onSelect(chapters[idx + 1].id)}>
              Next →
            </button>
            <div style={{ flex: 1 }} />
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
            <ReaderText
              text={detail!.text}
              mentions={detail!.mentions}
              candidates={detail!.candidates}
              onMention={onOpenEntity}
              onUnknown={onOpenCandidate}
            />
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
