import { describe, expect, it } from 'vitest';

import { kinTerm, kinBetween } from '../src/kinship';

describe('kinTerm: the whole table of English kinship', () => {
  const cases: Array<[number, number, string, string?]> = [
    [0, 0, 'the same person'],
    [1, 0, 'mother'],
    [0, 1, 'daughter'],
    [2, 0, 'grandfather'],
    [0, 2, 'grandson'],
    [3, 0, 'great-grandmother'],
    [0, 3, 'great-granddaughter'],
    [4, 0, 'great-great-grandfather'],
    [0, 4, 'great-great-grandson'],
    [1, 1, 'sister'],
    [1, 2, 'niece'],
    [1, 3, 'grandniece'],
    [1, 4, 'great-grandniece'],
    [2, 1, 'uncle'],
    [3, 1, 'great-uncle'],
    [4, 1, 'great-great-uncle'],
    [2, 2, 'first cousin'],
    [2, 3, 'first cousin once removed'],
    [3, 2, 'first cousin once removed'],
    [2, 4, 'first cousin twice removed'],
    [3, 3, 'second cousin'],
    [3, 4, 'second cousin once removed'],
    [4, 3, 'second cousin once removed'],
    [4, 4, 'third cousin'],
    [5, 5, 'fourth cousin'],
    [5, 3, 'second cousin twice removed'],
    [12, 12, '11th cousin'],
  ];

  for (const [up, down, expected] of cases) {
    it(`${up} up / ${down} down reads "${expected}"`, () => {
      const sex = expected.includes('mother') || expected.includes('aunt') || expected.includes('sister') || expected.includes('niece') || expected.includes('daughter') ? 'F' : 'M';
      expect(kinTerm(up, down, 'M', sex).term).toBe(expected);
    });
  }

  it('picks the sex of the person being named, not of the speaker', () => {
    expect(kinTerm(1, 0, 'F', 'F').term).toBe('mother');
    expect(kinTerm(1, 0, 'F', 'M').term).toBe('father');
    expect(kinTerm(0, 1, 'M', 'F').term).toBe('daughter');
    expect(kinTerm(2, 2, 'F', 'M').term).toBe('first cousin');
  });

  it('falls back to a neutral word when the sex is not recorded', () => {
    expect(kinTerm(1, 0, 'X', 'X').term).toBe('parent');
    expect(kinTerm(0, 1, 'X', 'X').term).toBe('child');
    expect(kinTerm(1, 1, 'X', 'X').term).toBe('sibling');
    expect(kinTerm(2, 1, 'X', 'X').term).toBe('aunt or uncle');
  });

  it('separates half siblings', () => {
    expect(kinTerm(1, 1, 'M', 'F', false).term).toBe('half-sister');
    expect(kinTerm(1, 1, 'M', 'M', false).term).toBe('half-brother');
    expect(kinTerm(1, 1, 'M', 'F', true).term).toBe('sister');
  });

  it('reads both ways', () => {
    const pair = kinBetween(3, 2, 'F', 'M');
    expect(pair.forward.term).toBe('first cousin once removed');
    expect(pair.backward.term).toBe('first cousin once removed');
  });

  it('reads both ways where the direction matters', () => {
    const pair = kinBetween(1, 2, 'F', 'F');
    expect(pair.forward.term).toBe('niece');
    expect(pair.backward.term).toBe('aunt');
  });

  it('refuses negative distances', () => {
    expect(() => kinTerm(-1, 2, 'F', 'M')).toThrow(RangeError);
  });
});
