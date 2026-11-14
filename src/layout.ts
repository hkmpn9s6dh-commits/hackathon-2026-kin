/**
 * The chart, not a hairball.
 *
 * A family is not a general graph — it is a set of rows, one per generation,
 * with couples standing side by side and children hung below their parents'
 * marriage line. Laying it out that way is what turns forty edges into
 * something a person can read in one look, so this module refuses to use a
 * force simulation.
 *
 * The pipeline is the classic one: generation → blocks (a couple is one block)
 * → order inside the row by the barycentre of the parents → centre children
 * under parents → done.
 */

import type { Chart, Person } from './relatives';

export const ROW = 146;
export const COL = 168;
export const COUPLE_GAP = 46;
export const PAD_X = 132;
export const PAD_Y = 96;

export interface Placed {
  person: Person;
  x: number;
  y: number;
  gen: number;
}

export interface ParentLink {
  child: string;
  parents: string[];
  x: number;
  y: number;
  busY: number;
  childX: number;
  childY: number;
}

export interface Layout {
  placed: Map<string, Placed>;
  rows: string[][];
  links: ParentLink[];
  couples: Array<{ a: string; b: string }>;
  width: number;
  height: number;
  /** every person's row index, for tests */
  generation: Map<string, number>;
}

export function computeGenerations(chart: Chart): Map<string, number> {
  const parentsOf = new Map<string, string[]>();
  for (const edge of chart.parents) {
    const list = parentsOf.get(edge.to) ?? [];
    list.push(edge.from);
    parentsOf.set(edge.to, list);
  }

  const gen = new Map<string, number>();
  for (const person of chart.people) gen.set(person.id, 0);

  // Longest path from a root. 24 passes is far more than any real family
  // needs and it terminates even if the data contains a cycle.
  for (let pass = 0; pass < 24; pass += 1) {
    let changed = false;
    for (const edge of chart.parents) {
      const parentGen = gen.get(edge.from) ?? 0;
      const childGen = gen.get(edge.to) ?? 0;
      if (childGen < parentGen + 1) {
        gen.set(edge.to, parentGen + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // A partner who married in has no parents here; they take their partner's row.
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const edge of chart.partners) {
      const ga = gen.get(edge.from);
      const gb = gen.get(edge.to);
      if (ga === undefined || gb === undefined || ga === gb) continue;
      const aBlood = parentsOf.has(edge.from);
      const bBlood = parentsOf.has(edge.to);
      if (aBlood && !bBlood) {
        gen.set(edge.to, ga);
        changed = true;
      } else if (bBlood && !aBlood) {
        gen.set(edge.from, gb);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return gen;
}

function blocksOf(ids: string[], partnerPairs: Array<[string, string]>): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root) as string;
    return root;
  };
  for (const id of ids) parent.set(id, id);
  for (const [a, b] of partnerPairs) {
    if (!parent.has(a) || !parent.has(b)) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    const list = groups.get(root) ?? [];
    list.push(id);
    groups.set(root, list);
  }
  // A person married twice has to stand between the two partners, or the
  // second union line crosses the first spouse's name. Walk the partner
  // edges and keep each chain in the order it was walked.
  return [...groups.values()].map((group) => orderBlock(group, partnerPairs));
}

/** Order a block so that partners end up next to each other. */
function orderBlock(group: string[], partnerPairs: Array<[string, string]>): string[] {
  if (group.length < 3) return group;
  const inside = new Set(group);
  const near = new Map<string, string[]>();
  for (const [a, b] of partnerPairs) {
    if (!inside.has(a) || !inside.has(b)) continue;
    const listA = near.get(a) ?? [];
    listA.push(b);
    near.set(a, listA);
    const listB = near.get(b) ?? [];
    listB.push(a);
    near.set(b, listB);
  }
  if (near.size === 0) return group;
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    for (const next of near.get(id) ?? []) walk(next);
  };
  // start at an endpoint so the chain is walked in one direction
  const start =
    group.find((id) => (near.get(id) ?? []).length === 1) ??
    group.find((id) => near.has(id)) ??
    group[0];
  if (start) walk(start);
  for (const id of group) walk(id);
  return out;
}

export function layoutChart(chart: Chart): Layout {
  const gen = computeGenerations(chart);
  const byId = new Map(chart.people.map((person) => [person.id, person]));

  const maxGen = Math.max(0, ...[...gen.values()]);
  const rows: string[][] = Array.from({ length: maxGen + 1 }, () => []);
  for (const person of chart.people) rows[gen.get(person.id) ?? 0]?.push(person.id);

  const partnerPairs: Array<[string, string]> = chart.partners.map((edge) => [edge.from, edge.to]);
  const parentsOf = new Map<string, string[]>();
  for (const edge of chart.parents) {
    const list = parentsOf.get(edge.to) ?? [];
    list.push(edge.from);
    parentsOf.set(edge.to, list);
  }

  const x = new Map<string, number>();
  const blocksByRow: string[][][] = [];

  for (let row = 0; row < rows.length; row += 1) {
    const ids = rows[row] ?? [];
    let blocks = blocksOf(ids, partnerPairs);

    if (row > 0) {
      const centreOf = (id: string): number | null => {
        const ps = parentsOf.get(id);
        if (!ps || ps.length === 0) return null;
        const xs = ps.map((p) => x.get(p)).filter((v): v is number => typeof v === 'number');
        if (xs.length === 0) return null;
        return xs.reduce((sum, v) => sum + v, 0) / xs.length;
      };
      const score = (block: string[]): number => {
        const values = block.map(centreOf).filter((v): v is number => v !== null);
        if (values.length === 0) return Number.POSITIVE_INFINITY;
        return values.reduce((sum, v) => sum + v, 0) / values.length;
      };
      // two passes: sort, place, sort again now that positions exist
      for (let pass = 0; pass < 2; pass += 1) {
        blocks = blocks
          .map((block, index) => ({ block, index, score: score(block) }))
          .sort((l, r) => {
            if (l.score === r.score) return l.index - r.index;
            if (l.score === Number.POSITIVE_INFINITY) return 1;
            if (r.score === Number.POSITIVE_INFINITY) return -1;
            return l.score - r.score;
          })
          .map((entry) => entry.block);
        assignRow(blocks, x);
      }
    }
    assignRow(blocks, x);
    blocksByRow[row] = blocks;
  }

  // centre each couple/block under the parents it came from, without collisions
  for (let pass = 0; pass < 3; pass += 1) {
    for (let row = 1; row < rows.length; row += 1) {
      const blocks = blocksByRow[row] ?? [];
      for (const block of blocks) {
        const parentXs: number[] = [];
        for (const id of block) {
          for (const p of parentsOf.get(id) ?? []) {
            const value = x.get(p);
            if (typeof value === 'number') parentXs.push(value);
          }
        }
        if (parentXs.length === 0) continue;
        const target = parentXs.reduce((sum, v) => sum + v, 0) / parentXs.length;
        const left = x.get(block[0] as string);
        if (typeof left !== 'number') continue;
        const centre = left + ((block.length - 1) * COL) / 2;
        const delta = (target - centre) * 0.55;
        if (Math.abs(delta) < 1) continue;
        for (const id of block) x.set(id, (x.get(id) as number) + delta);
      }
      resolveCollisions(blocks, x);
    }
  }

  // normalise into the positive quadrant with padding
  const xs = [...x.values()];
  const minX = Math.min(...xs);
  for (const [id, value] of x) x.set(id, value - minX + PAD_X);

  const placed = new Map<string, Placed>();
  for (const [id, value] of x) {
    const person = byId.get(id);
    if (!person) continue;
    const row = gen.get(id) ?? 0;
    placed.set(id, { person, x: value, y: PAD_Y + row * ROW, gen: row });
  }

  const links: ParentLink[] = [];
  const groups = new Map<string, string[]>();
  for (const edge of chart.parents) {
    const key = (parentsOf.get(edge.to) ?? []).slice().sort().join('\u0000');
    const list = groups.get(key) ?? [];
    if (!list.includes(edge.to)) list.push(edge.to);
    groups.set(key, list);
  }
  for (const [key, children] of groups) {
    const parentIds = key.split('\u0000').filter(Boolean);
    const parentPlaced = parentIds.map((id) => placed.get(id)).filter((p): p is Placed => Boolean(p));
    if (parentPlaced.length === 0) continue;
    const px = parentPlaced.reduce((sum, p) => sum + p.x, 0) / parentPlaced.length;
    const py = Math.max(...parentPlaced.map((p) => p.y));
    for (const child of children) {
      const target = placed.get(child);
      if (!target) continue;
      links.push({
        child,
        parents: parentIds,
        x: px,
        y: py,
        busY: py + ROW * 0.5,
        childX: target.x,
        childY: target.y,
      });
    }
  }

  const width = Math.max(...[...placed.values()].map((p) => p.x), PAD_X) + PAD_X;
  const height = PAD_Y + maxGen * ROW + PAD_Y;

  // rows in final left-to-right order, which is what a renderer or a test wants
  const rowsInPlace = rows.map((row) => [...row].sort((a, b) => (x.get(a) ?? 0) - (x.get(b) ?? 0)));

  return {
    placed,
    rows: rowsInPlace,
    links,
    couples: chart.partners.map((edge) => ({ a: edge.from, b: edge.to })),
    width,
    height,
    generation: gen,
  };
}

function assignRow(blocks: string[][], x: Map<string, number>): void {
  let cursor = 0;
  for (const block of blocks) {
    for (const id of block) {
      x.set(id, cursor);
      cursor += COL;
    }
  }
}

/** Keep a fixed gap between neighbouring people in one row. */
function resolveCollisions(blocks: string[][], x: Map<string, number>): void {
  const ordered = blocks.flat();
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = x.get(ordered[i - 1] as string);
    const current = x.get(ordered[i] as string);
    if (prev === undefined || current === undefined) continue;
    if (current - prev < COL) x.set(ordered[i] as string, prev + COL);
  }
}
