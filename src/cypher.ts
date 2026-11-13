/**
 * Cypher plumbing that has nothing to do with the browser.
 *
 * Kept apart from `db.ts` so the tests can run the same statements through the
 * Node engine without dragging a WebAssembly fetch into Node.
 */

/** Relate's `execute` takes one statement, so a seed file has to be split here. */
export function splitStatements(source: string): string[] {
  const statements: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] as string;
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += source[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ';' && depth === 0) {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export const SCHEMA = `
CREATE INDEX person_id IF NOT EXISTS FOR (n:Person) ON (n.id);
CREATE INDEX person_name IF NOT EXISTS FOR (n:Person) ON (n.name);
`;
