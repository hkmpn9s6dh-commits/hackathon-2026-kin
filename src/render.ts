/**
 * Drawing the chart.
 *
 * Deliberately not a node-link diagram: names sit on hairline rules, the way a
 * printed pedigree does. The one saturated colour in the whole view is the
 * vermilion that traces the answer, so whichever line is highlighted is the
 * thing your eye lands on first.
 */

import type { Chart } from './relatives';
import type { Layout } from './layout';
import { PAD_Y, ROW } from './layout';

const RULE = 60;
const HIT = 74;

export interface RenderOptions {
  chart: Chart;
  layout: Layout;
  /** ids along the answer, first person → common ancestor → second person */
  path: string[];
  /** the two people being compared */
  subjects: string[];
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dates(born?: number, died?: number): string {
  if (born && died) return `${born} – ${died}`;
  if (born) return `b. ${born}`;
  if (died) return `d. ${died}`;
  return '';
}

export function renderChart(root: Element, options: RenderOptions): void {
  const { chart, layout, path, subjects } = options;
  const onPath = new Set(path);
  const adjacent = new Map<string, Set<string>>();
  for (let i = 0; i < path.length - 1; i += 1) {
    const from = path[i] as string;
    const to = path[i + 1] as string;
    if (!adjacent.has(from)) adjacent.set(from, new Set());
    if (!adjacent.has(to)) adjacent.set(to, new Set());
    (adjacent.get(from) as Set<string>).add(to);
    (adjacent.get(to) as Set<string>).add(from);
  }
  const linked = (a: string, b: string): boolean =>
    Boolean(onPath.has(a) && onPath.has(b) && adjacent.get(a)?.has(b));

  const placed = layout.placed;

  // parents' marriage line → one bus per parent set
  const buses = new Map<string, { parents: string[]; children: string[]; x: number; y: number; busY: number }>();
  for (const link of layout.links) {
    const key = [...link.parents].sort().join('|');
    const entry = buses.get(key);
    if (entry) {
      entry.children.push(link.child);
      continue;
    }
    buses.set(key, {
      parents: [...link.parents],
      children: [link.child],
      x: link.x,
      y: link.y,
      busY: link.busY,
    });
  }

  const parts: string[] = [];
  const W = layout.width;
  const H = layout.height;

  parts.push(
    `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="family chart">`,
  );

  // generation numerals in the gutter, the way a printed pedigree marks its rows
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  for (let row = 0; row < layout.rows.length; row += 1) {
    const y = PAD_Y + row * ROW;
    const absolute = layout.generations[row] ?? row;
    const numeral = ROMAN[absolute] ?? String(absolute + 1);
    parts.push(
      `<g class="gen"><line x1="30" y1="${y}" x2="46" y2="${y}" /><text x="58" y="${y + 4}">${numeral}</text></g>`,
    );
  }


  // descent lines first, then names on top of them
  for (const bus of buses.values()) {
    const strong = bus.children.some((child) => bus.parents.some((parent) => linked(parent, child)));
    const cls = strong ? 'descent is-path' : 'descent';
    const x0 = bus.x;
    const childXs = bus.children
      .map((child) => placed.get(child)?.x)
      .filter((value): value is number => typeof value === 'number');
    if (childXs.length === 0) continue;
    const left = Math.min(x0, ...childXs);
    const right = Math.max(x0, ...childXs);
    const busY = bus.busY;
    const top = bus.y + 26;
    const bottom = bus.y + ROW - 34;
    const segments = [
      `M ${x0} ${top} V ${busY}`,
      `M ${left} ${busY} H ${right}`,
      ...childXs.map((x) => `M ${x} ${busY} V ${bottom}`),
    ];
    parts.push(`<path class="${cls}" d="${segments.join(' ')}" />`);
  }

  // couples
  for (const couple of layout.couples) {
    const a = placed.get(couple.a);
    const b = placed.get(couple.b);
    if (!a || !b || a.gen !== b.gen) continue;
    const [leftPerson, rightPerson] = a.x <= b.x ? [a, b] : [b, a];
    const x1 = leftPerson.x + RULE;
    const x2 = rightPerson.x - RULE;
    if (x2 <= x1) continue;
    const mid = (x1 + x2) / 2;
    const strong = linked(leftPerson.person.id, rightPerson.person.id);
    const cls = strong ? 'union is-path' : 'union';
    parts.push(
      `<path class="${cls}" d="M ${x1} ${leftPerson.y - 3} H ${x2}" />`,
      `<path class="${cls}" d="M ${x1} ${leftPerson.y + 3} H ${x2}" />`,
    );
    void mid;
  }

  // people
  for (const person of chart.people) {
    const spot = placed.get(person.id);
    if (!spot) continue;
    const x = spot.x;
    const y = spot.y;
    const isSubject = subjects.includes(person.id);
    const isOnPath = onPath.has(person.id);
    const classes = ['person'];
    if (isSubject) classes.push('is-subject');
    if (isOnPath) classes.push('is-path');
    const stamp = dates(person.born, person.died);
    parts.push(
      `<g class="${classes.join(' ')}" data-id="${esc(person.id)}" data-name="${esc(person.name)}" transform="translate(${x} ${y})">`,
      `<rect class="hit" x="${-HIT}" y="-40" width="${HIT * 2}" height="76" />`,
      `<line class="plinth" x1="${-RULE}" y1="0" x2="${RULE}" y2="0" />`,
      `<text class="pname" x="0" y="-13" text-anchor="middle">${esc(person.name)}</text>`,
      stamp ? `<text class="pdates" x="0" y="21" text-anchor="middle">${stamp}</text>` : '',
      `</g>`,
    );
  }

  parts.push('</svg>');
  root.innerHTML = parts.join('');
}
