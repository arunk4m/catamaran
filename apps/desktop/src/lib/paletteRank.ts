/**
 * Command-palette ranking: fuzzy subsequence matching with word-boundary and
 * consecutive-run bonuses, plus a frecency boost for recently-used targets.
 * Pure functions so ranking behaviour is unit-testable.
 */

/** Non-match sentinel: filter these out before sorting. */
export const NO_MATCH = Number.NEGATIVE_INFINITY;

const START_BONUS = 100; // match begins at the first character
const BOUNDARY_BONUS = 40; // match char sits at a word boundary
const RUN_BONUS = 12; // consecutive matched characters
const GAP_PENALTY = 2; // per skipped character between matches
const LENGTH_PENALTY = 0.5; // gentle bias toward shorter targets

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1];
  return prev === " " || prev === "-" || prev === "_" || prev === "." || prev === "/";
}

/**
 * Score `query` against `text` as a case-insensitive subsequence.
 * Returns NO_MATCH when `query` isn't a subsequence of `text`; otherwise a
 * score where prefix matches ≫ boundary matches ≫ scattered matches.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;

  let score = 0;
  let ti = 0;
  let lastMatch = -1;

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) {
        found = i;
        break;
      }
    }
    if (found === -1) return NO_MATCH;

    if (found === 0) score += START_BONUS;
    else if (isBoundary(t, found)) score += BOUNDARY_BONUS;
    if (lastMatch !== -1) {
      if (found === lastMatch + 1) score += RUN_BONUS;
      else score -= (found - lastMatch - 1) * GAP_PENALTY;
    }
    lastMatch = found;
    ti = found + 1;
  }

  return score - t.length * LENGTH_PENALTY;
}

/**
 * Frecency boost: items used recently rank ahead of equally-matched peers.
 * `recentIds` is most-recent-first (the shape of the persisted recents list).
 */
export function frecencyBoost(id: string, recentIds: string[]): number {
  const index = recentIds.indexOf(id);
  if (index === -1) return 0;
  return Math.max(0, 60 - index * 8);
}

export interface Ranked<T> {
  item: T;
  score: number;
}

/**
 * Rank `items` against `query`: fuzzy score + frecency, dropping non-matches.
 * With an empty query everything matches (score 0 + frecency), so recents
 * float to the top of unfiltered lists.
 */
export function rankItems<T>(
  items: T[],
  query: string,
  keyOf: (item: T) => string,
  idOf: (item: T) => string,
  recentIds: string[] = [],
): T[] {
  return items
    .map((item) => {
      const base = fuzzyScore(query, keyOf(item));
      return { item, score: base === NO_MATCH ? NO_MATCH : base + frecencyBoost(idOf(item), recentIds) };
    })
    .filter((ranked) => ranked.score !== NO_MATCH)
    // Stable sort: equal scores keep the caller's order, so curated lists
    // (e.g. most-used kinds first) survive an empty or broad query.
    .sort((a, b) => b.score - a.score)
    .map((ranked) => ranked.item);
}
