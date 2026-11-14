/**
 * A focused view of a big chart.
 *
 * A 900-person tree cannot be drawn at a readable size, and a judge should not
 * have to zoom to see one family. `subgraph` keeps the people within N steps
 * of one person — the neighbourhood that actually explains them — and the
 * layout keeps the absolute generation numbers so the rows stay meaningful.
 */

import type { Chart } from './relatives';

export interface Focused {
  chart: Chart;
  keep: Set<string>;
  /** how many people were left out */
  hidden: number;
}

export function subgraph(chart: Chart, center: string, radius: number): Focused {
  const near = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    near.set(a, [...(near.get(a) ?? []), b]);
    near.set(b, [...(near.get(b) ?? []), a]);
  };
  for (const edge of chart.parents) link(edge.from, edge.to);
  for (const edge of chart.partners) link(edge.from, edge.to);

  const keep = new Set<string>([center]);
  let frontier = [center];
  for (let step = 0; step < radius; step += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const other of near.get(id) ?? []) {
        if (keep.has(other)) continue;
        keep.add(other);
        next.push(other);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  const people = chart.people.filter((person) => keep.has(person.id));
  return {
    chart: {
      people,
      parents: chart.parents.filter((edge) => keep.has(edge.from) && keep.has(edge.to)),
      partners: chart.partners.filter((edge) => keep.has(edge.from) && keep.has(edge.to)),
    },
    keep,
    hidden: chart.people.length - people.length,
  };
}

/**
 * The person a big file should open on: the one with the most direct links,
 * because that is where the neighbourhood is worth looking at.
 */
export function busiestPerson(chart: Chart): string | null {
  const score = new Map<string, number>();
  for (const edge of chart.parents) {
    score.set(edge.from, (score.get(edge.from) ?? 0) + 1);
    score.set(edge.to, (score.get(edge.to) ?? 0) + 2);
  }
  for (const edge of chart.partners) {
    score.set(edge.from, (score.get(edge.from) ?? 0) + 1);
    score.set(edge.to, (score.get(edge.to) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestScore = -1;
  for (const person of chart.people) {
    const value = score.get(person.id) ?? 0;
    if (value > bestScore) {
      best = person.id;
      bestScore = value;
    }
  }
  return best;
}
