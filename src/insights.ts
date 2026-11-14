/**
 * What a family graph can tell you that a spreadsheet cannot.
 *
 * These are the questions people actually ask when they open a family file:
 * did cousins marry, who connects these three, how deep does this tree go,
 * and what is missing. Every answer below is a walk of the graph.
 */

import type { Db, Row } from './db';
import { computeGenerations } from './layout';
import { findRelationship, type Chart, type Person } from './relatives';
import type { KinTerm } from './kinship';

export interface ConsanguineousPair {
  a: Person;
  b: Person;
  term: KinTerm;
  shared: number;
  up: number;
  down: number;
}

export interface Insights {
  people: number;
  parentLinks: number;
  partnerLinks: number;
  generations: number;
  deepest: { person: Person; generation: number } | null;
  roots: number;
  undated: Person[];
  isolated: Person[];
  surnames: number;
  span: { from: number; to: number } | null;
  consanguineous: ConsanguineousPair[];
}

const ANCESTORS_CYPHER = `MATCH p = (a:Person {id: $id})<-[:PARENT*0..10]-(ca:Person)
RETURN ca.id AS id, length(p) AS depth`;

export function surnameOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? (parts[parts.length - 1] as string) : '';
}

/** Every ancestor of one person, with the shortest number of steps to each. */
export function ancestorsOf(db: Db, id: string): Map<string, number> {
  const depth = new Map<string, number>();
  for (const row of db.run(ANCESTORS_CYPHER, { id }).rows) {
    const ancestorId = String((row as Row)['id']);
    const steps = Number((row as Row)['depth']);
    const known = depth.get(ancestorId);
    if (known === undefined || steps < known) depth.set(ancestorId, steps);
  }
  return depth;
}

/**
 * The ancestor a group of people have in common, closest first. This is the
 * question "who connects these three?" — a single query per person and one
 * intersection, which is exactly what a graph is for.
 */
export function commonAncestorsOf(
  db: Db,
  chart: Chart,
  ids: string[],
): Array<{ ancestor: Person; distances: number[] }> {
  if (ids.length < 2) return [];
  const maps = ids.map((id) => ancestorsOf(db, id));
  const first = maps[0];
  if (!first) return [];

  const out: Array<{ ancestor: Person; distances: number[] }> = [];
  for (const [ancestorId, depth] of first) {
    const distances = [depth];
    let everywhere = true;
    for (const map of maps.slice(1)) {
      const value = map.get(ancestorId);
      if (value === undefined) {
        everywhere = false;
        break;
      }
      distances.push(value);
    }
    if (!everywhere) continue;
    const person = chart.people.find((p) => p.id === ancestorId);
    if (!person) continue;
    out.push({ ancestor: person, distances });
  }

  out.sort((l, r) => {
    const sum = (row: { distances: number[] }) => row.distances.reduce((a, b) => a + b, 0);
    return sum(l) - sum(r) || l.ancestor.name.localeCompare(r.ancestor.name);
  });
  return out;
}

/**
 * Couples who are related by blood. The most common real finding in a family
 * file, and the one nobody can eyeball.
 *
 * Reports the relationship, not an inbreeding coefficient: a coefficient
 * depends on haplotypes we do not have, and inventing one would be worse than
 * saying what the graph knows.
 */
const COUSIN_CYPHER = `MATCH (a:Person)-[:PARTNER]-(b:Person)
MATCH p = (a)<-[:PARENT*1..7]-(ca:Person)-[:PARENT*1..7]->(b)
RETURN DISTINCT a.id AS a, b.id AS b
LIMIT 300`;

/**
 * Couples who are related by blood — one query for the whole chart, not one
 * per couple, because a 2,000-person file has 500 partnerships and a query
 * each would be a minute of waiting for a list that is usually empty.
 *
 * Reports the relationship, not an inbreeding coefficient: a coefficient
 * depends on haplotypes we do not have, and inventing one would be worse than
 * saying what the graph knows.
 */
export function consanguineousCouples(db: Db, chart: Chart): ConsanguineousPair[] {
  const found = db.run(COUSIN_CYPHER).rows as Array<{ a: string; b: string }>;
  const out: ConsanguineousPair[] = [];
  for (const row of found.slice(0, 40)) {
    const a = chart.people.find((p) => p.id === row.a);
    const b = chart.people.find((p) => p.id === row.b);
    if (!a || !b) continue;
    const verdict = findRelationship(db, a.id, b.id).verdict;
    if (verdict.kind !== 'blood') continue;
    out.push({
      a,
      b,
      term: verdict.forward,
      shared: verdict.shared,
      up: verdict.up,
      down: verdict.down,
    });
  }
  return out.sort((l, r) => l.up + l.down - (r.up + r.down));
}

export function analyse(db: Db, chart: Chart): Insights {
  const generation = computeGenerations(chart);
  let deepest: { person: Person; generation: number } | null = null;
  for (const person of chart.people) {
    const gen = generation.get(person.id) ?? 0;
    if (!deepest || gen > deepest.generation) deepest = { person, generation: gen };
  }

  const parents = new Set(chart.parents.map((edge) => edge.to));
  const touched = new Set<string>();
  for (const edge of chart.parents) {
    touched.add(edge.from);
    touched.add(edge.to);
  }
  for (const edge of chart.partners) {
    touched.add(edge.from);
    touched.add(edge.to);
  }

  const born = chart.people.map((p) => p.born).filter((year): year is number => typeof year === 'number');
  const died = chart.people.map((p) => p.died).filter((year): year is number => typeof year === 'number');

  return {
    people: chart.people.length,
    parentLinks: chart.parents.length,
    partnerLinks: chart.partners.length,
    generations: chart.people.length === 0 ? 0 : Math.max(...[...generation.values()]) + 1,
    deepest,
    roots: chart.people.filter((person) => !parents.has(person.id)).length,
    undated: chart.people.filter((person) => person.born === undefined),
    isolated: chart.people.filter((person) => !touched.has(person.id)),
    surnames: new Set(chart.people.map((person) => surnameOf(person.name)).filter(Boolean)).size,
    span:
      born.length === 0
        ? null
        : { from: Math.min(...born), to: Math.max(...(died.length > 0 ? died : born)) },
    consanguineous: consanguineousCouples(db, chart),
  };
}

/**
 * Years two people were alive at the same time — the human fact a chart of
 * lines does not show. Open-ended lifespans run to `now`.
 */
export function livedTogether(a: Person, b: Person, now = new Date().getFullYear()): number | null {
  if (a.born === undefined || b.born === undefined) return null;
  const start = Math.max(a.born, b.born);
  const end = Math.min(a.died ?? now, b.died ?? now);
  return Math.max(0, end - start);
}

/**
 * The deepest unbroken parent line, as a list of people. "Five generations"
 * is a number; the chain makes it a story about a family.
 */
export function longestChain(chart: Chart): Person[] {
  if (chart.people.length === 0) return [];
  const generation = computeGenerations(chart);
  const parentsOf = new Map<string, string[]>();
  for (const edge of chart.parents) {
    parentsOf.set(edge.to, [...(parentsOf.get(edge.to) ?? []), edge.from]);
  }

  let deepest = chart.people[0] as Person;
  for (const person of chart.people) {
    if ((generation.get(person.id) ?? 0) > (generation.get(deepest.id) ?? 0)) deepest = person;
  }

  const chain: Person[] = [deepest];
  let cursor = deepest;
  for (let step = 0; step < 64; step += 1) {
    const parents = parentsOf.get(cursor.id) ?? [];
    const next = parents
      .map((id) => chart.people.find((p) => p.id === id))
      .filter((p): p is Person => Boolean(p))
      .sort((a, b) => (generation.get(b.id) ?? 0) - (generation.get(a.id) ?? 0))[0];
    if (!next) break;
    chain.unshift(next);
    cursor = next;
  }
  return chain;
}
