import { useEffect, useState } from 'react';
import { chapterLabel } from '../chapters';
import type { Chapter } from '../types';

export default function AddChapterModal({
  open,
  chapters,
  onClose,
  onSubmit,
}: {
  open: boolean;
  chapters: Chapter[];
  onClose: () => void;
  onSubmit: (body: {
    number: string;
    title: string;
    text: string;
    afterChapterId: number | null;
  }) => Promise<void>;
}) {
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [after, setAfter] = useState('end');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (open) {
      setNumber('');
      setTitle('');
      setText('');
      setAfter('end');
      setBusy(false);
      setAsking(false);
    }
  }, [open]);

  // Returning from the discard question puts the caret back where the work is.
  useEffect(() => {
    if (open && !asking) document.getElementById('add-text')?.focus();
  }, [open, asking]);

  if (!open) return null;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const cleanNumber = number.trim();
  const duplicate =
    cleanNumber !== '' &&
    chapters.some((c) => c.number.trim().toLowerCase() === cleanNumber.toLowerCase());
  // The paste is the work: a stray backdrop click or Escape asks first. The
  // question is the app's own dialog, not a browser confirm, so "Keep editing"
  // is the focused choice and discarding is a deliberate second click.
  const dirty = cleanNumber !== '' || title.trim() !== '' || text.trim() !== '';
  const requestClose = () => {
    if (asking) return;
    if (dirty) setAsking(true);
    else onClose();
  };

  return (
    <>
      <div className="overlay" onClick={requestClose}>
        <div
          className="modal wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-chapter-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-head">
            <h2 id="add-chapter-title">Paste a chapter</h2>
            <span className="progress">{words} words</span>
            <button className="ghost" aria-label="Close" onClick={requestClose}>
              ✕
            </button>
          </div>
          <div className="modal-body">
            <div className="row">
              <div className="field" style={{ maxWidth: 160 }}>
                <label htmlFor="add-number">Chapter number (optional)</label>
                <input
                  id="add-number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="e.g. 12"
                />
              </div>
              <div className="field">
                <label htmlFor="add-title">Title (optional)</label>
                <input
                  id="add-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. The Rain"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="add-after">Placement</label>
              <select id="add-after" value={after} onChange={(e) => setAfter(e.target.value)}>
                <option value="end">At the end</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    After {chapterLabel(c)}
                  </option>
                ))}
              </select>
              {duplicate && (
                <p className="progress" style={{ color: 'var(--color-caution)' }}>
                  Chapter {cleanNumber} already exists. Numbers are labels; this one will share it.
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="add-text">Text (required) — paste straight from Word</label>
              <textarea
                id="add-text"
                autoFocus
                required
                aria-required="true"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste your chapter here. Formatting is ignored; only the words matter."
                style={{ minHeight: '40vh' }}
              />
            </div>
          </div>
          <div className="modal-foot">
            <button onClick={requestClose}>Cancel</button>
            <button
              className="primary"
              disabled={!text.trim() || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSubmit({
                    number,
                    title,
                    text,
                    afterChapterId: after === 'end' ? null : Number(after),
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Scanning…' : 'Add & scan'}
            </button>
          </div>
        </div>
      </div>

      {/* Escape reaches this too: App clicks the topmost .overlay, which here
          means "keep editing". */}
      {asking && (
        <div className="overlay" onClick={() => setAsking(false)}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="discard-chapter-title"
            aria-describedby="discard-chapter-body"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2 id="discard-chapter-title">Discard this chapter?</h2>
            </div>
            <div className="modal-body">
              <p id="discard-chapter-body" style={{ margin: 0 }}>
                Nothing is saved. The words you pasted cannot be recovered.
              </p>
            </div>
            <div className="modal-foot">
              <button autoFocus onClick={() => setAsking(false)}>
                Keep editing
              </button>
              <button className="danger" onClick={onClose}>
                Discard chapter
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
