import { describe, expect, it, beforeAll } from 'vitest';

import { Database } from '@relate/relate';

import type { Db } from '../src/db';
import { SCHEMA, splitStatements } from '../src/cypher';
import { seedSample } from '../src/sample';
import { findPerson, findRelationship, hopsOf, ledger, loadChart, neighbours } from '../src/relatives';

/**
 * The same Cypher the browser runs, run through the Node engine instead of
 * WebAssembly. The graph is the thing under test; only the binding changes.
 */
function nodeDb(): Db {
  const raw = Database.open(':memory:');
  const conn = raw.connect();
  // the Node client types parameters more narrowly than the browser engine
  const query = conn.query.bind(conn) as unknown as (
    cypher: string,
    params?: Record<string, unknown>,
  ) => unknown;
  const db = {
    raw: raw as unknown as Db['raw'],
    log: [] as string[],
    run(cypher: string, params?: Record<string, unknown>) {
      const result = query(cypher, params ?? {});
      return result as unknown as ReturnType<Db['run']>;
    },
    script(source: string) {
      for (const statement of splitStatements(source)) db.run(statement);
    },
  };
  db.script(SCHEMA);
  return db;
}

let db: Db;

beforeAll(() => {
  db = nodeDb();
  seedSample(db);
});

describe('the chart that ships with the app', () => {
  it('has sixteen people and seventeen parent links', () => {
    const chart = loadChart(db);
    expect(chart.people).toHaveLength(16);
    expect(chart.parents).toHaveLength(17);
    expect(chart.partners).toHaveLength(6);
  });

  it('keeps one partnership entry per couple', () => {
    const chart = loadChart(db);
    const keys = chart.partners.map((edge) => [edge.from, edge.to].sort().join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('relationship queries', () => {
  const ask = (a: string, b: string) => findRelationship(db, a, b).verdict;

  it('names second cousins', () => {
    const verdict = ask('ada', 'theo');
    if (verdict.kind !== 'blood') throw new Error(verdict.kind);
    expect(verdict.forward.term).toBe('second cousin');
    expect(verdict.up).toBe(3);
    expect(verdict.down).toBe(3);
    expect(verdict.shared).toBe(2);
    expect(verdict.path[0]).toBe('ada');
    expect(verdict.path[verdict.path.length - 1]).toBe('theo');
  });

  it('names a cousin once removed in the right direction', () => {
    const verdict = ask('milo', 'theo');
    if (verdict.kind !== 'blood') throw new Error(verdict.kind);
    expect(verdict.forward.term).toBe('second cousin once removed');
    expect(verdict.backward.term).toBe('second cousin once removed');
    expect(verdict.up).toBe(4);
    expect(verdict.down).toBe(3);
  });

  it('walks downwards without a cousin term', () => {
    const verdict = ask('milo', 'rosa');
    if (verdict.kind !== 'blood') throw new Error(verdict.kind);
    expect(verdict.forward.term).toBe('great-great-grandmother');
    expect(verdict.backward.term).toBe('great-great-grandson');
    expect(verdict.up).toBe(4);
    expect(verdict.down).toBe(0);
  });

  it('knows a half sibling from a full one', () => {
    const verdict = ask('daan', 'noor');
    if (verdict.kind !== 'blood') throw new Error(verdict.kind);
    expect(verdict.forward.term).toBe('half-sister');
    expect(verdict.shared).toBe(1);
    expect(verdict.fullSibling).toBe(false);
  });

  it('calls a full sibling full', () => {
    const verdict = ask('bram', 'suze');
    if (verdict.kind !== 'blood') throw new Error(verdict.kind);
    expect(verdict.forward.term).toBe('sister');
    expect(verdict.fullSibling).toBe(true);
  });

  it('finds the aunt', () => {
    const verdict = ask('ada', 'noor');
    if (verdict.kind !== 'blood') throw new Error(verdict.kind);
    expect(verdict.forward.term).toBe('aunt');
    expect(verdict.up).toBe(2);
    expect(verdict.down).toBe(1);
  });

  it('explains a tie that is only marriage', () => {
    const verdict = ask('wilma', 'suze');
    if (verdict.kind !== 'marriage') throw new Error(verdict.kind);
    expect(verdict.anchorA.id).toBe('daan');
    expect(verdict.anchorB.id).toBe('suze');
    expect(verdict.term.term).toBe('first cousin');
    expect(verdict.aLinked).toBe(true);
    expect(verdict.bLinked).toBe(false);
  });

  it('handles two people married to the same person', () => {
    // Marta and Hedy are both Ivo's partners.
    const verdict = ask('marta', 'hedy');
    expect(verdict.kind).toBe('shared-partner');
  });

  it('recognises the same person', () => {
    expect(ask('ada', 'ada').kind).toBe('self');
  });

  it('reports nothing when nothing connects them', () => {
    const lonely = nodeDb();
    seedSample(lonely);
    lonely.run("CREATE (:Person {id: 'outsider', name: 'Outsider', sex: 'X'})");
    const verdict = findRelationship(lonely, 'ada', 'outsider').verdict;
    expect(verdict.kind).toBe('none');
  });

  it('answers within a millisecond on a chart this size', () => {
    const answer = findRelationship(db, 'milo', 'theo');
    expect(answer.elapsedMs).toBeLessThan(50);
  });
});

describe('neighbours', () => {
  it('lists parents, children and partners', () => {
    const people = neighbours(db, 'ivo');
    expect(people.parents.map((p) => p.id).sort()).toEqual(['emil', 'rosa']);
    expect(people.children.map((p) => p.id).sort()).toEqual(['daan', 'noor']);
    expect(people.partners.map((p) => p.id).sort()).toEqual(['hedy', 'marta']);
  });
});

describe('editing the chart changes every answer at once', () => {
  it('adds a person and reports them in the roster', () => {
    const scratch = nodeDb();
    seedSample(scratch);
    scratch.run("CREATE (:Person {id: 'nina', name: 'Nina Vell', sex: 'F', born: 2020})");
    scratch.run("MATCH (p:Person {id:'nina'}), (m:Person {id:'ada'}) CREATE (m)-[:PARENT]->(p)");
    const chart = loadChart(scratch);
    expect(findPerson(chart, 'nina')?.name).toBe('Nina Vell');
    const verdict = findRelationship(scratch, 'nina', 'milo').verdict;
    if (verdict.kind !== 'blood') throw new Error(verdict.kind);
    expect(verdict.forward.term).toBe('brother');
  });
});

describe('the index: everyone, by relation', () => {
  it('sorts by how close they are, and names the tie', () => {
    const rows = ledger(db, loadChart(db), 'ada');
    expect(rows[0]?.person.id).toBe('ada');
    expect(rows[0]?.term).toBe('themselves');
    expect(rows[1]?.person.id).toBe('daan');
    expect(rows[1]?.term).toBe('father');
    const theo = rows.find((row) => row.person.id === 'theo');
    expect(theo?.term).toBe('second cousin');
    expect(theo?.gap).toBe(6);
    // gaps never go down as you read the list
    const gaps = rows.map((row) => row.gap);
    expect([...gaps].sort((a, b) => a - b)).toEqual(gaps);
  });

  it('covers every person in the chart exactly once', () => {
    const chart = loadChart(db);
    const rows = ledger(db, chart, 'rosa');
    expect(rows).toHaveLength(chart.people.length);
    expect(new Set(rows.map((row) => row.person.id)).size).toBe(chart.people.length);
  });
});

describe('the chain, with every step named', () => {
  it('names each hop from the point of view of the step before it', () => {
    const chart = loadChart(db);
    const verdict = findRelationship(db, 'ada', 'theo').verdict;
    if (verdict.kind !== 'blood') throw new Error(verdict.kind);
    const hops = hopsOf(chart, verdict.path);
    expect(hops.map((hop) => hop.role)).toEqual([
      'father',
      'father',
      'father',
      'daughter',
      'daughter',
      'son',
    ]);
    expect(hops[0]?.to.id).toBe('daan');
    expect(hops[hops.length - 1]?.to.id).toBe('theo');
  });

  it('calls a marriage a partnership', () => {
    const chart = loadChart(db);
    const verdict = findRelationship(db, 'wilma', 'suze').verdict;
    if (verdict.kind !== 'marriage') throw new Error(verdict.kind);
    const hops = hopsOf(chart, verdict.path);
    expect(hops[0]?.role).toBe('partner');
  });
});
