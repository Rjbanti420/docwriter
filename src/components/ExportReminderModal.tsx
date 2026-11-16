import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

/**
 * The once-a-period export nudge. It has no open/close props of its own: App
 * mounts it only while the book's reminder state says a period has run out.
 * "Later" settles that period; closing without choosing leaves the reminder
 * due, so a keypress the writer did not aim at it cannot dismiss the period.
 */
export default function ExportReminderModal({
  onExport,
  onLater,
  onClose,
  lastExportAt,
  today,
  nudge,
}: {
  /** Runs the export; resolves true when the file reached disk. */
  onExport: () => Promise<boolean>;
  onLater: () => void;
  /** Dismisses this launch's reminder without recording a decision. */
  onClose: () => void;
  /** YYYY-MM-DD of the last export, or null if the book was never exported. */
  lastExportAt: string | null;
  /** The server's local day. */
  today: string;
  nudge: string;
}) {
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // A modal that opens by itself must take the keyboard, or its buttons are
  // unreachable behind the page's own tab order. Focus the dialog itself: the
  // first Enter should read the question, not answer it.
  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  const trapTab = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== 'Tab' || !boxRef.current) return;
    const items = [...boxRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)')].filter(
      (el) => el.checkVisibility?.({ checkVisibilityCSS: true })
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  };

  const waited = lastExportAt
    ? Math.round((Date.parse(today) - Date.parse(lastExportAt)) / 86_400_000)
    : null;
  const lastLine =
    waited === null
      ? 'Not exported yet — this book has only ever lived on this machine.'
      : waited <= 0
        ? 'Last exported today.'
        : waited === 1
          ? 'Last exported yesterday.'
          : `Last exported ${waited} days ago.`;
  // "Later" settles this period, so name the period rather than a vague word.
  const laterLabel =
    nudge === 'weekly' ? 'Remind me next week' : nudge === 'monthly' ? 'Remind me next month' : 'Remind me tomorrow';

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-reminder-title"
        aria-describedby="export-reminder-body"
        tabIndex={-1}
        ref={boxRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className="modal-head">
          <h2 id="export-reminder-title">Ready to export?</h2>
          <button
            className="ghost"
            aria-label="Close reminder"
            title="Close for now — it will ask again on the next launch"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p id="export-reminder-body" style={{ marginTop: 0 }}>
            Save the whole book — every chapter, the Bible and Planning — as one Markdown file you can
            keep anywhere. Nothing leaves this machine.
          </p>
          <p className="progress" style={{ marginBottom: 0 }}>
            {lastLine}
          </p>
        </div>
        <div className="modal-foot">
          <button disabled={busy} onClick={onLater}>
            {laterLabel}
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
