import type { Chapter } from './types';

/** The chapter's display number, falling back to its position when blank. */
export function chapterNumber(c: Pick<Chapter, 'number' | 'sort_order'>): string {
  return c.number || String(c.sort_order + 1);
}

/** Human label for a chapter: "Chapter 3 — The Gate". */
export function chapterLabel(c: Pick<Chapter, 'number' | 'title' | 'sort_order'>): string {
  return `Chapter ${chapterNumber(c)}${c.title ? ` — ${c.title}` : ''}`;
}
