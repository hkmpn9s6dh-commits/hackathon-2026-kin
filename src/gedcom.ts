/**
 * GEDCOM 5.5.1 — the format every genealogy program on earth can write.
 *
 * Import is what turns a demo into a tool: you bring the tree you already
 * have, not the sixteen people we invented. Export keeps it honest — anything
 * we can read we can also write, and the round trip is a test.
 *
 * Only the parts that carry meaning for this app are read: people, names,
 * sexes, birth and death years, and the family records that produce the
 * parent and partner edges. Everything else is skipped without complaint.
 */

import type { Edge, Person } from './relatives';
import type { Chart } from './relatives';

export interface GedcomPerson {
  id: string;
  name: string;
  sex: 'F' | 'M' | 'X';
  born?: number;
  died?: number;
}

export interface GedcomFamily {
  id: string;
  husband?: string;
  wife?: string;
  children: string[];
}

export interface Gedcom {
  people: GedcomPerson[];
  families: GedcomFamily[];
  /** things a person should know about: malformed lines, dangling links */
  warnings: string[];
}

interface Line {
  level: number;
  xref?: string;
  tag: string;
  value: string;
}

export function parseLines(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line) continue;
    const match = /^(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z_]+)(?:\s+(.*))?$/.exec(line);
    if (!match) continue;
    const level = Number(match[1]);
    const xref = match[2]?.slice(1, -1);
    const tag = (match[3] ?? '').toUpperCase();
    out.push({ level, xref, tag, value: (match[4] ?? '').trim() });
  }
  return out;
}

/** "12 MAR 1902" / "ABT 1902" / "BEF 1899" / "1902-01-03" → 1902 */
export function yearOf(value: string): number | undefined {
  const years = value.match(/\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\b/g);
  if (years && years.length > 0) return Number(years[years.length - 1]);
  return undefined;
}

/** "Rosa /Vell/" → "Rosa Vell"; "Ada //" → "Ada" */
export function nameOf(value: string): string {
  const cleaned = value
    .replace(/\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Unnamed';
}

interface PersonDraft {
  id: string;
  name: string;
  given?: string;
  surname?: string;
  sex: 'F' | 'M' | 'X';
  born?: number;
  died?: number;
}

export function parseGedcom(text: string): Gedcom {
  const lines = parseLines(text);
  const people: PersonDraft[] = [];
  const families: GedcomFamily[] = [];
  const warnings: string[] = [];

  let person: PersonDraft | null = null;
  let family: GedcomFamily | null = null;
  /** what the last `1` level tag was, so `2 DATE` knows where it belongs */
  let context = '';

  for (const line of lines) {
    if (line.level === 0) {
      person = null;
      family = null;
      context = '';
      if (line.tag === 'INDI' && line.xref) {
        person = { id: line.xref, name: 'Unnamed', sex: 'X' };
        people.push(person);
      } else if (line.tag === 'FAM' && line.xref) {
        family = { id: line.xref, children: [] };
        families.push(family);
      }
      continue;
    }

    if (person) {
      if (line.level === 1) {
        context = line.tag;
        if (line.tag === 'NAME') {
          person.name = nameOf(line.value);
        } else if (line.tag === 'SEX') {
          person.sex = line.value.toUpperCase().startsWith('F')
            ? 'F'
            : line.value.toUpperCase().startsWith('M')
              ? 'M'
              : 'X';
        } else if (line.tag === 'BIRT' || line.tag === 'DEAT') {
          // the year arrives on the level-2 DATE under this tag
        }
        continue;
      }
      if (line.level === 2) {
        if (line.tag === 'GIVN') person.given = line.value;
        if (line.tag === 'SURN') person.surname = line.value;
        if (line.tag === 'DATE') {
          const year = yearOf(line.value);
          if (year) {
            if (context === 'BIRT' || context === 'CHR' || context === 'BAPM') person.born = year;
            if (context === 'DEAT' || context === 'BURI' || context === 'CREM') person.died = year;
          }
        }
        continue;
      }
      continue;
    }

    if (family) {
      if (line.level === 1) {
        if (line.tag === 'HUSB' && line.value) family.husband = stripRef(line.value);
        if (line.tag === 'WIFE' && line.value) family.wife = stripRef(line.value);
        if (line.tag === 'CHIL' && line.value) family.children.push(stripRef(line.value));
      }
      continue;
    }
  }

  // names built from GIVN/SURN when NAME was absent or empty
  for (const draft of people) {
    if (draft.name === 'Unnamed' && (draft.given || draft.surname)) {
      draft.name = [draft.given, draft.surname].filter(Boolean).join(' ');
    }
  }

  const known = new Set(people.map((p) => p.id));
  const seen = new Set<string>();
  const unique: GedcomPerson[] = [];
  for (const draft of people) {
    if (seen.has(draft.id)) {
      warnings.push(`duplicate person id ${draft.id} — kept the first`);
      continue;
    }
    seen.add(draft.id);
    unique.push({
      id: draft.id,
      name: draft.name,
      sex: draft.sex,
      ...(draft.born ? { born: draft.born } : {}),
      ...(draft.died ? { died: draft.died } : {}),
    });
  }

  const cleanFamilies: GedcomFamily[] = [];
  for (const fam of families) {
    for (const ref of [fam.husband, fam.wife, ...fam.children]) {
      if (ref && !known.has(ref)) {
        warnings.push(`family ${fam.id} points at a person who is not in the file (${ref})`);
      }
    }
    const children = fam.children.filter((ref) => known.has(ref));
    const husband = fam.husband && known.has(fam.husband) ? fam.husband : undefined;
    const wife = fam.wife && known.has(fam.wife) ? fam.wife : undefined;
    if (!husband && !wife && children.length === 0) continue;
    cleanFamilies.push({
      id: fam.id,
      ...(husband ? { husband } : {}),
      ...(wife ? { wife } : {}),
      children,
    });
  }

  if (unique.length === 0) warnings.push('no INDI records found — is this a GEDCOM file?');
  return { people: unique, families: cleanFamilies, warnings: [...new Set(warnings)] };
}

function stripRef(value: string): string {
  return value.replace(/@/g, '').trim();
}

/** GEDCOM families → the two edge types the app draws. */
export function toChart(gedcom: Gedcom): Chart {
  const people: Person[] = gedcom.people.map((p) => ({
    id: p.id,
    name: p.name,
    sex: p.sex,
    ...(p.born ? { born: p.born } : {}),
    ...(p.died ? { died: p.died } : {}),
  }));

  const parents: Edge[] = [];
  const partners: Edge[] = [];
  const seenParent = new Set<string>();
  const seenPartner = new Set<string>();

  for (const family of gedcom.families) {
    if (family.husband && family.wife) {
      const key = [family.husband, family.wife].sort().join('|');
      if (!seenPartner.has(key)) {
        seenPartner.add(key);
        partners.push({ from: family.husband, to: family.wife });
      }
    }
    for (const parent of [family.husband, family.wife]) {
      if (!parent) continue;
      for (const child of family.children) {
        const key = `${parent}>${child}`;
        if (seenParent.has(key)) continue;
        seenParent.add(key);
        parents.push({ from: parent, to: child });
      }
    }
  }

  return { people, parents, partners };
}

/** The inverse, so a tree that comes in can go back out. */
export function fromChart(chart: Chart): string {
  const lines: string[] = ['0 HEAD', '1 SOUR Kin', '2 VERS 1.0', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8'];

  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const edge of chart.parents) {
    parentsOf.set(edge.to, [...(parentsOf.get(edge.to) ?? []), edge.from]);
    childrenOf.set(edge.from, [...(childrenOf.get(edge.from) ?? []), edge.to]);
  }

  // one FAM per couple, and one for each single parent with children
  const families: Array<{ id: string; husband?: string; wife?: string; children: string[] }> = [];
  const assigned = new Set<string>();

  for (const partner of chart.partners) {
    const shared = (childrenOf.get(partner.from) ?? []).filter((child) =>
      (parentsOf.get(child) ?? []).includes(partner.to),
    );
    const husband = bySex(chart, partner.from, partner.to, 'M');
    const wife = bySex(chart, partner.from, partner.to, 'F');
    families.push({
      id: `F${families.length + 1}`,
      ...(husband ? { husband } : {}),
      ...(wife ? { wife } : {}),
      children: shared,
    });
    for (const child of shared) assigned.add(child);
  }

  for (const [parent, children] of childrenOf) {
    const leftover = children.filter((child) => !assigned.has(child));
    if (leftover.length === 0) continue;
    const person = chart.people.find((p) => p.id === parent);
    families.push({
      id: `F${families.length + 1}`,
      ...(person?.sex === 'F' ? { wife: parent } : { husband: parent }),
      children: leftover,
    });
    for (const child of leftover) assigned.add(child);
  }

  for (const person of chart.people) {
    lines.push(`0 @${person.id}@ INDI`);
    lines.push(`1 NAME ${gedcomName(person.name)}`);
    lines.push(`1 SEX ${person.sex === 'X' ? 'U' : person.sex}`);
    if (person.born) {
      lines.push('1 BIRT', `2 DATE ${person.born}`);
    }
    if (person.died) {
      lines.push('1 DEAT', `2 DATE ${person.died}`);
    }
  }

  for (const family of families) {
    lines.push(`0 @${family.id}@ FAM`);
    if (family.husband) lines.push(`1 HUSB @${family.husband}@`);
    if (family.wife) lines.push(`1 WIFE @${family.wife}@`);
    for (const child of family.children) lines.push(`1 CHIL @${child}@`);
  }

  lines.push('0 TRLR');
  return `${lines.join('\n')}\n`;
}

function bySex(chart: Chart, a: string, b: string, sex: 'M' | 'F'): string | undefined {
  const pa = chart.people.find((p) => p.id === a);
  const pb = chart.people.find((p) => p.id === b);
  if (pa?.sex === sex) return a;
  if (pb?.sex === sex) return b;
  return sex === 'M' ? a : b;
}

function gedcomName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0] as string;
  const surname = parts[parts.length - 1] as string;
  const given = parts.slice(0, -1).join(' ');
  return `${given} /${surname}/`;
}
