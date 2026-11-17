import { useEffect, useRef, useState } from 'react';
import { desktop } from '../desktop';
import { keyLabel } from '../shortcuts';

type Props = {
  onOpenBook: () => void;
  onNewBook: () => void;
  onExportMarkdown: () => void;
  onExportBookFile: () => void;
  exporting: boolean;
};

/**
 * The book's own menu: the window-level actions that used to live in the menu
 * bar, now where the writer can see them. Opening or creating a book restarts
 * DocWriter, which the foot of the menu says out loud.
 */
export default function BookMenu({
  onOpenBook,
  onNewBook,
  onExportMarkdown,
  onExportBookFile,
  exporting,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const native = !!desktop();

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();
    const onPointerDown = (ev: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function close(returnFocus = false) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function choose(run: () => void) {
    close();
    run();
  }

  return (
    <div className="bookmenu" ref={wrapRef}>
      <button
        ref={buttonRef}
        className="bookmenu__btn"
        aria-label="Book"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape' && open) {
            ev.stopPropagation();
            close(true);
          }
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span>Book</span>
        <svg className="bookmenu__chev" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className="bookmenu__panel"
          role="menu"
          aria-label="Book"
          onKeyDown={(ev) => {
            if (ev.key !== 'Escape') return;
            ev.stopPropagation();
            close(true);
          }}
        >
          <button
            ref={firstItemRef}
            role="menuitem"
            className="bookmenu__row"
            disabled={!native}
            title={native ? undefined : 'Only in the desktop app'}
            onClick={() => choose(onOpenBook)}
          >
            <span>Open book…</span>
            <kbd className="kbd">{keyLabel('openBook')}</kbd>
          </button>
          <button
            role="menuitem"
            className="bookmenu__row"
            disabled={!native}
            title={native ? undefined : 'Only in the desktop app'}
            onClick={() => choose(onNewBook)}
          >
            <span>New book…</span>
            <kbd className="kbd">{keyLabel('newBook')}</kbd>
          </button>
          <div className="bookmenu__rule" role="separator" />
          <button role="menuitem" className="bookmenu__row" onClick={() => choose(onExportMarkdown)}>
            <span>Export as Markdown</span>
          </button>
          <button
            role="menuitem"
            className="bookmenu__row"
            disabled={exporting}
            onClick={() => choose(onExportBookFile)}
          >
            <span>{exporting ? 'Packing the book…' : 'Export book file (.db)'}</span>
          </button>
          <p className="bookmenu__note">
            A book is one file. Opening another restarts DocWriter on it.
          </p>
        </div>
      )}
    </div>
  );
}
