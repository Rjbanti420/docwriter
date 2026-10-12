import { useEffect, useState } from 'react';

export default function AddChapterModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: { number: string; title: string; text: string }) => Promise<void>;
}) {
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setNumber('');
      setTitle('');
      setText('');
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

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
                await onSubmit({ number, title, text });
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
