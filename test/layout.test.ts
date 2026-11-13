import { describe, expect, it } from 'vitest';

import { COL, layoutChart, computeGenerations } from '../src/layout';
import { SAMPLE_PARTNERS, SAMPLE_PEOPLE, SAMPLE_PARENTS } from '../src/sample';
import type { Chart } from '../src/relatives';

const chart: Chart = {
  people: SAMPLE_PEOPLE,
  parents: SAMPLE_PARENTS.map(([from, to]) => ({ from, to })),
  partners: SAMPLE_PARTNERS.map(([from, to]) => ({ from, to })),
};

const layout = layoutChart(chart);

describe('generations', () => {
  it('puts the grandmother above the great-grandson', () => {
    const gen = computeGenerations(chart);
    expect(gen.get('rosa')).toBe(0);
    expect(gen.get('ivo')).toBe(1);
    expect(gen.get('daan')).toBe(2);
    expect(gen.get('ada')).toBe(3);
    expect(gen.get('milo')).toBe(4);
  });

  it('gives a partner who married in the same row as their partner', () => {
    const gen = computeGenerations(chart);
    expect(gen.get('wilma')).toBe(gen.get('daan'));
    expect(gen.get('kasper')).toBe(gen.get('suze'));
    expect(gen.get('marta')).toBe(gen.get('ivo'));
  });

  it('never puts a child above a parent', () => {
    const gen = computeGenerations(chart);
    for (const edge of chart.parents) {
      expect(gen.get(edge.to)).toBeGreaterThan(gen.get(edge.from) as number);
    }
  });
});

describe('placing the chart', () => {
  it('places everybody', () => {
    expect(layout.placed.size).toBe(SAMPLE_PEOPLE.length);
  });

  it('keeps people in a row apart by at least one column', () => {
    for (const row of layout.rows) {
      const xs = row.map((id) => layout.placed.get(id)?.x ?? 0).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i += 1) {
        const gap = (xs[i] as number) - (xs[i - 1] as number);
        expect(gap).toBeGreaterThanOrEqual(COL - 0.5);
      }
    }
  });

  it('draws one descent path per child that has a parent', () => {
    const children = new Set(chart.parents.map((edge) => edge.to));
    expect(layout.links).toHaveLength(children.size);
  });

  it('hangs every child below the parents it points at', () => {
    for (const link of layout.links) {
      const child = layout.placed.get(link.child);
      expect(child).toBeDefined();
      expect((child as { y: number }).y).toBeGreaterThan(link.y);
      expect(link.busY).toBeGreaterThan(link.y);
      expect(link.busY).toBeLessThan((child as { y: number }).y);
    }
  });

  it('keeps a couple on one row', () => {
    for (const couple of layout.couples) {
      const a = layout.placed.get(couple.a);
      const b = layout.placed.get(couple.b);
      expect(a?.gen).toBe(b?.gen);
    }
  });

  it('stands a twice-married person between their partners', () => {
    const row = layout.rows[1] ?? [];
    const order = row.map((id) => layout.placed.get(id)?.x ?? 0);
    const at = (id: string): number => row.indexOf(id);
    expect(at('ivo')).toBeGreaterThan(-1);
    // Marta and Hedy are both Ivo's partners; both must be adjacent to him.
    const neighboursOfIvo = [order[at('ivo') - 1], order[at('ivo') + 1]];
    expect(neighboursOfIvo).toContain(layout.placed.get('marta')?.x);
    expect(neighboursOfIvo).toContain(layout.placed.get('hedy')?.x);
  });

  it('reports a box big enough for the marks', () => {
    expect(layout.width).toBeGreaterThan(800);
    expect(layout.height).toBeGreaterThan(600);
  });
});
