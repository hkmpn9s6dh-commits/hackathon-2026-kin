import { describe, expect, it } from 'vitest';

import { parseAsk, findMentions } from '../src/ask';
import type { Person } from '../src/relatives';

const people: Person[] = [
  { id: 'ada', name: 'Ada Vell', sex: 'F' },
  { id: 'milo', name: 'Milo Vell', sex: 'M' },
  { id: 'theo', name: 'Theo Lind', sex: 'M' },
  { id: 'rosa', name: 'Rosa Vell', sex: 'F' },
  { id: 'wilma', name: 'Wilma de Groot', sex: 'F' },
];

describe('reading the ask box', () => {
  it('finds two names in a question', () => {
    expect(parseAsk('How are Ada and Milo related?', people)).toEqual({
      intent: 'relationship',
      a: 'ada',
      b: 'milo',
    });
  });

  it('reads the pair in the order they were typed', () => {
    expect(parseAsk('is Milo related to Theo', people)).toEqual({
      intent: 'relationship',
      a: 'milo',
      b: 'theo',
    });
  });

  it('takes two names and nothing else', () => {
    expect(parseAsk('Ada, Theo', people)).toEqual({ intent: 'relationship', a: 'ada', b: 'theo' });
  });

  it('matches on the first name when that is all someone types', () => {
    expect(parseAsk('how are Wilma and Ada related', people)).toEqual({
      intent: 'relationship',
      a: 'wilma',
      b: 'ada',
    });
  });

  it('does not match a name inside another word', () => {
    // "milord" contains "milo"
    const found = findMentions('milord is not a name', people);
    expect(found).toHaveLength(0);
  });

  it('prefers the longer name when one name contains another', () => {
    const found = findMentions('Ada Vell', people);
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe('ada');
  });

  it('answers a one-name question about parents', () => {
    expect(parseAsk('who is Milo’s mother', people)).toEqual({
      intent: 'neighbours',
      who: 'milo',
      which: 'parents',
    });
  });

  it('answers about children and partners', () => {
    expect(parseAsk('children of Ada', people)).toMatchObject({ intent: 'neighbours', which: 'children' });
    expect(parseAsk('is Rosa married', people)).toMatchObject({ intent: 'neighbours', which: 'partners' });
  });

  it('falls back to a single person', () => {
    expect(parseAsk('Theo', people)).toEqual({ intent: 'person', who: 'theo' });
  });

  it('says so when it cannot read the question', () => {
    expect(parseAsk('what is the weather', people)).toMatchObject({ intent: 'unknown' });
    expect(parseAsk('   ', people)).toEqual({ intent: 'empty' });
  });
});
