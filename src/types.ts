export interface Type {
  id: number;
  name: string;
  icon: string;
  color: string;
  built_in: number;
  detection_hints: string;
  sort_order: number;
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
  positions: string;
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
}

export interface Alias {
  id: number;
  entity_id: number;
  alias: string;
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

export type View = 'read' | 'review' | 'bible' | 'planning';
