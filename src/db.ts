/**
 * The database layer.
 *
 * Relate is embedded: this module owns the only instance, and every Cypher
 * statement in the app goes through `run()`. Nothing is fetched, so every
 * answer is available offline and nothing about a family leaves the tab.
 */

import init, { RelateDb } from '@relate/relate-wasm';
import wasmUrl from '@relate/relate-wasm/relate_bg.wasm?url';

import { SCHEMA, splitStatements } from './cypher';

export { SCHEMA, splitStatements } from './cypher';

export type Row = Record<string, unknown>;

export interface Envelope {
  columns: string[];
  rows: Row[];
  stats?: Record<string, number> | null;
  error?: string | null;
}

export interface Db {
  readonly raw: RelateDb;
  /** Run one statement; throws when the engine reports an error. */
  run(cypher: string, params?: Record<string, unknown>): Envelope;
  /** Run several statements; returns the last envelope. */
  script(source: string): void;
  /** The statements this session has run, newest last — shown in the UI. */
  readonly log: string[];
}

let opening: Promise<Db> | null = null;

export function openDb(): Promise<Db> {
  opening ??= (async () => {
    await init(wasmUrl);
    const raw = new RelateDb();
    const log: string[] = [];
    const db: Db = {
      raw,
      log,
      run(cypher, params) {
        const wire = raw.execute(cypher, params ? JSON.stringify(params) : null);
        const envelope = JSON.parse(wire) as Envelope;
        log.push(cypher.replace(/\s+/g, ' ').trim());
        if (log.length > 40) log.shift();
        if (envelope.error) throw new Error(envelope.error);
        return envelope;
      },
      script(source) {
        for (const statement of splitStatements(source)) db.run(statement);
      },
    };
    db.script(SCHEMA);
    return db;
  })();
  return opening;
}

