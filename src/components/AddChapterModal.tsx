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

  useEffect(() => {
    if (open) {
      setNumber('');
      setTitle('');
      setText('');
      setAfter('end');
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const cleanNumber = number.trim();
  const duplicate =
    cleanNumber !== '' &&
    chapters.some((c) => c.number.trim().toLowerCase() === cleanNumber.toLowerCase());

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Paste a chapter</h2>
          <span className="progress">{words} words</span>
        </div>
        <div className="modal-body">
          <div className="row">
            <div className="field" style={{ maxWidth: 140 }}>
              <label>Chapter number</label>
              <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 12" />
            </div>
            <div className="field">
              <label>Title (optional)</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Rain" />
            </div>
          </div>
          <div className="field">
            <label>Placement</label>
            <select value={after} onChange={(e) => setAfter(e.target.value)}>
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
            <label>Text — paste straight from Word</label>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your chapter here. Formatting is ignored; only the words matter."
              style={{ minHeight: '40vh' }}
            />
          </div>
        </div>
        <div className="modal-foot">
          <button onClick={onClose}>Cancel</button>
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
  );
}
