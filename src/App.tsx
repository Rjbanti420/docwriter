import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Candidate, Chapter, ChapterDetail, Entity, IgnoredToken, ReviewData, Type, View } from './types';
import AddChapterModal from './components/AddChapterModal';
import TriageModal from './components/TriageModal';
import EntityPanel from './components/EntityPanel';
import ReadView from './views/ReadView';
import ReviewView from './views/ReviewView';
import BibleView from './views/BibleView';
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
      const [t, ch, en, rv, ig, tr] = await Promise.all([
        api.types(),
        api.chapters(),
        api.entities(),
        api.review(),
        api.ignored(),
        api.trash(),
      ]);
      setTypes(t);
      setChapters(ch);
      setEntities(en);
      setReview(rv);
      setIgnored(ig);
      setTrash(tr);
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
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          DocWriter <span>· worldbible</span>
        </div>
        <div className="nav">
          <button className={view === 'read' ? 'active' : ''} onClick={() => setView('read')}>
            Read
          </button>
          <button className={view === 'review' ? 'active' : ''} onClick={() => setView('review')}>
            Review {reviewBadge > 0 && <span className="badge">{reviewBadge}</span>}
          </button>
          <button className={view === 'bible' ? 'active' : ''} onClick={() => setView('bible')}>
            Bible
          </button>
        </div>
        <div className="chapters">
          <div className="section-head">
            <span>Chapters</span>
            <button className="ghost" title="Paste a chapter" onClick={() => setAddOpen(true)}>
              ＋
            </button>
          </div>
          {chapters.length === 0 && <div className="empty">No chapters yet.</div>}
          {chapters.map((c) => (
            <button
              key={c.id}
              className={`chapter-item${c.id === activeId ? ' active' : ''}`}
              onClick={() => selectChapter(c.id)}
            >
              <span className="num">{c.number || '·'}</span>
              <span className="ct">{c.title || `Chapter ${c.number || ''}`.trim()}</span>
              {c.candidate_count ? <span className="cnt">{c.candidate_count} new</span> : null}
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        {view === 'read' &&
          (activeId && !detail ? (
            <div className="main-inner">
              <div className="empty-state">Loading…</div>
            </div>
          ) : (
            <ReadView
              chapters={chapters}
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
            onAlertState={setAlertState}
            onOpenEntity={(id) => setEntityId(id)}
            onTriageAll={() =>
              setTriage({ items: review.pending.filter((c) => c.tier !== 'demoted'), index: 0 })
            }
            onUnignore={unignore}
            onRestore={restore}
            onDeleteForever={deleteForever}
          />
        )}

        {view === 'bible' && (
          <BibleView entities={entities} types={types} onOpenEntity={(id) => setEntityId(id)} onChanged={refresh} />
        )}
      </main>

      <AddChapterModal open={addOpen} onClose={() => setAddOpen(false)} onSubmit={addChapter} />

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

      {settingsOpen && (
        <SettingsView onClose={() => setSettingsOpen(false)} />
      )}

      {entityId != null && (
        <EntityPanel
          entityId={entityId}
          types={types}
          onClose={() => setEntityId(null)}
          onChanged={refresh}
          onOpenChapter={(cid) => {
            setEntityId(null);
            selectChapter(cid);
          }}
        />
      )}
    </div>
  );
}
