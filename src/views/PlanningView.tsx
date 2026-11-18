import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../api';
import DuelBuilder from '../components/DuelBuilder';
import DuelList from '../components/DuelList';
import { chapterLabel, chapterNumber } from '../chapters';
import type { Chapter, Entity, Gun, GunCandidate, GunReview, Question, QuestionCandidate, Type } from '../types';

type Tab = 'guns' | 'questions' | 'duels';
type QFilter = 'all' | 'open' | 'answered' | 'delivered';

/* -------------------------------------------------------------------------- */
/* Chekhov's Guns                                                              */
/* -------------------------------------------------------------------------- */

function gunState(gun: Gun): string {
  if (gun.status === 'fired') return 'fired';
  if (gun.outcome === 'used') return 'used';
  if (gun.outcome === 'discussed') return 'discussed';
  if (gun.ready) return 'ready';
  return 'active';
}

// Ready first, settled last: a ready gun is the only card asking for a decision
// today, and a fired one only needs to be findable.
const GUN_RANK: Record<string, number> = { ready: 0, active: 1, discussed: 1, used: 2, fired: 3 };
const QUESTION_RANK: Record<Question['status'], number> = { open: 0, answered: 1, delivered: 2 };

const gunRank = (gun: Gun) => GUN_RANK[gunState(gun)] ?? 1;
const questionRank = (q: Question) => QUESTION_RANK[q.status] ?? 0;

function GunCard({
  gun,
  chapters,
  onDecide,
  onFire,
  onReopen,
  onEdit,
  onDelete,
}: {
  gun: Gun;
  chapters: Chapter[];
  onDecide: (decision: 'used' | 'discussed') => void;
  onFire: () => void;
  onReopen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const state = gunState(gun);
  const appearance =
    gun.appearance_chapter_id != null ? chapters.find((c) => c.id === gun.appearance_chapter_id) : undefined;
  const planned = gun.planned_chapter_id != null ? chapters.find((c) => c.id === gun.planned_chapter_id) : undefined;
  const target = gun.planned_number
    ? planned
      ? chapterLabel(planned)
      : `chapter ${gun.planned_number} (not written yet)`
    : 'no payoff planned';

  return (
    <div
      className={`dw-card gun-card${state === 'fired' ? ' is-fired' : ''}${state === 'ready' ? ' is-ready' : ''}`}
      data-status={state}
    >
      <div className="plan-title">{gun.title}</div>
      <div className="plan-meta">
        <span className={`status-chip ${state}`}>{state}</span>
        <span>planted{appearance ? ` in ${chapterLabel(appearance)}` : ' — not placed yet'}</span>
        <span className="plan-arrow" aria-hidden="true">
          →
        </span>
        <span>pays off {target}</span>
      </div>
      {gun.impact && <div className="plan-note plan-impact">Payoff: {gun.impact}</div>}
      {gun.explanation && <div className="plan-note">{gun.explanation}</div>}
      {/* The outcomes are this card's work only when the chapter that pays it
          off exists. Every other card keeps them one click away. */}
      {state === 'ready' ? (
        <div className="outcome-row">
          <button className="btn-primary" onClick={() => onDecide('used')}>
            Used
          </button>
          <button className="btn-secondary" onClick={() => onDecide('discussed')}>
            Discussed — move on
          </button>
          <button className="ghost" onClick={onFire}>
            Fired — closed
          </button>
        </div>
      ) : state === 'active' || state === 'discussed' ? (
        <details className="outcome-more">
          <summary>Record an outcome</summary>
          <div className="outcome-row">
            <button className="btn-secondary" onClick={() => onDecide('used')}>
              Used
            </button>
            <button className="btn-secondary" onClick={() => onDecide('discussed')}>
              Discussed — move on
            </button>
            <button className="ghost" onClick={onFire}>
              Fired — closed
            </button>
          </div>
        </details>
      ) : null}
      <div className="actions">
        {state === 'fired' ? (
          // Fired is the permanent close — nothing to reopen, only edit or delete.
          <span className="progress">Closed for good</span>
        ) : state === 'used' ? (
          <button className="btn-secondary" onClick={onReopen}>
            Reopen — undo used
          </button>
        ) : null}
        <div style={{ flex: 1 }} />
        <button className="ghost" onClick={onEdit}>
          Edit
        </button>
        <button className="danger-quiet" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

function GunEditor({
  gun,
  chapters,
  onClose,
  onSaved,
}: {
  gun: Gun | null;
  chapters: Chapter[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(gun?.title ?? '');
  const [impact, setImpact] = useState(gun?.impact ?? '');
  const [explanation, setExplanation] = useState(gun?.explanation ?? '');
  const [appearanceId, setAppearanceId] = useState<string>(
    gun?.appearance_chapter_id != null ? String(gun.appearance_chapter_id) : ''
  );
  const [plannedSel, setPlannedSel] = useState<string>(
    gun?.planned_chapter_id != null ? String(gun.planned_chapter_id) : gun?.planned_number ? '__future__' : ''
  );
  const [futureNumber, setFutureNumber] = useState<string>(
    gun?.planned_chapter_id != null ? '' : gun?.planned_number ?? ''
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function dirty() {
    return (
      title !== (gun?.title ?? '') ||
      impact !== (gun?.impact ?? '') ||
      explanation !== (gun?.explanation ?? '') ||
      appearanceId !== (gun?.appearance_chapter_id != null ? String(gun.appearance_chapter_id) : '') ||
      plannedSel !==
        (gun?.planned_chapter_id != null
          ? String(gun.planned_chapter_id)
          : gun?.planned_number
            ? '__future__'
            : '') ||
      (plannedSel === '__future__' && futureNumber !== (gun?.planned_number ?? ''))
    );
  }

  // Cancel, backdrop and Escape all reach here; only unsaved work asks first.
  function requestClose() {
    if (busy) return;
    if (dirty() && !confirm('Discard this gun? Nothing is saved.')) return;
    onClose();
  }

  async function submit() {
    const clean = title.trim();
    if (!clean) return;
    let plannedNumber = '';
    if (plannedSel === '__future__') plannedNumber = futureNumber.trim();
    else if (plannedSel !== '') {
      const c = chapters.find((x) => x.id === Number(plannedSel));
      plannedNumber = c ? chapterNumber(c) : '';
    }
    setBusy(true);
    setError('');
    try {
      const body = {
        title: clean,
        impact,
        explanation,
        appearanceChapterId: appearanceId === '' ? null : Number(appearanceId),
        plannedNumber,
      };
      if (gun) await api.updateGun(gun.id, body);
      else await api.addGun(body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={requestClose}>
      <div
        className="modal"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={gun ? 'Edit gun' : 'New gun'}
      >
        <div className="modal-head">
          <h2>{gun ? 'Edit gun' : 'New gun'}</h2>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>What is it?</label>
            <input
              autoFocus
              value={title}
              onChange={(ev) => setTitle(ev.target.value)}
              placeholder="e.g. The brass key Marla pockets in the market"
            />
          </div>
          <div className="field">
            <label>How it should pay off</label>
            <textarea
              value={impact}
              onChange={(ev) => setImpact(ev.target.value)}
              style={{ minHeight: 70 }}
              placeholder="e.g. Opens the vault in the finale"
            />
          </div>
          <div className="field">
            <label>Notes (optional)</label>
            <textarea
              value={explanation}
              onChange={(ev) => setExplanation(ev.target.value)}
              style={{ minHeight: 60 }}
              placeholder="Where it was planted, what it looks like…"
            />
          </div>
          <div className="row">
            <div className="field">
              <label>Planted in</label>
              <select value={appearanceId} onChange={(ev) => setAppearanceId(ev.target.value)}>
                <option value="">— not placed yet —</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {chapterLabel(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Should pay off in</label>
              <select value={plannedSel} onChange={(ev) => setPlannedSel(ev.target.value)}>
                <option value="">— no payoff planned —</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {chapterLabel(c)}
                  </option>
                ))}
                <option value="__future__">A chapter not written yet…</option>
              </select>
            </div>
          </div>
          {plannedSel === '__future__' && (
            <div className="field" style={{ maxWidth: 220 }}>
              <label>Chapter number / rank</label>
              <input
                type="number"
                min={1}
                value={futureNumber}
                onChange={(ev) => setFutureNumber(ev.target.value)}
                placeholder="e.g. 15"
              />
              <span className="progress">You'll be alerted once a chapter with this number exists.</span>
            </div>
          )}
          {error && <div className="lookalike">{error}</div>}
        </div>
        <div className="modal-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!title.trim() || busy} onClick={submit}>
            {busy ? 'Saving…' : gun ? 'Save' : 'Add gun'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GunCandidateRow({
  candidate,
  onAccept,
  onReject,
}: {
  candidate: GunCandidate;
  onAccept: (title: string) => void;
  onReject: () => void;
}) {
  const [title, setTitle] = useState(candidate.title);
  return (
    <li className="dw-card">
      <div className="dw-card-meta" style={{ marginTop: 0 }}>
        <span className="dw-ref">
          ch.{candidate.chapter_number}
          {candidate.chapter_title ? ` · ${candidate.chapter_title}` : ''}
        </span>
        {candidate.tier === 'more' && <span className="dw-badge">more</span>}
      </div>
      <input
        className="q-edit"
        value={title}
        onChange={(ev) => setTitle(ev.target.value)}
        aria-label="Gun title"
      />
      <p className="dw-gun-excerpt">{candidate.excerpt}</p>
      <div className="dw-card-actions" style={{ opacity: 1 }}>
        <button className="btn-primary" disabled={!title.trim()} onClick={() => onAccept(title.trim())}>
          Add gun
        </button>
        <button className="btn-secondary" onClick={onReject}>
          Not a gun
        </button>
      </div>
    </li>
  );
}

function GunReviewModal({
  pending,
  onLook,
  onLater,
}: {
  pending: number;
  onLook: () => void;
  onLater: () => void;
}) {
  return (
    <div className="overlay" onClick={onLater}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>Potential guns found</h2>
          <span className="progress">{pending}</span>
        </div>
        <div className="modal-body">
          <p className="progress" style={{ marginTop: 0 }}>
            {pending === 1 ? 'One object' : `${pending} objects`} from your chapters may be worth bringing back.
            Review {pending === 1 ? 'it' : 'them'} now, or leave {pending === 1 ? 'it' : 'them'} in Planning → Guns
            and we'll remind you tomorrow.
          </p>
        </div>
        <div className="modal-foot">
          <button onClick={onLater}>Later</button>
          <button className="btn-primary" onClick={onLook}>
            Look now
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Questions                                                                   */
/* -------------------------------------------------------------------------- */

function CandidateRow({
  candidate,
  onAccept,
  onReject,
}: {
  candidate: QuestionCandidate;
  onAccept: (text: string) => void;
  onReject: () => void;
}) {
  const [text, setText] = useState(candidate.text);
  return (
    <li className="dw-card">
      <div className="dw-card-meta" style={{ marginTop: 0 }}>
        <span className="dw-ref">
          ch.{candidate.chapter_number}
          {candidate.chapter_title ? ` · ${candidate.chapter_title}` : ''}
        </span>
      </div>
      <input
        className="q-edit"
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        aria-label="Question text"
      />
      <div className="dw-card-actions" style={{ opacity: 1 }}>
        <button className="btn-primary" disabled={!text.trim()} onClick={() => onAccept(text.trim())}>
          Add question
        </button>
        <button className="btn-secondary" onClick={onReject}>
          Not a question
        </button>
      </div>
    </li>
  );
}

function QuestionEditor({
  question,
  chapters,
  answerFirst = false,
  onClose,
  onSaved,
}: {
  question: Question | null;
  chapters: Chapter[];
  answerFirst?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(question?.text ?? '');
  const [answer, setAnswer] = useState(question?.answer ?? '');
  const [sourceId, setSourceId] = useState<string>(
    question?.source_chapter_id != null ? String(question.source_chapter_id) : ''
  );
  const [deliveredId, setDeliveredId] = useState<string>(
    question?.delivered_chapter_id != null ? String(question.delivered_chapter_id) : ''
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function dirty() {
    return (
      text !== (question?.text ?? '') ||
      answer !== (question?.answer ?? '') ||
      sourceId !== (question?.source_chapter_id != null ? String(question.source_chapter_id) : '') ||
      deliveredId !== (question?.delivered_chapter_id != null ? String(question.delivered_chapter_id) : '')
    );
  }

  function requestClose() {
    if (busy) return;
    if (dirty() && !confirm('Discard this question? Nothing is saved.')) return;
    onClose();
  }

  async function submit() {
    const clean = text.trim();
    if (!clean) return;
    setBusy(true);
    setError('');
    try {
      const body = {
        text: clean,
        answer,
        sourceChapterId: sourceId === '' ? null : Number(sourceId),
        deliveredChapterId: deliveredId === '' ? null : Number(deliveredId),
      };
      if (question) await api.updateQuestion(question.id, body);
      else await api.addQuestion(body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={requestClose}>
      <div
        className="modal"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={answerFirst && question ? 'Answer question' : question ? 'Edit question' : 'New question'}
      >
        <div className="modal-head">
          <h2>{answerFirst && question ? 'Answer question' : question ? 'Edit question' : 'New question'}</h2>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>The question</label>
            <textarea
              autoFocus={!answerFirst}
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              style={{ minHeight: 70 }}
              placeholder="e.g. Who told the gatekeeper about the key?"
            />
          </div>
          <div className="field">
            <label>Answer (optional — the reader gets it when delivered)</label>
            <textarea
              autoFocus={answerFirst}
              value={answer}
              onChange={(ev) => setAnswer(ev.target.value)}
              style={{ minHeight: 60 }}
              placeholder="e.g. The gatekeeper's brother"
            />
          </div>
          <div className="row">
            <div className="field">
              <label>Raised in</label>
              <select value={sourceId} onChange={(ev) => setSourceId(ev.target.value)}>
                <option value="">— not linked —</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {chapterLabel(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Answered in</label>
              <select value={deliveredId} onChange={(ev) => setDeliveredId(ev.target.value)}>
                <option value="">— not delivered yet —</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {chapterLabel(c)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && <div className="lookalike">{error}</div>}
        </div>
        <div className="modal-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!text.trim() || busy} onClick={submit}>
            {busy ? 'Saving…' : question ? 'Save' : 'Add question'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScanModal({
  kind,
  chapters,
  onClose,
  onScan,
}: {
  kind: 'questions' | 'guns';
  chapters: Chapter[];
  onClose: () => void;
  onScan: (ids: number[], onProgress?: (done: number, total: number) => void) => Promise<void>;
}) {
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(chapters.length);
  const all = chapters.length > 0 && sel.length === chapters.length;
  const toggle = (id: number) =>
    setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const guns = kind === 'guns';
  const clamp = (value: number) => Math.min(Math.max(1, value), chapters.length || 1);
  const setStart = (value: number) => {
    const next = clamp(value);
    setFrom(next);
    setTo((end) => Math.max(end, next));
  };
  const setEnd = (value: number) => {
    const next = clamp(value);
    setTo(next);
    setFrom((start) => Math.min(start, next));
  };
  const selectRange = () => {
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    setSel(chapters.slice(start - 1, end).map((c) => c.id));
  };
  function requestClose() {
    if (busy) return;
    if (sel.length > 0 && !confirm('Discard the chapters you selected?')) return;
    onClose();
  }

  return (
    <div className="overlay" onClick={requestClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>Scan chapters for {guns ? 'guns' : 'questions'}</h2>
          <span className="progress">{sel.length} selected</span>
        </div>
        <div className="modal-body">
          <p className="progress" style={{ marginTop: 0 }}>
            {guns
              ? 'Looks for objects the prose handles, describes, repeats, or promises. Anything you have accepted or dismissed is skipped.'
              : "Looks for sentences that end in a question mark. Anything you've already accepted or dismissed is skipped."}
          </p>
          <div className="toolbar" style={{ marginTop: 0 }}>
            <label className="scan-select">
              <input type="checkbox" checked={all} onChange={() => setSel(all ? [] : chapters.map((c) => c.id))} />
              Select all
            </label>
          </div>
          <div className="scan-range">
            <label>
              From
              <input
                type="number"
                min={1}
                max={chapters.length}
                value={from}
                onChange={(ev) => setStart(Number(ev.target.value))}
                aria-label="First chapter position"
              />
            </label>
            <label>
              To
              <input
                type="number"
                min={1}
                max={chapters.length}
                value={to}
                onChange={(ev) => setEnd(Number(ev.target.value))}
                aria-label="Last chapter position"
              />
            </label>
            <button type="button" className="btn-secondary" onClick={selectRange} disabled={!chapters.length}>
              Select range
            </button>
            <button type="button" className="ghost" onClick={() => setSel([])} disabled={!sel.length}>
              Clear
            </button>
          </div>
          <p className="progress" style={{ marginTop: 0 }}>
            {chapters[from - 1] ? chapterLabel(chapters[from - 1]) : '—'} →{' '}
            {chapters[to - 1] ? chapterLabel(chapters[to - 1]) : '—'} · {sel.length} selected
          </p>
          <div className="list">
            {chapters.map((c) => (
              <label
                key={c.id}
                className="card scan-chapter"
                style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', padding: '10px 14px' }}
              >
                <input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} />
                <span style={{ flex: 1 }}>{chapterLabel(c)}</span>
                <span className="progress">{c.word_count} words</span>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={sel.length === 0 || busy}
            onClick={async () => {
              setBusy(true);
              setProgress(null);
              try {
                await onScan(sel, (done, total) => setProgress({ done, total }));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? progress
                ? `Scanning ${progress.done}/${progress.total}…`
                : 'Scanning…'
              : 'Scan selected'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The page                                                                    */
/* -------------------------------------------------------------------------- */

export default function PlanningView({
  chapters,
  entities,
  types,
  onChanged,
  focusGunId,
  onClearFocus,
  onOpenEntity,
  onDirtyChange,
}: {
  chapters: Chapter[];
  entities: Entity[];
  types: Type[];
  onChanged: () => void;
  focusGunId: number | null;
  onClearFocus: () => void;
  onOpenEntity: (id: number) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>('guns');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderDirty, setBuilderDirty] = useState(false);
  const [guns, setGuns] = useState<Gun[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [duelCount, setDuelCount] = useState(0);
  const [candidates, setCandidates] = useState<QuestionCandidate[]>([]);
  const [gunCandidates, setGunCandidates] = useState<GunCandidate[]>([]);
  const [gunReview, setGunReview] = useState<GunReview | null>(null);
  const [gunEditor, setGunEditor] = useState<Gun | 'new' | null>(null);
  const [questionEditor, setQuestionEditor] = useState<Question | 'new' | null>(null);
  const [answerFirst, setAnswerFirst] = useState(false);
  const [scanKind, setScanKind] = useState<'questions' | 'guns' | null>(null);
  const [showMoreGuns, setShowMoreGuns] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [filter, setFilter] = useState<QFilter>('all');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const prompted = useRef(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [actionError, setActionError] = useState('');
  // Closing a dialog must hand the keyboard back to the card that opened it, so
  // remember the last thing focused outside any overlay.
  const focusReturn = useRef<HTMLElement | null>(null);
  const overlaysOpen = gunEditor !== null || questionEditor !== null || scanKind !== null || reviewOpen;
  const hadOverlay = useRef(false);

  // App's sidebar guard cannot see the builder, so report its dirty flag up.
  useEffect(() => {
    onDirtyChange(builderDirty);
  }, [builderDirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  useEffect(() => {
    const onFocus = (ev: FocusEvent) => {
      const target = ev.target;
      if (target instanceof HTMLElement && target !== document.body && !target.closest('.overlay')) {
        focusReturn.current = target;
      }
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);

  useEffect(() => {
    if (hadOverlay.current && !overlaysOpen) {
      const opener = focusReturn.current;
      focusReturn.current = null;
      // On success the card may already be gone (a delete), so check first.
      if (opener?.isConnected && opener.checkVisibility?.({ checkVisibilityCSS: true }) !== false) {
        opener.focus({ preventScroll: true });
      }
    }
    hadOverlay.current = overlaysOpen;
  }, [overlaysOpen]);

  // Reload when the chapter list changes (a gun may become "ready").
  const chapterSig = chapters.map((c) => `${c.id}:${c.number}:${c.sort_order}`).join('|');
  const load = useCallback(async () => {
    const [g, q, duels, c, gc, gr] = await Promise.all([
      api.guns(),
      api.questions(),
      api.duels(),
      api.questionCandidates(),
      api.gunCandidates(),
      api.gunReview(),
    ]);
    setGuns(g);
    setQuestions(q);
    setDuelCount(duels.length);
    setCandidates(c);
    setGunCandidates(gc);
    setGunReview(gr);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load, chapterSig]);

  // The one automatic prompt per Planning visit, decided by the first review
  // response. Later is remembered by the server until the next local day; a
  // reload must not reopen the popup, and a scan during this visit must not
  // trigger it after the fact.
  useEffect(() => {
    if (!gunReview || prompted.current) return;
    prompted.current = true;
    if (gunReview.due) setReviewOpen(true);
  }, [gunReview]);

  const after = useCallback(async () => {
    await load();
    onChanged();
  }, [load, onChanged]);

  // Jump straight to a gun opened from a Review alert.
  useEffect(() => {
    if (focusGunId == null || !loaded) return;
    const gun = guns.find((g) => g.id === focusGunId);
    if (builderOpen && builderDirty && !confirm('Leave the duel builder? Nothing is saved.')) {
      onClearFocus();
      return;
    }
    setBuilderOpen(false);
    setBuilderDirty(false);
    setTab('guns');
    if (gun) setGunEditor(gun);
    onClearFocus();
  }, [focusGunId, loaded, guns, builderOpen, builderDirty, onClearFocus]);

  // Every click that changes the plan reports its failure in one banner, and
  // leaves the card as it was so the same button retries it.
  async function run(action: () => Promise<void>) {
    setActionError('');
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }
  const decide = (gun: Gun, decision: 'used' | 'discussed') =>
    run(async () => {
      await api.decideGun(gun.id, { decision });
      await after();
    });
  const fire = (gun: Gun) =>
    run(async () => {
      if (!confirm(`Close "${gun.title}" as fired? Firing cannot be undone.`)) return;
      await api.fireGun(gun.id);
      await after();
    });
  const reopen = (gun: Gun) =>
    run(async () => {
      await api.reopenGun(gun.id);
      await after();
    });
  const removeGun = (gun: Gun) =>
    run(async () => {
      if (!confirm(`Delete "${gun.title}"? Its decision history goes with it.`)) return;
      await api.deleteGun(gun.id);
      await after();
    });
  const removeQuestion = (q: Question) =>
    run(async () => {
      if (!confirm('Delete this question?')) return;
      await api.deleteQuestion(q.id);
      await after();
    });
  const acceptCandidate = (cand: QuestionCandidate, text: string) =>
    run(async () => {
      await api.resolveQuestionCandidate(cand.id, { action: 'accept', text });
      setNotice('Question added.');
      await after();
    });
  const rejectCandidate = (cand: QuestionCandidate) =>
    run(async () => {
      await api.resolveQuestionCandidate(cand.id, { action: 'reject' });
      await after();
    });
  const acceptGunCandidate = (cand: GunCandidate, title: string) =>
    run(async () => {
      await api.resolveGunCandidate(cand.id, { action: 'accept', title });
      setNotice('Gun added.');
      await after();
    });
  const rejectGunCandidate = (cand: GunCandidate) =>
    run(async () => {
      await api.resolveGunCandidate(cand.id, { action: 'reject' });
      await after();
    });
  async function scan(
    ids: number[],
    kind: 'questions' | 'guns',
    onProgress?: (done: number, total: number) => void
  ) {
    // Small batches keep one long scan from freezing the server and let the
    // modal count its way through a 2000-chapter book.
    const chunkSize = 20;
    let created = 0;
    let skipped = 0;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const r: { created: number; skipped: number } =
        kind === 'guns' ? await api.scanGuns(chunk) : await api.scanQuestions(chunk);
      created += r.created;
      skipped += r.skipped;
      onProgress?.(Math.min(i + chunkSize, ids.length), ids.length);
    }
    setScanKind(null);
    const noun = kind === 'guns' ? 'gun' : 'question';
    setNotice(
      created === 0
        ? `No new ${noun}s found.`
        : `Found ${created} new ${noun}${created === 1 ? '' : 's'}${
            skipped ? ` · ${skipped} already tracked` : ''
          }.`
    );
    await after();
  }
  async function laterGunReview() {
    setReviewOpen(false);
    await api.laterGunReview();
    setGunReview((prev) => (prev ? { ...prev, due: false } : prev));
  }

  const counts: Record<QFilter, number> = {
    all: questions.length,
    open: questions.filter((q) => q.status === 'open').length,
    answered: questions.filter((q) => q.status === 'answered').length,
    delivered: questions.filter((q) => q.status === 'delivered').length,
  };
  const shownQuestions = (filter === 'all' ? questions : questions.filter((q) => q.status === filter))
    .slice()
    .sort((a, b) => questionRank(a) - questionRank(b));
  // Ready guns first: the chapter that pays them off has arrived, so they are
  // the only cards that ask for a decision today.
  const orderedGuns = guns.slice().sort((a, b) => gunRank(a) - gunRank(b));
  const primaryGunCandidates = gunCandidates.filter((c) => c.tier === 'primary');
  const shownGunCandidates =
    showMoreGuns || primaryGunCandidates.length === 0 ? gunCandidates : primaryGunCandidates;
  const moreGunCount = gunCandidates.length - primaryGunCandidates.length;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'guns', label: "Chekhov's Guns", count: guns.length },
    { id: 'questions', label: 'Questions', count: questions.length },
    { id: 'duels', label: 'Duels', count: duelCount },
  ];

  function changeTab(next: Tab) {
    if (builderOpen && next !== 'duels') {
      if (builderDirty && !confirm('Leave the duel builder? Nothing is saved.')) return;
      setBuilderOpen(false);
      setBuilderDirty(false);
    }
    setTab(next);
  }

  function stepTab(ev: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    const next = (index + step + tabs.length) % tabs.length;
    changeTab(tabs[next].id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="main-inner">
      <div className="reader-head">
        <div className="reader-head__titles">
          <h1>Planning</h1>
          <p className="reader-head__sub">
            {loaded && (
              <>
                {guns.length} gun{guns.length === 1 ? '' : 's'} · {questions.length} question
                {questions.length === 1 ? '' : 's'}, {counts.open} still open · {duelCount} duel
                {duelCount === 1 ? '' : 's'}
              </>
            )}
          </p>
        </div>
        <div className="reader-head__actions">
          {tab === 'guns' ? (
            <>
              <button
                className="btn-secondary"
                disabled={chapters.length === 0}
                onClick={() => setScanKind('guns')}
              >
                Scan chapters
              </button>
              <button className="btn-primary" onClick={() => setGunEditor('new')}>
                ＋ New gun
              </button>
            </>
          ) : tab === 'questions' ? (
            <>
              <button
                className="btn-secondary"
                disabled={chapters.length === 0}
                onClick={() => setScanKind('questions')}
              >
                Scan chapters
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setAnswerFirst(false);
                  setQuestionEditor('new');
                }}
              >
                ＋ New question
              </button>
            </>
          ) : tab === 'duels' && !builderOpen ? (
            <button
              className="btn-primary"
              onClick={() => {
                setBuilderDirty(false);
                setBuilderOpen(true);
              }}
            >
              ＋ New duel
            </button>
          ) : null}
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Planning">
        {tabs.map((t, index) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            role="tab"
            id={`planning-tab-${t.id}`}
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'active' : ''}
            onClick={() => changeTab(t.id)}
            onKeyDown={(ev) => stepTab(ev, index)}
          >
            {t.label} {t.count > 0 && <span className="badge">{t.count}</span>}
          </button>
        ))}
      </div>

      {notice && (
        <div className="plan-notice" role="status">
          {notice}{' '}
          <button className="ghost" style={{ padding: '0 4px' }} onClick={() => setNotice('')}>
            dismiss
          </button>
        </div>
      )}

      {actionError && (
        <div className="save-error" role="alert">
          <div>
            <strong>That didn’t go through.</strong> {actionError}
          </div>
          <button onClick={() => setActionError('')}>Dismiss</button>
        </div>
      )}

      {tab === 'guns' && (
        <div role="tabpanel" id="planning-panel-guns" aria-labelledby="planning-tab-guns">
          <p className="card-note" style={{ marginTop: 0 }}>
            Plant something early that will matter later. When its chapter arrives, Review alerts you.
          </p>
          <details className="plan-help__more">
            <summary>What the three outcomes mean</summary>
            <p className="card-note">
              <strong>Used</strong> pays it off and stays revisitable, so you can reopen it. <strong>Discussed</strong>{' '}
              defers it to the next chapter. <strong>Fired</strong> closes it for good.
            </p>
          </details>
          {gunCandidates.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div className="group-head">
                <span className="group-label">Found in your chapters</span>
                <span className="group-count">{gunCandidates.length}</span>
                <span className="group-rule" />
              </div>
              <ul className="dw-list">
                {shownGunCandidates.map((c) => (
                  <GunCandidateRow
                    key={c.id}
                    candidate={c}
                    onAccept={(title) => acceptGunCandidate(c, title)}
                    onReject={() => rejectGunCandidate(c)}
                  />
                ))}
              </ul>
              {moreGunCount > 0 && (
                <button className="ghost" onClick={() => setShowMoreGuns((v) => !v)}>
                  {showMoreGuns ? 'Show less' : `Show more (${moreGunCount})`}
                </button>
              )}
            </div>
          )}
          {!loaded ? (
            <p className="progress">Loading…</p>
          ) : guns.length === 0 ? (
            <div className="empty-state">
              No guns yet. A locked chest, a scar, a debt — anything you plant that has to come back.
            </div>
          ) : (
            <div className="list">
              {orderedGuns.map((g) => (
                <GunCard
                  key={g.id}
                  gun={g}
                  chapters={chapters}
                  onDecide={(decision) => decide(g, decision)}
                  onFire={() => fire(g)}
                  onReopen={() => reopen(g)}
                  onEdit={() => setGunEditor(g)}
                  onDelete={() => removeGun(g)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'duels' && (
        <div role="tabpanel" id="planning-panel-duels" aria-labelledby="planning-tab-duels">
          {!builderOpen && (
            <p className="card-note" style={{ marginTop: 0 }}>
              Run a duel when two sides' strengths matter. The result and its account are kept here.
            </p>
          )}
          {builderOpen ? (
            <DuelBuilder
              entities={entities}
              types={types}
              onOpenEntity={onOpenEntity}
              onChanged={onChanged}
              onSaved={() => setDuelCount((count) => count + 1)}
              onDirtyChange={setBuilderDirty}
              onBack={() => {
                setBuilderOpen(false);
                setBuilderDirty(false);
              }}
            />
          ) : (
            <DuelList onCountChange={setDuelCount} />
          )}
        </div>
      )}

      {tab === 'questions' && (
        <div role="tabpanel" id="planning-panel-questions" aria-labelledby="planning-tab-questions">
          <p className="card-note" style={{ marginTop: 0 }}>
            Every question your prose raises, and whether the page has answered it yet.
          </p>
          <details className="plan-help__more">
            <summary>What the three states mean</summary>
            <p className="card-note">
              <strong>Open</strong> — no answer yet. <strong>Answered</strong> — you know it; the page
              has not said it. <strong>Delivered</strong> — a chapter has paid it off.
            </p>
          </details>
          {candidates.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div className="group-head">
                <span className="group-label">Found in your chapters</span>
                <span className="group-count">{candidates.length}</span>
                <span className="group-rule" />
              </div>
              <ul className="dw-list">
                {candidates.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    onAccept={(text) => acceptCandidate(c, text)}
                    onReject={() => rejectCandidate(c)}
                  />
                ))}
              </ul>
            </div>
          )}

          {!loaded ? (
            <p className="progress">Loading…</p>
          ) : questions.length === 0 ? (
            <div className="empty-state">
              No questions tracked yet. Scan a chapter to find the ones your prose raises, or add one by hand.
            </div>
          ) : (
            <>
              <div className="dw-filters">
                {(['all', 'open', 'answered', 'delivered'] as const).map((k) => (
                  <button
                    key={k}
                    className={`dw-chip${filter === k ? ' is-active' : ''}`}
                    aria-pressed={filter === k}
                    onClick={() => setFilter(k)}
                  >
                    {k[0].toUpperCase() + k.slice(1)}
                    <span className="dw-chip-count">{counts[k]}</span>
                  </button>
                ))}
              </div>
              {shownQuestions.length === 0 ? (
                <div className="empty-state">Nothing {filter} right now.</div>
              ) : (
                <ul className="dw-list">
                  {shownQuestions.map((q) => (
                    <li className="dw-card" key={q.id} data-status={q.status}>
                      <p className="dw-card-q">{q.text}</p>
                      <div className="dw-card-meta">
                        <span className="dw-badge">{q.status}</span>
                        {q.source_chapter_number && <span className="dw-ref">from ch.{q.source_chapter_number}</span>}
                        {q.delivered_chapter_number && (
                          <span className="dw-ref">answered in ch.{q.delivered_chapter_number}</span>
                        )}
                      </div>
                      {q.answer && (
                        <div className="dw-answer">
                          <span className="dw-answer-label">Answer</span>
                          {q.answer}
                        </div>
                      )}
                      <div className="dw-card-actions">
                        {q.status === 'open' ? (
                          <button
                            className="btn-primary"
                            onClick={() => {
                              setAnswerFirst(true);
                              setQuestionEditor(q);
                            }}
                          >
                            Answer
                          </button>
                        ) : (
                          <button
                            className="btn-secondary"
                            onClick={() => {
                              setAnswerFirst(false);
                              setQuestionEditor(q);
                            }}
                          >
                            Edit
                          </button>
                        )}
                        <button className="danger-quiet" onClick={() => removeQuestion(q)}>
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {gunEditor && (
        <GunEditor
          gun={gunEditor === 'new' ? null : gunEditor}
          chapters={chapters}
          onClose={() => setGunEditor(null)}
          onSaved={async () => {
            setGunEditor(null);
            await after();
          }}
        />
      )}
      {questionEditor && (
        <QuestionEditor
          question={questionEditor === 'new' ? null : questionEditor}
          chapters={chapters}
          answerFirst={answerFirst}
          onClose={() => setQuestionEditor(null)}
          onSaved={async () => {
            setQuestionEditor(null);
            await after();
          }}
        />
      )}
      {scanKind && (
        <ScanModal
          kind={scanKind}
          chapters={chapters}
          onClose={() => setScanKind(null)}
          onScan={(ids, onProgress) => scan(ids, scanKind, onProgress)}
        />
      )}
      {reviewOpen && gunReview && gunReview.pending > 0 && (
        <GunReviewModal
          pending={gunReview.pending}
          onLook={() => {
            setReviewOpen(false);
            changeTab('guns');
            setShowMoreGuns(false);
          }}
          onLater={laterGunReview}
        />
      )}
    </div>
  );
}
