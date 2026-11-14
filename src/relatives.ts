/**
 * Every question the app can answer, and the Cypher that answers it.
 *
 * The graph does the walking: a relationship is a two-legged path through a
 * shared ancestor, and "how related" is the pair of leg lengths. Nothing is
 * precomputed and nothing is cached, so adding one person re-answers every
 * question in the chart at once.
 */

import type { Db, Row } from './db';
import { kinTerm, type KinTerm, type Sex } from './kinship';

export interface Person {
  id: string;
  name: string;
  sex: Sex;
  born?: number;
  died?: number;
}

export interface Edge {
  from: string;
  to: string;
}

export interface Chart {
  people: Person[];
  parents: Edge[];
  partners: Edge[];
}

export interface BloodVerdict {
  kind: 'blood';
  a: Person;
  b: Person;
  up: number;
  down: number;
  forward: KinTerm;
  backward: KinTerm;
  ancestor: Person;
  shared: number;
  fullSibling: boolean;
  /** ids from a to b, through the common ancestor */
  path: string[];
}

export interface MarriageVerdict {
  kind: 'marriage';
  a: Person;
  b: Person;
  /** the two blood anchors the tie runs between */
  anchorA: Person;
  anchorB: Person;
  /** anchorB is anchorA's <term> */
  term: KinTerm;
  /** is A married to anchorA? */
  aLinked: boolean;
  bLinked: boolean;
  path: string[];
}

export interface SharedPartnerVerdict {
  kind: 'shared-partner';
  a: Person;
  b: Person;
  hinge: Person;
}

export interface SelfVerdict {
  kind: 'self';
  person: Person;
}

export interface NoneVerdict {
  kind: 'none';
  a: Person;
  b: Person;
}

export type Verdict = BloodVerdict | MarriageVerdict | SharedPartnerVerdict | SelfVerdict | NoneVerdict;

const MAX_LEGS = 6;

const RELATIONSHIP_CYPHER = `MATCH up = (a:Person {id: $a})<-[:PARENT*0..${MAX_LEGS}]-(ca:Person)
MATCH down = (ca)-[:PARENT*0..${MAX_LEGS}]->(b:Person {id: $b})
RETURN ca.id AS ancestor, length(up) AS up, length(down) AS down,
       [n IN nodes(up) | n.id] AS upIds,
       [n IN nodes(down) | n.id] AS downIds
ORDER BY up + down ASC, abs(up - down) ASC, ancestor ASC
LIMIT 1`;

const SHARED_CYPHER = `MATCH (a:Person {id: $a})<-[:PARENT*0..${MAX_LEGS}]-(ca:Person)-[:PARENT*0..${MAX_LEGS}]->(b:Person {id: $b})
RETURN count(DISTINCT ca) AS shared`;

const FULL_SIBLING_CYPHER = `MATCH (a:Person {id: $a})<-[:PARENT]-(p:Person)-[:PARENT]->(b:Person {id: $b})
RETURN count(p) AS sharedParents`;

/** How many parents of this person the chart actually knows about. */
const PARENT_COUNT_CYPHER = `MATCH (p:Person {id: $id})<-[:PARENT]-(q:Person) RETURN count(q) AS n`;

const MARRIAGE_CYPHER = `MATCH (a:Person {id: $a}), (b:Person {id: $b})
MATCH p = shortestPath((a)-[:PARENT|PARTNER*0..5]-(b))
RETURN [n IN nodes(p) | n.id] AS ids, length(p) AS links
ORDER BY links ASC
LIMIT 1`;

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : String(value ?? '');
}

function num(row: Row, key: string): number {
  const value = row[key];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function strings(row: Row, key: string): string[] {
  const value = row[key];
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

export function toPerson(row: Row): Person {
  const born = row['born'];
  const died = row['died'];
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    sex: (text(row, 'sex') || 'X') as Sex,
    ...(typeof born === 'number' ? { born } : {}),
    ...(typeof died === 'number' ? { died } : {}),
  };
}

export function loadChart(db: Db): Chart {
  const people = db
    .run('MATCH (p:Person) RETURN p.id AS id, p.name AS name, p.sex AS sex, p.born AS born, p.died AS died')
    .rows.map(toPerson);

  const parents = db
    .run('MATCH (p:Person)-[:PARENT]->(c:Person) RETURN p.id AS from, c.id AS to ORDER BY from, to')
    .rows.map((row) => ({ from: text(row, 'from'), to: text(row, 'to') }));

  const seen = new Set<string>();
  const partners: Edge[] = [];
  for (const row of db.run('MATCH (a:Person)-[:PARTNER]->(b:Person) RETURN a.id AS from, b.id AS to').rows) {
    const from = text(row, 'from');
    const to = text(row, 'to');
    const key = [from, to].sort().join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    partners.push({ from, to });
  }

  return { people, parents, partners };
}

export function findPerson(chart: Chart, id: string): Person | undefined {
  return chart.people.find((person) => person.id === id);
}

export interface Answer {
  verdict: Verdict;
  cypher: string;
  elapsedMs: number;
}

export function findRelationship(db: Db, aId: string, bId: string): Answer {
  const chart = loadChart(db);
  const a = findPerson(chart, aId);
  const b = findPerson(chart, bId);
  if (!a || !b) throw new Error('unknown person');

  const started = performance.now();

  if (aId === bId) {
    return { verdict: { kind: 'self', person: a }, cypher: RELATIONSHIP_CYPHER, elapsedMs: 0 };
  }

  const hit = db.run(RELATIONSHIP_CYPHER, { a: aId, b: bId }).rows[0];
  if (hit) {
    const up = num(hit, 'up');
    const down = num(hit, 'down');
    const ancestor = findPerson(chart, text(hit, 'ancestor'));
    if (ancestor) {
      const shared = num(db.run(SHARED_CYPHER, { a: aId, b: bId }).rows[0] ?? {}, 'shared');
      // Half means "one shared parent out of two known". When the chart only
      // records one parent for either of them, there is nothing to compare, so
      // the honest answer is the plain word rather than a claim of halfness.
      const sharedParents = num(
        db.run(FULL_SIBLING_CYPHER, { a: aId, b: bId }).rows[0] ?? {},
        'sharedParents',
      );
      const knownParents = Math.min(
        num(db.run(PARENT_COUNT_CYPHER, { id: aId }).rows[0] ?? {}, 'n'),
        num(db.run(PARENT_COUNT_CYPHER, { id: bId }).rows[0] ?? {}, 'n'),
      );
      const fullSibling = up === 1 && down === 1 ? sharedParents >= 2 || knownParents < 2 : true;
      const upIds = strings(hit, 'upIds');
      const downIds = strings(hit, 'downIds');
      const path = [...upIds, ...downIds.slice(1)];
      return {
        verdict: {
          kind: 'blood',
          a,
          b,
          up,
          down,
          forward: kinTerm(up, down, a.sex, b.sex, fullSibling),
          backward: kinTerm(down, up, b.sex, a.sex, fullSibling),
          ancestor,
          shared,
          fullSibling,
          path,
        },
        cypher: RELATIONSHIP_CYPHER,
        elapsedMs: performance.now() - started,
      };
    }
  }

  const marriage = explainMarriage(db, chart, a, b);
  if (marriage) {
    return { verdict: marriage, cypher: MARRIAGE_CYPHER, elapsedMs: performance.now() - started };
  }

  return {
    verdict: { kind: 'none', a, b },
    cypher: MARRIAGE_CYPHER,
    elapsedMs: performance.now() - started,
  };
}

export interface Neighbours {
  parents: Person[];
  children: Person[];
  partners: Person[];
}

export function neighbours(db: Db, id: string): Neighbours {
  const map = (cypher: string) =>
    db.run(cypher, { id }).rows.map((row) => ({
      id: text(row, 'id'),
      name: text(row, 'name'),
      sex: (text(row, 'sex') || 'X') as Sex,
    }));
  return {
    parents: map('MATCH (p:Person)<-[:PARENT]-(q:Person) WHERE p.id = $id RETURN q.id AS id, q.name AS name, q.sex AS sex ORDER BY name'),
    children: map('MATCH (p:Person)-[:PARENT]->(q:Person) WHERE p.id = $id RETURN q.id AS id, q.name AS name, q.sex AS sex ORDER BY name'),
    partners: map('MATCH (p:Person)-[:PARTNER]-(q:Person) WHERE p.id = $id RETURN q.id AS id, q.name AS name, q.sex AS sex ORDER BY name'),
  };
}

/** Every pair in the chart that shares an ancestor at 3/3 or closer — the "marriage between cousins" check. */
export function closeKinPairs(db: Db, chart: Chart): Array<{ a: string; b: string; up: number; down: number }> {
  const out: Array<{ a: string; b: string; up: number; down: number }> = [];
  for (let i = 0; i < chart.people.length; i += 1) {
    for (let j = i + 1; j < chart.people.length; j += 1) {
      const a = chart.people[i];
      const b = chart.people[j];
      if (!a || !b) continue;
      const row = db.run(RELATIONSHIP_CYPHER, { a: a.id, b: b.id }).rows[0];
      if (!row) continue;
      const up = num(row, 'up');
      const down = num(row, 'down');
      if (up >= 1 && down >= 1 && up <= 3 && down <= 3) out.push({ a: a.id, b: b.id, up, down });
    }
  }
  return out;
}

interface BloodHit {
  up: number;
  down: number;
  upIds: string[];
  downIds: string[];
}

function bloodBetween(db: Db, a: string, b: string): BloodHit | null {
  const row = db.run(RELATIONSHIP_CYPHER, { a, b }).rows[0];
  if (!row) return null;
  return {
    up: num(row, 'up'),
    down: num(row, 'down'),
    upIds: strings(row, 'upIds'),
    downIds: strings(row, 'downIds'),
  };
}

function anchorsOf(db: Db, person: Person): Array<{ person: Person; linked: boolean }> {
  const partners = neighbours(db, person.id).partners;
  return [{ person, linked: false }, ...partners.map((partner) => ({ person: partner, linked: true }))];
}

/**
 * When there is no shared ancestor, the tie is still in the graph — it just
 * runs through a partner. Rather than reporting "5 links", walk the two
 * partnerships and name the blood tie between the people they join, which is
 * what a person would actually say out loud.
 */
function explainMarriage(
  db: Db,
  chart: Chart,
  a: Person,
  b: Person,
): MarriageVerdict | SharedPartnerVerdict | null {
  type Best =
    | { kind: 'blood'; cost: number; x: Person; y: Person; xLinked: boolean; yLinked: boolean; hit: BloodHit }
    | { kind: 'same'; cost: number; hinge: Person };

  let best: Best | null = null;
  const left = anchorsOf(db, a);
  const right = anchorsOf(db, b);

  for (const x of left) {
    for (const y of right) {
      if (x.person.id === y.person.id) {
        const cost = (x.linked ? 1 : 0) + (y.linked ? 1 : 0);
        if (cost > 0 && (!best || cost < best.cost)) best = { kind: 'same', cost, hinge: x.person };
        continue;
      }
      const hit = bloodBetween(db, x.person.id, y.person.id);
      if (!hit) continue;
      const cost = hit.up + hit.down + (x.linked ? 1 : 0) + (y.linked ? 1 : 0);
      if (!best || cost < best.cost) {
        best = { kind: 'blood', cost, x: x.person, y: y.person, xLinked: x.linked, yLinked: y.linked, hit };
      }
    }
  }

  if (!best) return null;
  if (best.kind === 'same') return { kind: 'shared-partner', a, b, hinge: best.hinge };

  const path: string[] = [];
  const push = (id: string) => {
    if (path[path.length - 1] !== id) path.push(id);
  };
  if (best.xLinked) push(a.id);
  for (const id of best.hit.upIds) push(id);
  for (const id of best.hit.downIds.slice(1)) push(id);
  if (best.yLinked) push(b.id);

  return {
    kind: 'marriage',
    a,
    b,
    anchorA: best.x,
    anchorB: best.y,
    term: kinTerm(best.hit.up, best.hit.down, best.x.sex, best.y.sex),
    aLinked: best.xLinked,
    bLinked: best.yLinked,
    path: path.length > 0 ? path : [a.id, b.id],
  };
}

export interface Hop {
  from: Person;
  to: Person;
  /** what `to` is to `from`: mother, son, partner… */
  role: string;
}

function roleWord(from: string, to: Person, chart: Chart): string {
  const parentEdge = chart.parents.find((edge) => edge.from === from && edge.to === to.id);
  if (parentEdge) return to.sex === 'F' ? 'daughter' : to.sex === 'M' ? 'son' : 'child';
  const childEdge = chart.parents.find((edge) => edge.from === to.id && edge.to === from);
  if (childEdge) return to.sex === 'F' ? 'mother' : to.sex === 'M' ? 'father' : 'parent';
  const partner = chart.partners.some(
    (edge) => (edge.from === from && edge.to === to.id) || (edge.to === from && edge.from === to.id),
  );
  return partner ? 'partner' : 'relative';
}

/**
 * The chain, with every step named. A list of surnames says nothing; "father
 * Daan · mother Marta · brother Bram" is the sentence a person would say.
 */
export function hopsOf(chart: Chart, path: string[]): Hop[] {
  const hops: Hop[] = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const from = findPerson(chart, path[i] as string);
    const to = findPerson(chart, path[i + 1] as string);
    if (!from || !to) continue;
    hops.push({ from, to, role: roleWord(from.id, to, chart) });
  }
  return hops;
}

export interface LedgerRow {
  person: Person;
  term: string;
  gap: number;
  kind: 'blood' | 'marriage' | 'self' | 'none';
}

/**
 * One question, every answer: how is everybody in this chart related to one
 * person. Fifteen walks of the same path query, sorted by how close they are.
 */
export function ledger(db: Db, chart: Chart, id: string): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const person of chart.people) {
    if (person.id === id) {
      rows.push({ person, term: 'themselves', gap: 0, kind: 'self' });
      continue;
    }
    const verdict = findRelationship(db, id, person.id).verdict;
    if (verdict.kind === 'blood') {
      rows.push({ person, term: verdict.forward.term, gap: verdict.up + verdict.down, kind: 'blood' });
    } else if (verdict.kind === 'marriage') {
      const gap =
        (verdict.anchorA.id === verdict.a.id ? 0 : 1) +
        (verdict.anchorB.id === verdict.b.id ? 0 : 1) +
        2;
      rows.push({ person, term: 'by marriage', gap, kind: 'marriage' });
    } else if (verdict.kind === 'shared-partner') {
      rows.push({ person, term: 'by marriage', gap: 3, kind: 'marriage' });
    } else {
      rows.push({ person, term: 'no tie', gap: Number.POSITIVE_INFINITY, kind: 'none' });
    }
  }
  rows.sort((l, r) => (l.gap === r.gap ? l.person.name.localeCompare(r.person.name) : l.gap - r.gap));
  return rows;
}
