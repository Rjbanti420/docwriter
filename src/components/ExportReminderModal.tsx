import { useState } from 'react';

/**
 * The once-a-period export nudge. It has no open/close props of its own: App
 * mounts it only while the book's reminder state says a period has run out, and
 * either button settles that — exporting, or "Later".
 */
export default function ExportReminderModal({
  onExport,
  onLater,
}: {
  /** Runs the export; resolves true when the file reached disk. */
  onExport: () => Promise<boolean>;
  onLater: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="overlay" onClick={onLater}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Ready for a backup copy?</h2>
        </div>
        <div className="modal-body">
          <p style={{ marginTop: 0 }}>
            Save the whole book — every chapter, the Bible and Planning — as one Markdown file you can
            keep anywhere. Nothing leaves this machine.
          </p>
        </div>
        <div className="modal-foot">
          <button disabled={busy} onClick={onLater}>
            Later
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onExport();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Exporting…' : 'Export as Markdown'}
          </button>
        </div>
      </div>
    </div>
  );
}
