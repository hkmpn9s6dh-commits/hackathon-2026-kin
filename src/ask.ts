/**
 * The smallest possible grammar for the ask box.
 *
 * There is no model here on purpose: a family chart is a closed world, so
 * "how are Ada and Milo related" is a pattern match, not an inference. That
 * keeps every answer reproducible and keeps the whole app offline.
 */

import type { Person } from './relatives';

export type Ask =
  | { intent: 'relationship'; a: string; b: string }
  | { intent: 'neighbours'; who: string; which: 'parents' | 'children' | 'partners' }
  | { intent: 'person'; who: string }
  | { intent: 'empty' }
  | { intent: 'unknown'; text: string };

interface Match {
  id: string;
  start: number;
  end: number;
}

/** Every distinct way a person can be named in the box, longest first. */
function names(person: Person): string[] {
  const full = person.name.trim();
  const parts = full.split(/\s+/);
  const list = [full];
  const first = parts[0];
  if (first && parts.length > 1) list.push(first);
  return list;
}

export function findMentions(text: string, people: Person[]): Match[] {
  const haystack = text.toLowerCase();
  const candidates: Array<Match & { length: number }> = [];
  for (const person of people) {
    for (const name of names(person)) {
      const needle = name.toLowerCase();
      if (needle.length < 2) continue;
      let at = haystack.indexOf(needle);
      while (at !== -1) {
        const before = haystack[at - 1];
        const after = haystack[at + needle.length];
        const cleanStart = before === undefined || !/[a-z]/.test(before);
        const cleanEnd = after === undefined || !/[a-z]/.test(after);
        if (cleanStart && cleanEnd) {
          candidates.push({ id: person.id, start: at, end: at + needle.length, length: needle.length });
        }
        at = haystack.indexOf(needle, at + 1);
      }
    }
  }

  candidates.sort((l, r) => r.length - l.length || l.start - r.start);
  const taken: Match[] = [];
  for (const candidate of candidates) {
    const overlaps = taken.some((m) => candidate.start < m.end && candidate.end > m.start);
    if (overlaps) continue;
    taken.push({ id: candidate.id, start: candidate.start, end: candidate.end });
    if (taken.length >= 3) break;
  }
  return taken.sort((l, r) => l.start - r.start);
}

const ASKS = [
  { which: 'parents' as const, words: ['mother', 'father', 'parent', 'mum', 'mom', 'dad', 'born to'] },
  { which: 'children' as const, words: ['children', 'child', 'kids', 'kid', 'son', 'daughter'] },
  { which: 'partners' as const, words: ['partner', 'wife', 'husband', 'spouse', 'married', 'marry'] },
];

export function parseAsk(text: string, people: Person[]): Ask {
  const trimmed = text.trim();
  if (!trimmed) return { intent: 'empty' };

  const mentions = findMentions(trimmed, people);
  if (mentions.length >= 2) {
    const first = mentions[0] as Match;
    const second = mentions[1] as Match;
    return { intent: 'relationship', a: first.id, b: second.id };
  }

  if (mentions.length === 1) {
    const who = (mentions[0] as Match).id;
    const lower = trimmed.toLowerCase();
    for (const ask of ASKS) {
      if (ask.words.some((word) => lower.includes(word))) {
        return { intent: 'neighbours', who, which: ask.which };
      }
    }
    return { intent: 'person', who };
  }

  return { intent: 'unknown', text: trimmed };
}
