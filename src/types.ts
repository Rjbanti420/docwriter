export interface Type {
  id: number;
  name: string;
  icon: string;
  color: string;
  built_in: number;
  detection_hints: string;
  sort_order: number;
}

/** A user-defined Character power level (book-wide rank ladder). */
export interface PowerLevel {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
}

export interface Chapter {
  id: number;
  number: string;
  title: string;
  sort_order: number;
  word_count: number;
  current_revision_id: number;
  created_at: string;
  updated_at: string;
  mention_count?: number;
  candidate_count?: number;
}

export interface Mention {
  id: number;
  entity_id: number;
  start_off: number;
  end_off: number;
  surface_text: string;
  name: string;
  type_color: string;
  type_name: string;
}

export interface CandidatePosition {
  start: number;
  end: number;
  surface: string;
  context: string;
  sentenceInitial: boolean;
  dialogue: boolean;
}

export interface Candidate {
  id: number;
  chapter_id: number;
  revision_id: number;
  surface_text: string;
  normalized: string;
  occurrences: number;
  positions?: string;
  contexts: string;
  suggested_type_id: number | null;
  confidence: number;
  signals: string;
  possible_entity_id: number | null;
  entity_id: number | null;
  tier: string;
  status: string;
  chapter_number?: string;
  chapter_title?: string;
  type_name?: string;
  type_color?: string;
  possible_name?: string;
}

export interface Alert {
  id: number;
  entity_id: number | null;
  kind: string;
  chapter_id: number | null;
  detail: string;
  state: string;
  created_at: string;
  entity_name: string | null;
  type_color?: string;
  chapter_number?: string;
  gun_id?: number | null;
  gun_title?: string | null;
}

export interface Entity {
  id: number;
  name: string;
  type_id: number | null;
  summary: string;
  fields: string;
  tracking: string;
  gap_threshold: number | null;
  trashed_at?: string | null;
  type_name?: string;
  type_color?: string;
  type_icon?: string;
  mention_count?: number;
  first_chapter?: string;
  last_chapter?: string;
  /** The list payload omits the base64 image; load it from /api/entities/:id/image. */
  has_image?: boolean;
}

export interface Alias {
  id: number;
  entity_id: number;
  alias: string;
}

/** An authored, directional link between two cards: source —label→ target. */
export interface EntityRelationship {
  id: number;
  source_id: number;
  target_id: number;
  label: string;
  notes: string;
  created_at: string;
  updated_at: string;
  source_name: string;
  source_trashed_at: string | null;
  source_type_icon: string | null;
  target_name: string;
  target_trashed_at: string | null;
  target_type_icon: string | null;
}

export interface EntityDetail {
  entity: Entity;
  aliases: Alias[];
  mentions: Array<{
    id: number;
    chapter_id: number;
    start_off: number;
    end_off: number;
    surface_text: string;
    context_sentence: string;
    chapter_number: string;
    chapter_title: string;
    chapter_order: number;
  }>;
}

export interface ChapterDetail {
  chapter: Chapter;
  text: string;
  mentions: Mention[];
  candidates: Candidate[];
}

export interface ReviewData {
  pending: Candidate[];
  alerts: Alert[];
  pendingTotals?: { primary: number; demoted: number };
  pendingHasMore?: { primary: boolean; demoted: boolean };
}

export interface IgnoredToken {
  id: number;
  normalized: string;
  created_at: string;
}

/** A planted detail ("Chekhov's gun") and the chapter where it should pay off. */
export interface Gun {
  id: number;
  title: string;
  explanation: string;
  impact: string;
  appearance_chapter_id: number | null;
  planned_number: string;
  planned_chapter_id: number | null;
  outcome: string;
  status: string;
  fired_at: string | null;
  created_at: string;
  updated_at: string;
  /** Resolved server-side: the planned payoff chapter exists right now. */
  ready?: boolean;
}

export interface GunHistory {
  id: number;
  gun_id: number;
  chapter_id: number | null;
  chapter_label: string;
  decision: string;
  from_number: string;
  to_number: string;
  created_at: string;
}

/** An object the gun scan found in a chapter, waiting for Add or Ignore. */
export interface GunCandidate {
  id: number;
  chapter_id: number;
  title: string;
  normalized: string;
  excerpt: string;
  score: number;
  signals: string;
  tier: 'primary' | 'more';
  status: string;
  gun_id: number | null;
  created_at: string;
  chapter_number: string;
  chapter_title: string;
}

export interface GunReview {
  pending: number;
  today: string;
  due: boolean;
}

export interface Question {
  id: number;
  text: string;
  answer: string;
  source_chapter_id: number | null;
  delivered_chapter_id: number | null;
  origin: string;
  created_at: string;
  updated_at: string;
  status: 'open' | 'answered' | 'delivered';
  source_chapter_number?: string | null;
  delivered_chapter_number?: string | null;
}

/** A question the scan found in a chapter, waiting to be accepted or rejected. */
export interface QuestionCandidate {
  id: number;
  chapter_id: number;
  text: string;
  normalized: string;
  status: string;
  question_id: number | null;
  created_at: string;
  chapter_number: string;
  chapter_title: string;
}

export type TimelineRole = 'participant' | 'location' | 'item';
export type TimelineKind = 'event' | 'birth' | 'death' | 'battle' | 'reveal' | 'travel' | 'other';

export interface TimelineEventLink {
  entity_id: number;
  role: TimelineRole;
  name: string;
  trashed_at?: string | null;
  type_name?: string | null;
  type_color?: string | null;
}

/** An explicit story event; chapter_id is the manuscript anchor, not the order. */
export interface TimelineEvent {
  id: number;
  title: string;
  summary: string;
  chapter_id: number | null;
  chapter_number: string | null;
  chapter_title: string | null;
  story_time: string;
  /** Authored day count; null when the writer has not placed it on the day line. */
  story_day: number | null;
  story_order: number;
  kind: TimelineKind;
  created_at: string;
  updated_at: string;
  entities: TimelineEventLink[];
}

export interface TimelineEventInput {
  title: string;
  summary: string;
  chapterId: number | null;
  storyTime: string;
  storyDay?: number | null;
  storyOrder?: number;
  kind: TimelineKind;
  entities: Array<{ entityId: number; role: TimelineRole }>;
}

/** A prose sentence that states a time outright, offered for review. */
export interface TimelineCandidate {
  chapter_id: number;
  title: string;
  summary: string;
  story_time: string;
  sentence: string;
  start: number;
  end: number;
}

export type View = 'read' | 'review' | 'bible' | 'planning' | 'timeline';

/** Export-reminder state. Kept in the book, so a relaunch still knows the answer. */
export interface ExportMeta {
  nudge: 'off' | 'daily' | 'weekly' | 'monthly';
  /** YYYY-MM-DD of the last successful export, or null. */
  lastExportAt: string | null;
  /** YYYY-MM-DD the writer last dismissed the reminder, or null. */
  lastNudgedOn: string | null;
  /** The server's local day, so the client never stamps a date of its own. */
  today: string;
  /** The last opened chapter id, or null. Stored server-side because Electron clears localStorage. */
  last_chapter: number | null;
  due: boolean;
}

/* ---------- Duels ---------- */

export type DuelRole = 'offense' | 'defense' | 'both' | 'none';

export interface DuelAbility {
  id: string;
  name: string;
}

export interface DuelItem {
  id: number;
  name: string;
  rank: string;
  role: DuelRole;
}

/** One fighter exactly as they entered the duel; nothing here is looked up later. */
export interface DuelFighter {
  characterId: number;
  name: string;
  dead: boolean;
  powerRank: number;
  abilities: DuelAbility[];
  items: DuelItem[];
}

/** The frozen snapshot, terrain included. */
export interface DuelSides {
  terrain: string;
  A: DuelFighter[];
  B: DuelFighter[];
}

export interface DuelFighterScore {
  name: string;
  total: number;
  base: number;
  /** The stored power rank (kept for older records). */
  power: number;
  /** powerRank x 2; absent on duels saved before this field existed. */
  powerPoints?: number;
  /** The number of abilities used (kept for older records). */
  abilities: number;
  /** min(abilities, 3) x 1.5; absent on duels saved before this field existed. */
  abilityPoints?: number;
  attack: number;
  defence: number;
}

export interface DuelSideScore {
  fighters: DuelFighterScore[];
  raw: number;
  numbers: number;
  skilled: boolean;
  /** 1, or 1.5 when this side was picked more skilled; absent on older records. */
  multiplier?: number;
  score: number;
}

export interface DuelOutcome {
  winnerSide: 'A' | 'B';
  skillSide: 'A' | 'B' | null;
  chosenBy: 'A' | 'B' | null;
  seed: number;
  roll: number;
  probabilityA: number;
  scores: { A: number; B: number };
  breakdown: { A: DuelSideScore; B: DuelSideScore };
}

export interface Duel {
  id: number;
  title: string;
  sides: DuelSides;
  outcome: DuelOutcome;
  narrative: string;
  created_at: string;
}

export interface DuelCreateFighter {
  characterId: number;
  abilityIds?: Array<string | number>;
  itemIds?: number[];
}

export interface DuelCreatePayload {
  sides: [{ fighters: DuelCreateFighter[] }, { fighters: DuelCreateFighter[] }];
  terrain?: string;
  chosenWinner?: 'A' | 'B' | null;
  skilledSide?: 'A' | 'B' | null;
  title?: string;
}
