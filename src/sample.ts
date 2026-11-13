/**
 * The chart that ships with the app: one invented family, five generations,
 * built so that every kind of answer has something to point at —
 * full and half siblings, aunts, cousins at two depths, a marriage that
 * joins two branches, and one person with no blood tie at all.
 *
 * Nobody here is real. The dates are chosen to stay plausible.
 */

import type { Db } from './db';
import type { Sex } from './kinship';

export interface PersonSeed {
  id: string;
  name: string;
  sex: Sex;
  born?: number;
  died?: number;
}

export const SAMPLE_PEOPLE: PersonSeed[] = [
  { id: 'rosa', name: 'Rosa Vell', sex: 'F', born: 1902, died: 1979 },
  { id: 'emil', name: 'Emil Vell', sex: 'M', born: 1899, died: 1968 },
  { id: 'ivo', name: 'Ivo Vell', sex: 'M', born: 1928, died: 2004 },
  { id: 'liese', name: 'Liese Vell', sex: 'F', born: 1931, died: 2011 },
  { id: 'marta', name: 'Marta Blum', sex: 'F', born: 1930, died: 2015 },
  { id: 'anton', name: 'Anton Reuter', sex: 'M', born: 1929, died: 1998 },
  { id: 'hedy', name: 'Hedy Krantz', sex: 'F', born: 1932, died: 2010 },
  { id: 'daan', name: 'Daan Vell', sex: 'M', born: 1956 },
  { id: 'noor', name: 'Noor Vell', sex: 'F', born: 1961 },
  { id: 'bram', name: 'Bram Reuter', sex: 'M', born: 1958 },
  { id: 'suze', name: 'Suze Reuter', sex: 'F', born: 1960 },
  { id: 'wilma', name: 'Wilma de Groot', sex: 'F', born: 1958 },
  { id: 'kasper', name: 'Kasper Lind', sex: 'M', born: 1957 },
  { id: 'ada', name: 'Ada Vell', sex: 'F', born: 1986 },
  { id: 'theo', name: 'Theo Lind', sex: 'M', born: 1988 },
  { id: 'milo', name: 'Milo Vell', sex: 'M', born: 2014 },
];

/** parent → child */
export const SAMPLE_PARENTS: Array<[string, string]> = [
  ['rosa', 'ivo'],
  ['emil', 'ivo'],
  ['rosa', 'liese'],
  ['emil', 'liese'],
  ['ivo', 'daan'],
  ['marta', 'daan'],
  ['ivo', 'noor'],
  ['hedy', 'noor'],
  ['liese', 'bram'],
  ['anton', 'bram'],
  ['liese', 'suze'],
  ['anton', 'suze'],
  ['daan', 'ada'],
  ['wilma', 'ada'],
  ['suze', 'theo'],
  ['kasper', 'theo'],
  ['ada', 'milo'],
];

/** two people who are partners; stored once, queried in both directions */
export const SAMPLE_PARTNERS: Array<[string, string]> = [
  ['rosa', 'emil'],
  ['ivo', 'marta'],
  ['ivo', 'hedy'],
  ['liese', 'anton'],
  ['daan', 'wilma'],
  ['suze', 'kasper'],
];

export function seedSample(db: Db): void {
  for (const person of SAMPLE_PEOPLE) {
    db.run(
      `MERGE (p:Person {id: $id})
       SET p.name = $name, p.sex = $sex, p.born = $born, p.died = $died`,
      {
        id: person.id,
        name: person.name,
        sex: person.sex,
        born: person.born ?? null,
        died: person.died ?? null,
      },
    );
  }
  for (const [parent, child] of SAMPLE_PARENTS) {
    db.run(
      `MATCH (p:Person {id: $parent}), (c:Person {id: $child})
       MERGE (p)-[:PARENT]->(c)`,
      { parent, child },
    );
  }
  for (const [a, b] of SAMPLE_PARTNERS) {
    db.run(
      `MATCH (a:Person {id: $a}), (b:Person {id: $b})
       MERGE (a)-[:PARTNER]->(b)`,
      { a, b },
    );
  }
}

export function clearAll(db: Db): void {
  db.run('MATCH (n) DETACH DELETE n');
}
