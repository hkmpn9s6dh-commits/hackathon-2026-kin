/**
 * Naming a blood relationship from two integers.
 *
 * `up`   = how many parent steps the first person climbs to the common ancestor
 * `down` = how many parent steps the common ancestor descends to the second person
 *
 * The pair is the whole answer: every English kinship term is a function of it,
 * plus the two people's sexes. Nothing else is consulted, which is why this file
 * has no imports and can be tested to death.
 */

export type Sex = 'F' | 'M' | 'X';

export interface KinTerm {
  /** as it would be printed mid-sentence, e.g. "second cousin once removed" */
  term: string;
  /** compact form for chips and captions, e.g. "2nd cousin once removed" */
  short: string;
}

const ORDINAL = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
];

function ordinal(n: number): string {
  const word = ORDINAL[n - 1];
  if (word) return word;
  const mod100 = n % 100;
  const mod10 = n % 10;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? 'th' : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

function times(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${n} times`;
}

/** "great-great-" up to three, then "4× great-" so a deep chart stays readable. */
function greats(k: number): string {
  if (k <= 0) return '';
  if (k <= 3) return 'great-'.repeat(k);
  return `${k}× great-`;
}

function pick(sex: Sex, female: string, male: string, neutral: string): string {
  if (sex === 'F') return female;
  if (sex === 'M') return male;
  return neutral;
}

function descendant(down: number, sex: Sex): string {
  if (down === 1) return pick(sex, 'daughter', 'son', 'child');
  return `${greats(down - 2)}${pick(sex, 'granddaughter', 'grandson', 'grandchild')}`;
}

function ancestor(up: number, sex: Sex): string {
  if (up === 1) return pick(sex, 'mother', 'father', 'parent');
  return `${greats(up - 2)}${pick(sex, 'grandmother', 'grandfather', 'grandparent')}`;
}

/**
 * The term for the second person, seen from the first.
 *
 * `fullSibling` only matters on the 1/1 case: siblings share a pair of parents,
 * half-siblings share one.
 */
export function kinTerm(up: number, down: number, from: Sex, to: Sex, fullSibling = true): KinTerm {
  if (up < 0 || down < 0) throw new RangeError('up and down must be >= 0');

  if (up === 0 && down === 0) return { term: 'the same person', short: 'same person' };

  // One of them is the other's ancestor.
  if (up === 0) return { term: descendant(down, to), short: descendant(down, to) };
  if (down === 0) return { term: ancestor(up, to), short: ancestor(up, to) };

  // Siblings.
  if (up === 1 && down === 1) {
    const base = pick(to, 'sister', 'brother', 'sibling');
    return fullSibling
      ? { term: base, short: base }
      : { term: `half-${base}`, short: `half-${base}` };
  }

  // A sibling's descendants: niece / nephew / grand-niece …
  if (up === 1) {
    const base = pick(to, 'niece', 'nephew', 'nibling');
    if (down === 2) return { term: base, short: base };
    const word = `${greats(down - 3)}${pick(to, 'grandniece', 'grandnephew', 'grandnibling')}`;
    return { term: word, short: word };
  }

  // An ancestor's siblings: aunt / uncle / great-aunt …
  if (down === 1) {
    const base = pick(to, 'aunt', 'uncle', 'aunt or uncle');
    if (up === 2) return { term: base, short: base };
    const word = `${greats(up - 3)}${pick(to, 'great-aunt', 'great-uncle', 'great-aunt or uncle')}`;
    return { term: word, short: word };
  }

  // Cousins, with the removed count.
  const degree = Math.min(up, down) - 1;
  const removed = Math.abs(up - down);
  const base = `${ordinal(degree)} cousin`;
  if (removed === 0) return { term: base, short: base };
  return { term: `${base} ${times(removed)} removed`, short: `${base} ${times(removed)} removed` };
}

/** Relation of `from` to `to`, i.e. how you would introduce the first one to the second. */
export function kinBetween(
  up: number,
  down: number,
  from: Sex,
  to: Sex,
  fullSibling = true,
): { forward: KinTerm; backward: KinTerm } {
  return {
    forward: kinTerm(up, down, from, to, fullSibling),
    backward: kinTerm(down, up, to, from, fullSibling),
  };
}
