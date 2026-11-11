import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
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
import SettingsView from './views/SettingsView';

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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [triage, setTriage] = useState<{ items: Candidate[]; index: number } | null>(null);
  const [entityId, setEntityId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [planningFocus, setPlanningFocus] = useState<number | null>(null);
  const [meta, setMeta] = useState<ExportMeta | null>(null);
  const [nudgeOpen, setNudgeOpen] = useState(false);
  // One reminder per launch, not one per re-render or per refresh.
  const nudged = useRef(false);

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

  const go = (v: View) => {
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
          : 'The Bible';

  const loadChapters = useCallback(async () => setChapters(await api.chapters()), []);
  const loadEntities = useCallback(async () => setEntities(await api.entities()), []);
  const loadReview = useCallback(async () => setReview(await api.review()), []);
  const loadIgnored = useCallback(async () => setIgnored(await api.ignored()), []);
  const loadTrash = useCallback(async () => setTrash(await api.trash()), []);

  const loadChapter = useCallback(async (id: number) => {
    const d: ChapterDetail = await api.chapter(id);
    setDetail(d);
    setEditing(false);
    setDraft(d.text);
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
      if (ch.length) {
        setActiveId(ch[0].id);
        await loadChapter(ch[0].id);
      }
    })();
  }, [loadChapter]);

  const refresh = useCallback(async () => {
    await Promise.all([loadChapters(), loadEntities(), loadReview(), loadIgnored(), loadTrash()]);
  }, [loadChapters, loadEntities, loadReview, loadIgnored, loadTrash]);

  const selectChapter = useCallback(
    async (id: number) => {
      setView('read');
      setActiveId(id);
      await loadChapter(id);
    },
    [loadChapter]
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
      await api.resolve(c.id, { action, ...extra });
      await refresh();
      if (detail && detail.chapter.id === c.chapter_id) {
        const d: ChapterDetail = await api.chapter(c.chapter_id);
        setDetail(d);
      }
      setTriage((t) => {
        if (!t) return t;
        const items = t.items.filter((x) => x.id !== c.id);
        if (items.length === 0) return null;
        return { items, index: Math.min(t.index, items.length - 1) };
      });
    },
    [refresh, detail]
  );

  // Bulk triage from Review: one request and one refresh for the whole selection.
  const resolveMany = useCallback(
    async (ids: number[], action: string) => {
      await api.resolveMany(ids, action);
      await refresh();
      if (detail) setDetail(await api.chapter(detail.chapter.id));
    },
    [refresh, detail]
  );

  const addChapter = useCallback(
    async (body: { number: string; title: string; text: string }) => {
      const res = await api.addChapter(body);
      await refresh();
      setAddOpen(false);
      setActiveId(res.chapter.id);
      const d: ChapterDetail = await api.chapter(res.chapter.id);
      setDetail(d);
      setEditing(false);
      setDraft(d.text);
      setView('read');
      const rv: ReviewData = await api.review();
      setReview(rv);
      openTriage(rv.pending.filter((c) => c.chapter_id === res.chapter.id && c.tier !== 'demoted'));
    },
    [refresh]
  );

  const saveChapter = useCallback(async () => {
    if (!activeId) return;
    await api.updateChapter(activeId, { text: draft });
    await refresh();
    await loadChapter(activeId);
    const rv: ReviewData = await api.review();
    setReview(rv);
    openTriage(rv.pending.filter((c) => c.chapter_id === activeId && c.tier !== 'demoted'));
  }, [activeId, draft, refresh, loadChapter]);

  const deleteChapter = useCallback(
    async (renumber: boolean) => {
      if (!activeId) return;
      await api.deleteChapter(activeId, renumber);
      await refresh();
      const ch: Chapter[] = await api.chapters();
      setChapters(ch);
      if (ch.length) {
        setActiveId(ch[0].id);
        await loadChapter(ch[0].id);
      } else {
        setActiveId(null);
        setDetail(null);
      }
    },
    [activeId, refresh, loadChapter]
  );

  const openCandidate = useCallback(
    (candidateId: number) => {
      const idx = review.pending.findIndex((c) => c.id === candidateId);
      if (idx >= 0) setTriage({ items: review.pending, index: idx });
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

  const reviewBadge =
    review.pending.length + review.alerts.filter((a) => a.state === 'unread').length;

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
            onClick={() => setAddOpen(true)}
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
              chapters={chapters}
              entities={entities}
              activeId={activeId}
              detail={detail}
              editing={editing}
              draft={draft}
              setDraft={setDraft}
              onSelect={selectChapter}
              onEdit={() => {
                setDraft(detail?.text ?? '');
                setEditing(true);
              }}
              onCancel={() => setEditing(false)}
              onSave={saveChapter}
              onDelete={deleteChapter}
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

      <AddChapterModal open={addOpen} onClose={() => setAddOpen(false)} onSubmit={addChapter} />

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
    </div>
  );
}
