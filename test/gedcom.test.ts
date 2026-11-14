import { describe, expect, it } from 'vitest';

import { fromChart, nameOf, parseGedcom, toChart, yearOf } from '../src/gedcom';
import { SAMPLE_PARENTS, SAMPLE_PARTNERS, SAMPLE_PEOPLE } from '../src/sample';
import type { Chart } from '../src/relatives';

const TEXT = `\uFEFF0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Rosa /Vell/
1 SEX F
1 BIRT
2 DATE 12 MAR 1902
1 DEAT
2 DATE ABT 1979
0 @I2@ INDI
1 NAME Emil /Vell/
1 SEX M
1 BIRT
2 DATE 1899
0 @I3@ INDI
1 NAME Ada /Vell/
1 SEX F
1 BIRT
2 DATE 1986
0 @I4@ INDI
1 NAME Theo /Lind/
1 SEX M
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 CHIL @I3@
0 @F2@ FAM
1 HUSB @I9@
1 CHIL @I4@
0 TRLR
`;

describe('reading a GEDCOM file', () => {
  const gedcom = parseGedcom(TEXT);

  it('reads every person, with the byte-order mark and CRLF in the way', () => {
    expect(gedcom.people.map((p) => p.name)).toEqual(['Rosa Vell', 'Emil Vell', 'Ada Vell', 'Theo Lind']);
  });

  it('turns dates into years, including qualifiers', () => {
    expect(gedcom.people[0]?.born).toBe(1902);
    expect(gedcom.people[0]?.died).toBe(1979);
    expect(gedcom.people[1]?.died).toBeUndefined();
  });

  it('reads sex', () => {
    expect(gedcom.people.map((p) => p.sex)).toEqual(['F', 'M', 'F', 'M']);
  });

  it('makes partner and parent edges from the family records', () => {
    const chart = toChart(gedcom);
    expect(chart.partners).toEqual([{ from: 'I2', to: 'I1' }]);
    expect(chart.parents).toEqual([
      { from: 'I2', to: 'I3' },
      { from: 'I1', to: 'I3' },
    ]);
  });

  it('warns about a family that points at somebody who is not in the file', () => {
    expect(gedcom.warnings.some((warning) => warning.includes('I9'))).toBe(true);
    // and drops the dangling parent rather than inventing a person
    const chart = toChart(gedcom);
    expect(chart.people.map((p) => p.id)).not.toContain('I9');
    expect(chart.parents.some((edge) => edge.from === 'I9')).toBe(false);
  });

  it('says so when there is nothing to read', () => {
    const empty = parseGedcom('0 HEAD\n0 TRLR\n');
    expect(empty.people).toHaveLength(0);
    expect(empty.warnings.join(' ')).toContain('no INDI');
  });
});

describe('small helpers', () => {
  it('strips the surname slashes', () => {
    expect(nameOf('Wilma /de Groot/')).toBe('Wilma de Groot');
    expect(nameOf('Ada //')).toBe('Ada');
    expect(nameOf('  ')).toBe('Unnamed');
  });

  it('prefers the four-digit year over the day', () => {
    expect(yearOf('12 MAR 1902')).toBe(1902);
    expect(yearOf('ABT 1855')).toBe(1855);
    expect(yearOf('BEF 1900')).toBe(1900);
    expect(yearOf('unknown')).toBeUndefined();
  });
});

describe('the round trip: what goes out is what comes back', () => {
  const chart: Chart = {
    people: SAMPLE_PEOPLE,
    parents: SAMPLE_PARENTS.map(([from, to]) => ({ from, to })),
    partners: SAMPLE_PARTNERS.map(([from, to]) => ({ from, to })),
  };

  it('keeps every person, name, sex and year', () => {
    const again = toChart(parseGedcom(fromChart(chart)));
    expect(again.people).toHaveLength(chart.people.length);
    for (const person of chart.people) {
      const back = again.people.find((p) => p.id === person.id);
      expect(back?.name).toBe(person.name);
      expect(back?.sex).toBe(person.sex);
      expect(back?.born).toBe(person.born);
      expect(back?.died).toBe(person.died);
    }
  });

  it('keeps every partner edge', () => {
    const again = toChart(parseGedcom(fromChart(chart)));
    const key = (e: { from: string; to: string }) => [e.from, e.to].sort().join('|');
    expect(new Set(again.partners.map(key))).toEqual(new Set(chart.partners.map(key)));
  });

  it('keeps every parent edge', () => {
    const again = toChart(parseGedcom(fromChart(chart)));
    const key = (e: { from: string; to: string }) => `${e.from}>${e.to}`;
    expect(new Set(again.parents.map(key))).toEqual(new Set(chart.parents.map(key)));
  });

  it('writes a file that starts with a header and ends with TRLR', () => {
    const text = fromChart(chart);
    expect(text.startsWith('0 HEAD')).toBe(true);
    expect(text.trimEnd().endsWith('0 TRLR')).toBe(true);
    expect(text).toContain('0 @rosa@ INDI');
    expect(text).toContain('1 NAME Rosa /Vell/');
  });
});
