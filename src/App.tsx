import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { askNameConflict } from './nameConflict';
import type { Candidate, Chapter, ChapterDetail, Entity, ExportMeta, IgnoredToken, ReviewData, Type, View } from './types';
import AddChapterModal from './components/AddChapterModal';
import TriageModal from './components/TriageModal';
import ExportReminderModal from './components/ExportReminderModal';
import EntityPanel from './components/EntityPanel';
import SearchBox from './components/SearchBox';
import ReadView from './views/ReadView';
import ReviewView from './views/ReviewView';
import BibleView from './views/BibleView';
import PlanningView from './views/PlanningView';
import TimelineView from './views/TimelineView';
import SettingsView from './views/SettingsView';

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

export default function App() {
  const [types, setTypes] = useState<Type[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [review, setReview] = useState<ReviewData>({ pending: [], alerts: [] });
  const [ignored, setIgnored] = useState<IgnoredToken[]>([]);
  const [trash, setTrash] = useState<Entity[]>([]);
  const [view, setView] = useState<View>('read');
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ChapterDetail | null>(null);
  const [dirty, setDirty] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [triage, setTriage] = useState<{ items: Candidate[]; index: number } | null>(null);
  const [entityId, setEntityId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [planningFocus, setPlanningFocus] = useState<number | null>(null);
  const [meta, setMeta] = useState<ExportMeta | null>(null);
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [scanError, setScanError] = useState<{ id: number; message: string } | null>(null);
  // One reminder per launch, not one per re-render or per refresh.
  const nudged = useRef(false);
  // A save can outlive the view: only paint its result if the writer is still
  // on that chapter.
  const activeIdRef = useRef<number | null>(null);
  // Chapter reads can finish out of order; only the newest one may paint.
  const loadSeq = useRef(0);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // The export reminder: the book knows when it was last exported or dismissed,
  // so the check is the same on every machine and survives a relaunch.
  useEffect(() => {
    if (meta?.due && !nudged.current) {
      nudged.current = true;
      setNudgeOpen(true);
    }
  }, [meta]);

  const exportBook = useCallback(async (): Promise<boolean> => {
    try {
      // api.exportMarkdown stamps the export date itself, but only once the file
      // is really on disk — a cancelled save dialog is not an export.
      const saved = await api.exportMarkdown();
      if (saved) {
        setMeta(await api.meta());
        setNudgeOpen(false);
      }
      return saved;
    } catch {
      alert('Could not write the export.');
      return false;
    }
  }, []);

  const laterNudge = useCallback(async () => {
    setNudgeOpen(false);
    try {
      // Dismissing satisfies this period as well, or the next launch asks again.
      if (meta) setMeta(await api.setMeta({ last_nudged_on: meta.today }));
    } catch {
      /* already closed; the reminder simply comes back next launch */
    }
  }, [meta]);

  // ReadView owns the draft; App only needs to know whether leaving would throw
  // away typing, so every navigation path asks the same question.
  const confirmDiscard = useCallback(() => {
    if (!dirty) return true;
    if (!confirm('You have unsaved changes. Discard them?')) return false;
    setDirty(false);
    return true;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const go = (v: View) => {
    if (v !== 'read' && !confirmDiscard()) return;
    setView(v);
    setSettingsOpen(false);
    setMenuOpen(false);
    setEntityId(null);
  };

  const topTitle = settingsOpen
    ? 'Profile / Settings'
    : view === 'read'
      ? detail?.chapter
        ? [detail.chapter.number && `Chapter ${detail.chapter.number}`, detail.chapter.title]
            .filter(Boolean)
            .join(' · ') || 'Read'
        : 'Read'
      : view === 'review'
        ? 'Review'
        : view === 'planning'
          ? 'Planning'
          : view === 'timeline'
            ? 'Timeline'
            : 'The Bible';

  const loadChapters = useCallback(async () => setChapters(await api.chapters()), []);
  const loadEntities = useCallback(async () => setEntities(await api.entities()), []);
  const loadReview = useCallback(async () => setReview(await api.review()), []);
  const loadIgnored = useCallback(async () => setIgnored(await api.ignored()), []);
  const loadTrash = useCallback(async () => setTrash(await api.trash()), []);

  const loadChapter = useCallback(async (id: number) => {
    const seq = ++loadSeq.current;
    const d: ChapterDetail = await api.chapter(id);
    if (seq !== loadSeq.current) return;
    setDetail(d);
  }, []);

  // Any non-load writer (save, add, triage) invalidates a chapter read that is
  // still in flight, so a slow reply cannot overwrite fresher content.
  const writeDetail = useCallback((d: ChapterDetail | null) => {
    loadSeq.current += 1;
    setDetail(d);
  }, []);

  // Survives an Electron relaunch, which resets localStorage. Writes are queued
  // so two fast clicks cannot land in reverse order and save the older chapter.
  const metaWrite = useRef<Promise<unknown>>(Promise.resolve());
  const rememberChapter = useCallback((id: number | null) => {
    const value = id == null ? '' : String(id);
    metaWrite.current = metaWrite.current
      .then(() => api.setMeta({ last_chapter: value }))
      .then((m) => setMeta(m))
      .catch(() => {
        /* the next selection tries again */
      });
  }, []);

  useEffect(() => {
    (async () => {
      const [t, ch, en, rv, ig, tr, md] = await Promise.all([
        api.types(),
        api.chapters(),
        api.entities(),
        api.review(),
        api.ignored(),
        api.trash(),
        api.meta(),
      ]);
      setTypes(t);
      setChapters(ch);
      setEntities(en);
      setReview(rv);
      setIgnored(ig);
      setTrash(tr);
      setMeta(md);
      const pick = ch.find((c: Chapter) => c.id === md.last_chapter) ?? ch[0];
      if (pick) {
        setActiveId(pick.id);
        await loadChapter(pick.id);
      }
    })();
  }, [loadChapter]);

  const refresh = useCallback(async () => {
    await Promise.all([loadChapters(), loadEntities(), loadReview(), loadIgnored(), loadTrash()]);
  }, [loadChapters, loadEntities, loadReview, loadIgnored, loadTrash]);

  const selectChapter = useCallback(
    async (id: number) => {
      if (id !== activeId && !confirmDiscard()) return;
      setView('read');
      setActiveId(id);
      rememberChapter(id);
      await loadChapter(id);
    },
    [activeId, confirmDiscard, loadChapter, rememberChapter]
  );

  const openSearchChapter = useCallback(
    (id: number) => {
      setSettingsOpen(false);
      setMenuOpen(false);
      setEntityId(null);
      selectChapter(id);
    },
    [selectChapter]
  );

  const openSearchEntity = useCallback((id: number) => {
    setEntityId(id);
  }, []);

  const openTriage = (items: Candidate[]) => {
    if (items.length) setTriage({ items, index: 0 });
  };

  const resolveCandidate = useCallback(
    async (c: Candidate, action: string, extra?: Record<string, unknown>) => {
      let payload: Record<string, unknown> = { action, ...extra };
      let applied = action;
      for (;;) {
        try {
          await api.resolve(c.id, payload);
          break;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409 || action !== 'accept') throw error;
          const existingId = Number((error.body as { entityId?: number } | null)?.entityId);
          const choice = askNameConflict(String(payload.name ?? c.surface_text), existingId);
          if (!choice) return;
          if ('useExisting' in choice) {
            await api.resolve(c.id, { action: 'merge', entityId: existingId });
            applied = 'merge';
            break;
          }
          payload = { ...payload, name: choice.name };
        }
      }
      // Only reload what this action can change: an ignore edits the rejected
      // words and chapter badges, accepting or merging edits cards as well.
      const loads: Array<Promise<unknown>> = [loadChapters(), loadReview()];
      if (applied === 'accept' || applied === 'merge') loads.push(loadEntities());
      if (applied === 'ignore') loads.push(loadIgnored());
      await Promise.all(loads);
      if (detail && detail.chapter.id === c.chapter_id) {
        const d: ChapterDetail = await api.chapter(c.chapter_id);
        writeDetail(d);
      }
      setTriage((t) => {
        if (!t) return t;
        const items = t.items.filter((x) => x.id !== c.id);
        if (items.length === 0) return null;
        return { items, index: Math.min(t.index, items.length - 1) };
      });
    },
    [loadChapters, loadReview, loadEntities, loadIgnored, detail, writeDetail]
  );

  // Bulk triage from Review: one request and one refresh for the whole selection.
  const resolveMany = useCallback(
    async (ids: number[], action: string) => {
      await api.resolveMany(ids, action);
      const loads: Array<Promise<unknown>> = [loadChapters(), loadReview()];
      if (action === 'ignore') loads.push(loadIgnored());
      await Promise.all(loads);
      if (detail) writeDetail(await api.chapter(detail.chapter.id));
    },
    [loadChapters, loadReview, loadIgnored, detail, writeDetail]
  );

  // Review ships the first 100 rows of each tier; Show more appends the next page.
  const loadMoreCandidates = useCallback(
    async (tier: 'primary' | 'demoted') => {
      const offset = review.pending.filter((c) => (c.tier === 'demoted') === (tier === 'demoted')).length;
      const res: { pending: Candidate[]; total: number; hasMore: boolean } = await api.reviewPending(tier, offset);
      setReview((prev) => {
        if (!prev) return prev;
        const seen = new Set(prev.pending.map((c) => c.id));
        const totals = prev.pendingTotals ?? { primary: 0, demoted: 0 };
        const hasMore = prev.pendingHasMore ?? { primary: false, demoted: false };
        return {
          ...prev,
          pending: [...prev.pending, ...res.pending.filter((c) => !seen.has(c.id))],
          pendingTotals: { ...totals, [tier]: res.total },
          pendingHasMore: { ...hasMore, [tier]: res.hasMore },
        };
      });
    },
    [review.pending]
  );

  const addChapter = useCallback(
    async (body: {
      number: string;
      title: string;
      text: string;
      afterChapterId?: number | null;
    }) => {
      const res = await api.addChapter(body);
      await refresh();
      setAddOpen(false);
      setActiveId(res.chapter.id);
      rememberChapter(res.chapter.id);
      const d: ChapterDetail = await api.chapter(res.chapter.id);
      writeDetail(d);
      setView('read');
      const rv: ReviewData = await api.review();
      setReview(rv);
      openTriage(rv.pending.filter((c) => c.chapter_id === res.chapter.id && c.tier !== 'demoted'));
    },
    [refresh, rememberChapter, writeDetail]
  );

  // The text was already committed by saveChapter; this second request fills in
  // mentions, candidates and alerts without holding the editor open.
  const rescanChapter = useCallback(
    async (id: number) => {
      setScanError(null);
      try {
        await api.scanChapter(id);
        await refresh();
        const d: ChapterDetail = await api.chapter(id);
        const rv: ReviewData = await api.review();
        setReview(rv);
        if (activeIdRef.current !== id) return;
        writeDetail(d);
        openTriage(rv.pending.filter((c) => c.chapter_id === id && c.tier !== 'demoted'));
      } catch (err) {
        setScanError({
          id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [refresh, writeDetail]
  );

  const saveChapter = useCallback(
    async (text: string) => {
      const id = activeId;
      if (!id) return;
      // Save the text first. A failed request leaves the editor and draft intact
      // so ReadView can show the retry banner.
      const saved = await api.saveChapterText(id, { text });
      if (activeIdRef.current === id) {
        if (detail?.chapter.id === id) {
          // Underlines and candidates belong to the old revision; clear them
          // until the scan returns rather than painting stale offsets.
          writeDetail({ chapter: saved.chapter, text, mentions: [], candidates: [] });
        }
      }
      void rescanChapter(id);
    },
    [activeId, detail, rescanChapter, writeDetail]
  );

  const deleteChapter = useCallback(
    async (renumber: boolean) => {
      if (!activeId) return;
      const idx = chapters.findIndex((c) => c.id === activeId);
      await api.deleteChapter(activeId, renumber);
      await refresh();
      const ch: Chapter[] = await api.chapters();
      setChapters(ch);
      if (ch.length) {
        const next = ch[Math.min(Math.max(idx - 1, 0), ch.length - 1)];
        setActiveId(next.id);
        rememberChapter(next.id);
        await loadChapter(next.id);
      } else {
        setActiveId(null);
        rememberChapter(null);
        writeDetail(null);
      }
    },
    [activeId, chapters, refresh, loadChapter, rememberChapter, writeDetail]
  );

  const openCandidate = useCallback(
    async (candidateId: number) => {
      const idx = review.pending.findIndex((c) => c.id === candidateId);
      if (idx >= 0) {
        setTriage({ items: review.pending, index: idx });
        return;
      }
      // The row may sit past the 100-per-tier page; fetch it directly rather
      // than silently doing nothing when a underline is clicked.
      try {
        const candidate: Candidate = await api.candidate(candidateId);
        setTriage({ items: [candidate], index: 0 });
      } catch {
        /* already resolved or deleted */
      }
    },
    [review.pending]
  );

  const setAlertState = useCallback(
    async (id: number, state: string) => {
      await api.setAlertState(id, state);
      await loadReview();
    },
    [loadReview]
  );

  const unignore = useCallback(
    async (id: number) => {
      await api.unignore(id);
      await refresh();
    },
    [refresh]
  );

  const restore = useCallback(
    async (id: number) => {
      await api.restore(id);
      await refresh();
    },
    [refresh]
  );

  const deleteForever = useCallback(
    async (id: number) => {
      await api.deleteEntity(id);
      await refresh();
    },
    [refresh]
  );

  // One keyboard layer for the paths used constantly: quick-open, chapter
  // movement while reading, and Escape for whatever is on top.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        if (document.querySelector('.overlay')) return;
        const input = document.querySelector<HTMLInputElement>('.search input');
        if (!input) return;
        input.focus();
        input.select();
        return;
      }

      if (ev.key === 'Escape') {
        const overlays = document.querySelectorAll<HTMLElement>('.overlay');
        const top = overlays[overlays.length - 1];
        if (top) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          top.click();
          return;
        }
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (active?.closest('.search')) {
          ev.stopImmediatePropagation();
          active.blur();
          return;
        }
        if (settingsOpen) {
          ev.stopImmediatePropagation();
          setSettingsOpen(false);
          return;
        }
        if (menuOpen) {
          ev.stopImmediatePropagation();
          setMenuOpen(false);
          return;
        }
        if (entityId != null) {
          ev.stopImmediatePropagation();
          setEntityId(null);
        }
        return;
      }

      if (ev.altKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
        if (isTypingTarget(ev.target)) return;
        ev.preventDefault();
        if (document.querySelector('.overlay')) return;
        const idx = chapters.findIndex((c) => c.id === activeId);
        if (idx < 0) return;
        const next = ev.key === 'ArrowLeft' ? idx - 1 : idx + 1;
        if (!chapters[next]) return;
        selectChapter(chapters[next].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chapters, activeId, selectChapter, settingsOpen, menuOpen, entityId]);

  const pendingCount = review.pendingTotals
    ? review.pendingTotals.primary + review.pendingTotals.demoted
    : review.pending.length;
  const reviewBadge = pendingCount + review.alerts.filter((a) => a.state === 'unread').length;

  return (
    <div className={`app${menuOpen ? ' menu-open' : ''}`}>
      <button
        className="menu-btn"
        aria-label="Toggle menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <span className="menu-icon" />
      </button>
      <div
        className={`dw-scrim${menuOpen ? ' is-open' : ''}`}
        onClick={() => setMenuOpen(false)}
      />
      <aside className={`dw-sidebar${menuOpen ? ' is-open' : ''}`} aria-label="Sidebar">
        <div className="dw-sidebar__top">
          <button
            className="dw-icon-btn"
            aria-label="Close sidebar"
            onClick={() => setMenuOpen(false)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <nav className="dw-nav" aria-label="Main">
          <button
            className={`dw-nav__item${!settingsOpen && view === 'read' ? ' is-active' : ''}`}
            aria-current={!settingsOpen && view === 'read' ? 'page' : undefined}
            onClick={() => go('read')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            <span>Read</span>
          </button>
          <button
            className={`dw-nav__item${!settingsOpen && view === 'review' ? ' is-active' : ''}`}
            aria-current={!settingsOpen && view === 'review' ? 'page' : undefined}
            onClick={() => go('review')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="8" y="2" width="8" height="4" rx="1" />
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <path d="M12 11h4" />
              <path d="M12 16h4" />
              <path d="M8 11h.01" />
              <path d="M8 16h.01" />
            </svg>
            <span>Review</span>
            {reviewBadge > 0 && <span className="badge">{reviewBadge}</span>}
          </button>
          <button
            className={`dw-nav__item${!settingsOpen && view === 'planning' ? ' is-active' : ''}`}
            aria-current={!settingsOpen && view === 'planning' ? 'page' : undefined}
            onClick={() => go('planning')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 2v4" />
              <path d="M12 18v4" />
              <path d="M2 12h4" />
              <path d="M18 12h4" />
            </svg>
            <span>Planning</span>
          </button>
          <button
            className={`dw-nav__item${!settingsOpen && view === 'timeline' ? ' is-active' : ''}`}
            aria-current={!settingsOpen && view === 'timeline' ? 'page' : undefined}
            onClick={() => go('timeline')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 3v18" />
              <circle cx="5" cy="7" r="2" />
              <circle cx="5" cy="17" r="2" />
              <path d="M9 7h10" />
              <path d="M9 17h10" />
            </svg>
            <span>Timeline</span>
          </button>
          <button
            className={`dw-nav__item${!settingsOpen && view === 'bible' ? ' is-active' : ''}`}
            aria-current={!settingsOpen && view === 'bible' ? 'page' : undefined}
            onClick={() => go('bible')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <span>Bible</span>
          </button>
        </nav>

        <hr className="dw-sidebar__rule" />

        <div className="dw-section">
          <span className="dw-section__label">Chapters</span>
          <button
            className="dw-icon-btn dw-icon-btn--ghost"
            aria-label="New chapter"
            title="Paste a chapter"
            onClick={() => {
              if (confirmDiscard()) setAddOpen(true);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
          </button>
        </div>

        <div className="dw-chapters">
          {chapters.length === 0 && <div className="empty">No chapters yet.</div>}
          {chapters.map((c) => (
            <button
              key={c.id}
              className={`dw-chapter${c.id === activeId ? ' is-active' : ''}`}
              aria-current={c.id === activeId ? 'page' : undefined}
              onClick={() => {
                selectChapter(c.id);
                setMenuOpen(false);
                setSettingsOpen(false);
              }}
            >
              <span className="dw-chapter__num">{c.number || '·'}</span>
              <span className="dw-chapter__title">{c.title || `Chapter ${c.number || ''}`.trim()}</span>
              {c.candidate_count ? <span className="cnt">{c.candidate_count} new</span> : null}
            </button>
          ))}
        </div>

        <div className="dw-sidebar__foot">
          <button
            className={`dw-nav__item${settingsOpen ? ' is-active' : ''}`}
            aria-current={settingsOpen ? 'page' : undefined}
            onClick={() => {
              if (!confirmDiscard()) return;
              setSettingsOpen(true);
              setMenuOpen(false);
              setEntityId(null);
            }}
            title="Profile / Settings"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <line x1="21" y1="4" x2="14" y2="4" />
              <line x1="10" y1="4" x2="3" y2="4" />
              <line x1="21" y1="12" x2="12" y2="12" />
              <line x1="8" y1="12" x2="3" y2="12" />
              <line x1="21" y1="20" x2="16" y2="20" />
              <line x1="12" y1="20" x2="3" y2="20" />
              <line x1="14" y1="2" x2="14" y2="6" />
              <line x1="8" y1="10" x2="8" y2="14" />
              <line x1="16" y1="18" x2="16" y2="22" />
            </svg>
            <span>Settings</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumbs">
            <strong>{topTitle}</strong>
          </div>
          <SearchBox
            chapters={chapters}
            entities={entities}
            onOpenChapter={openSearchChapter}
            onOpenEntity={openSearchEntity}
          />
        </header>
        <div className="body">
          <div className="content">
        {settingsOpen ? (
          <SettingsView onClose={() => setSettingsOpen(false)} />
        ) : (
          <>
        {view === 'read' &&
          (activeId && !detail ? (
            <div className="main-inner">
              <div className="empty-state">Loading…</div>
            </div>
          ) : (
            <ReadView
              key={activeId ?? 'none'}
              chapters={chapters}
              entities={entities}
              activeId={activeId}
              detail={detail}
              onSelect={selectChapter}
              onSave={saveChapter}
              onDelete={deleteChapter}
              onDirtyChange={setDirty}
              onOpenEntity={(id) => setEntityId(id)}
              onOpenCandidate={openCandidate}
              onAdd={() => setAddOpen(true)}
            />
          ))}

        {view === 'review' && (
          <ReviewView
            review={review}
            types={types}
            ignored={ignored}
            trash={trash}
            onResolve={resolveCandidate}
            onResolveMany={resolveMany}
            onLoadMore={loadMoreCandidates}
            onAlertState={setAlertState}
            onOpenEntity={(id) => setEntityId(id)}
            onOpenGun={(id) => {
              setPlanningFocus(id);
              go('planning');
            }}
            onTriageAll={() =>
              setTriage({ items: review.pending.filter((c) => c.tier !== 'demoted'), index: 0 })
            }
            onUnignore={unignore}
            onRestore={restore}
            onDeleteForever={deleteForever}
          />
        )}

        {view === 'planning' && (
          <PlanningView
            chapters={chapters}
            entities={entities}
            types={types}
            onChanged={refresh}
            focusGunId={planningFocus}
            onClearFocus={() => setPlanningFocus(null)}
            onOpenEntity={(id) => setEntityId(id)}
          />
        )}

        {view === 'timeline' && (
          <TimelineView
            chapters={chapters}
            entities={entities}
            onOpenChapter={selectChapter}
            onOpenEntity={(id) => setEntityId(id)}
            onOpenGun={(id) => {
              setPlanningFocus(id);
              go('planning');
            }}
          />
        )}

        {view === 'bible' && (
          <BibleView
            entities={entities}
            chapters={chapters}
            types={types}
            onOpenEntity={(id) => setEntityId(id)}
            onChanged={refresh}
          />
        )}
          </>
        )}
          </div>

        </div>
      </main>

      {entityId != null && (
        <EntityPanel
          entityId={entityId}
          entities={entities}
          chapters={chapters}
          types={types}
          onClose={() => setEntityId(null)}
          onChanged={refresh}
          onOpenChapter={(cid) => {
            setEntityId(null);
            selectChapter(cid);
          }}
          onOpenEntity={(id) => setEntityId(id)}
        />
      )}

      <AddChapterModal
        open={addOpen}
        chapters={chapters}
        onClose={() => setAddOpen(false)}
        onSubmit={addChapter}
      />

      {nudgeOpen && <ExportReminderModal onExport={exportBook} onLater={laterNudge} />}

      {triage && (
        <TriageModal
          items={triage.items}
          index={triage.index}
          types={types}
          onResolve={resolveCandidate}
          onNavigate={(i) => setTriage((t) => (t ? { ...t, index: i } : t))}
          onClose={() => setTriage(null)}
        />
      )}

      {scanError && (
        <div className="app-alert" role="alert" title={scanError.message}>
          <div>
            <strong>Text saved.</strong> The rescan failed, so mentions may be out of date.
          </div>
          <button onClick={() => rescanChapter(scanError.id)}>Retry scan</button>
          <button className="ghost" onClick={() => setScanError(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
