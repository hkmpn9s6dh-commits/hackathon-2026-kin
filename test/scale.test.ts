import { describe, expect, it } from 'vitest';

import { Database } from '@relate/relate';

import type { Db } from '../src/db';
import { SCHEMA, splitStatements } from '../src/cypher';
import { parseGedcom, toChart } from '../src/gedcom';
import { findRelationship, loadChart } from '../src/relatives';
import { layoutChart } from '../src/layout';
import { analyse } from '../src/insights';
import { subgraph } from '../src/focus';

function nodeDb(): Db {
  const raw = Database.open(':memory:');
  const conn = raw.connect();
  const query = conn.query.bind(conn) as unknown as (
    cypher: string,
    params?: Record<string, unknown>,
  ) => unknown;
  const db = {
    raw: raw as unknown as Db['raw'],
    log: [] as string[],
    run(cypher: string, params?: Record<string, unknown>) {
      return query(cypher, params ?? {}) as ReturnType<Db['run']>;
    },
    script(source: string) {
      for (const statement of splitStatements(source)) db.run(statement);
    },
  };
  db.script(SCHEMA);
  return db;
}

interface Family {
  husband: string;
  wife: string;
  kids: string[];
}

/** Nine generations of an invented village, the shape a real file has. */
export function village(generations = 9, seed = 5): string {
  let state = seed;
  const random = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  let next = 1;
  const lines: string[] = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1'];
  const families: Family[] = [];
  const sex = new Map<string, 'M' | 'F'>();

  const make = (gen: number, male: boolean): string => {
    const id = `I${next++}`;
    sex.set(id, male ? 'M' : 'F');
    lines.push(
      `0 @${id}@ INDI`,
      `1 NAME ${male ? 'Adam' : 'Eve'} /Village/`,
      `1 SEX ${male ? 'M' : 'F'}`,
      '1 BIRT',
      `2 DATE ${1700 + gen * 28}`,
    );
    return id;
  };

  let cohort: string[] = [];
  for (let i = 0; i < 60; i += 1) cohort.push(make(0, i % 2 === 0));

  for (let gen = 0; gen < generations; gen += 1) {
    const men = cohort.filter((id) => sex.get(id) === 'M');
    const women = cohort.filter((id) => sex.get(id) === 'F');
    const pairs = Math.min(men.length, women.length);
    const nextCohort: string[] = [];
    for (let i = 0; i < pairs; i += 1) {
      const kids: string[] = [];
      const count = 2 + (random() < 0.35 ? 1 : 0);
      for (let k = 0; k < count; k += 1) {
        const child = make(gen + 1, (i + k) % 2 === 0);
        kids.push(child);
        nextCohort.push(child);
      }
      families.push({ husband: men[i] as string, wife: women[i] as string, kids });
    }
    cohort = nextCohort;
    if (cohort.length === 0) break;
  }

  families.forEach((family, index) => {
    lines.push(`0 @F${index + 1}@ FAM`, `1 HUSB @${family.husband}@`, `1 WIFE @${family.wife}@`);
    for (const child of family.kids) lines.push(`1 CHIL @${child}@`);
  });
  lines.push('0 TRLR');
  return `${lines.join('\n')}\n`;
}

describe('a file the size of a real family tree', () => {
  const text = village();
  const startedParse = performance.now();
  const gedcom = parseGedcom(text);
  const parsed = performance.now() - startedParse;

  it('has a few thousand people in it', () => {
    expect(gedcom.people.length).toBeGreaterThan(1200);
    expect(gedcom.families.length).toBeGreaterThan(400);
  });

  it(`parses in ${Math.round(parsed)} ms`, () => {
    expect(parsed).toBeLessThan(1500);
  });

  it('imports, answers and lays out without falling over', () => {
    const db = nodeDb();
    const chart = toChart(gedcom);
    const startedInsert = performance.now();

    for (let i = 0; i < chart.people.length; i += 800) {
      db.run(
        'UNWIND $rows AS r CREATE (:Person {id: r.id, name: r.name, sex: r.sex, born: r.born, died: r.died})',
        { rows: chart.people.slice(i, i + 800).map((p) => ({ ...p, born: p.born ?? null, died: p.died ?? null })) },
      );
    }
    for (let i = 0; i < chart.parents.length; i += 400) {
      db.run(
        'UNWIND $rows AS r MATCH (p:Person {id: r.from}), (c:Person {id: r.to}) MERGE (p)-[:PARENT]->(c)',
        { rows: chart.parents.slice(i, i + 400) },
      );
    }
    for (let i = 0; i < chart.partners.length; i += 400) {
      db.run(
        'UNWIND $rows AS r MATCH (a:Person {id: r.from}), (b:Person {id: r.to}) MERGE (a)-[:PARTNER]->(b)',
        { rows: chart.partners.slice(i, i + 400) },
      );
    }
    const inserted = performance.now() - startedInsert;

    const stored = loadChart(db);
    expect(stored.people).toHaveLength(chart.people.length);

    // two people three generations apart in the same village
    const startedQuery = performance.now();
    const first = stored.people[0] as { id: string };
    const last = stored.people[stored.people.length - 1] as { id: string };
    const verdict = findRelationship(db, first.id, last.id).verdict;
    const queried = performance.now() - startedQuery;

    const startedLayout = performance.now();
    const layout = layoutChart(stored);
    const laidOut = performance.now() - startedLayout;

    console.info(
      `scale: ${stored.people.length} people / ${stored.parents.length} parent links · ` +
        `insert ${Math.round(inserted)} ms · one relationship ${queried.toFixed(1)} ms · ` +
        `full layout ${Math.round(laidOut)} ms · verdict ${verdict.kind}`,
    );

    expect(inserted).toBeLessThan(20000);
    expect(queried).toBeLessThan(400);
    expect(layout.placed.size).toBe(stored.people.length);
  });

  it('keeps a focused view small enough to read', () => {
    const db = nodeDb();
    const chart = toChart(gedcom);
    const focus = subgraph(chart, chart.people[0]?.id as string, 2);
    expect(focus.chart.people.length).toBeLessThan(60);
    expect(focus.hidden).toBeGreaterThan(1000);
    expect(focus.chart.parents.every((edge) => focus.keep.has(edge.from))).toBe(true);
    void db;
  });

  it('counts the same facts a person would check', () => {
    const db = nodeDb();
    const chart = toChart(gedcom);
    db.run('UNWIND $rows AS r CREATE (:Person {id: r.id, name: r.name, sex: r.sex})', {
      rows: chart.people.map((p) => ({ id: p.id, name: p.name, sex: p.sex })),
    });
    for (let i = 0; i < chart.parents.length; i += 400) {
      db.run('UNWIND $rows AS r MATCH (p:Person {id: r.from}), (c:Person {id: r.to}) MERGE (p)-[:PARENT]->(c)', {
        rows: chart.parents.slice(i, i + 400),
      });
    }
    const facts = analyse(db, chart);
    expect(facts.generations).toBe(10);
    expect(facts.people).toBe(chart.people.length);
    expect(facts.undated).toHaveLength(0); // this file dates everyone
    expect(facts.roots).toBeGreaterThan(20); // the founding generation
  });
});
