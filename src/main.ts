/**
 * Wiring: the chart on the left, the answer on the right, and the one
 * interaction the whole app is built around — pick two names, read the line.
 *
 * Everything the chart shows comes out of one graph in one embedded store, so
 * importing a file, adding a person and asking a question all end in the same
 * place: reload the chart, re-derive every answer.
 */

import './styles.css';
import { openDb, type Db } from './db';
import { clearAll, seedSample } from './sample';
import {
  findPerson,
  findRelationship,
  hopsOf,
  ledger,
  loadChart,
  neighbours,
  type BloodVerdict,
  type Chart,
  type Edge,
  type MarriageVerdict,
  type Person,
} from './relatives';
import { computeGenerations, layoutChart, type Layout } from './layout';
import { renderChart } from './render';
import { parseAsk } from './ask';
import { fromChart, parseGedcom, toChart } from './gedcom';
import { analyse, commonAncestorsOf, livedTogether, longestChain, type Insights } from './insights';
import { busiestPerson, subgraph } from './focus';

interface State {
  db: Db;
  chart: Chart;
  view: Chart;
  layout: Layout;
  subjects: string[];
  path: string[];
  focus: number | 'all';
  hidden: number;
}

const el = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
};

const chartEl = el<HTMLDivElement>('#chart');
const answerEl = el<HTMLElement>('#answer');
const ledgerEl = el<HTMLUListElement>('#ledger');
const indexTitle = el<HTMLElement>('#index-title');
const indexMeta = el<HTMLElement>('#index-meta');
const hintEl = el<HTMLParagraphElement>('#hint');
const runRight = el<HTMLElement>('#run-right');
const focusBox = el<HTMLElement>('#focus');
const queryBox = el<HTMLDetailsElement>('#query');
const cypherEl = el<HTMLElement>('#cypher');
const queryMeta = el<HTMLParagraphElement>('#query-meta');
const askForm = el<HTMLFormElement>('#ask');
const askInput = el<HTMLInputElement>('#q');
const dialog = el<HTMLDialogElement>('#add-dialog');
const addForm = el<HTMLFormElement>('#add-form');
const gedFile = el<HTMLInputElement>('#ged-file');
const reportDialog = el<HTMLDialogElement>('#report-dialog');
const reportEl = el<HTMLElement>('#report');

let state: State | null = null;
let editing: string | null = null;

const BIG = 26;
const NOW = new Date().getFullYear();

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function firstName(person: Person): string {
  return person.name.split(/\s+/)[0] ?? person.name;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function numberWord(n: number): string {
  const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return words[n - 1] ?? String(n);
}

/* ---------------- the chart ---------------- */

function rebuildView(): void {
  if (!state) return;
  const chart = state.chart;
  const center = state.subjects[0] ?? busiestPerson(chart);

  if (state.focus === 'all' || chart.people.length <= BIG || !center) {
    state.view = chart;
    state.layout = layoutChart(chart);
    state.hidden = 0;
    return;
  }

  const focused = subgraph(chart, center, state.focus);
  state.view = focused.chart;
  state.layout = layoutChart(focused.chart, computeGenerations(chart));
  state.hidden = focused.hidden;
}

function refresh(): void {
  if (!state) return;
  const chart = loadChart(state.db);
  state.chart = chart;
  state.subjects = state.subjects.filter((id) => findPerson(chart, id));
  if (state.subjects.length < 2) state.path = [];
  rebuildView();
  draw();
  paintIndex();
}

function draw(): void {
  if (!state) return;
  renderChart(chartEl, {
    chart: state.view,
    layout: state.layout,
    path: state.path,
    subjects: state.subjects,
  });

  const counts = state.subjects.length;
  hintEl.textContent =
    counts === 0
      ? 'Pick a name to see how everyone else is related to them.'
      : counts === 1
        ? 'Now pick a second name — or read the index on the right.'
        : 'Pick any name to start again.';

  const born = state.chart.people.map((p) => p.born).filter((y): y is number => typeof y === 'number');
  const span = born.length > 0 ? `${Math.min(...born)} – ${Math.max(...born)}` : '';
  const hidden = state.hidden > 0 ? `showing ${state.view.people.length} of ${state.chart.people.length}` : '';
  const generations = state.layout.generations.length;
  runRight.textContent = [span, `${generations} generations`, hidden].filter(Boolean).join(' · ');

  focusBox.hidden = state.chart.people.length <= BIG;
  for (const button of focusBox.querySelectorAll('button')) {
    const value = button.getAttribute('data-focus');
    const on = value === String(state.focus);
    button.classList.toggle('on', on);
  }

  syncUrl();
}

function syncUrl(): void {
  if (!state) return;
  const params = new URLSearchParams();
  const [a, b] = state.subjects;
  if (a) params.set('a', a);
  if (b) params.set('b', b);
  if (state.focus !== 'all') params.set('focus', String(state.focus));
  const query = params.toString();
  const next = `${location.pathname}${query ? `?${query}` : ''}`;
  history.replaceState(null, '', next);
}

/* ---------------- the index: roster when idle, ledger when one name is held ---------------- */

function paintIndex(): void {
  if (!state) return;
  const subjectId = state.subjects[0];
  const subject = subjectId ? findPerson(state.chart, subjectId) : null;

  if (!subject) {
    const people = [...state.chart.people].sort((a, b) => a.name.localeCompare(b.name));
    indexTitle.textContent = 'The chart';
    indexMeta.textContent = `${people.length} people, a–z`;
    ledgerEl.innerHTML = people
      .map(
        (person) =>
          `<li data-id="${esc(person.id)}"><button type="button" data-pick="${esc(person.id)}"><span class="who">${esc(person.name)}</span><span class="leader"></span><span class="rel">${person.born ? `b. ${person.born}` : ''}</span></button></li>`,
      )
      .join('');
    return;
  }

  const rows = ledger(state.db, state.chart, subject.id);
  indexTitle.textContent = `By relation to ${firstName(subject)}`;
  indexMeta.textContent = `${rows.length} people, closest first`;
  ledgerEl.innerHTML = rows
    .map((row) => {
      const classes = [row.kind === 'none' ? 'is-none' : '', state?.subjects.includes(row.person.id) ? 'on' : '']
        .filter(Boolean)
        .join(' ');
      return `<li class="${classes}" data-id="${esc(row.person.id)}"><button type="button" data-pick="${esc(row.person.id)}"><span class="who">${esc(row.person.name)}</span><span class="leader"></span><span class="rel">${esc(row.term)}</span></button></li>`;
    })
    .join('');
}

/* ---------------- the answer ---------------- */

function namesIn(path: string[], ancestorId: string): string {
  if (!state) return '';
  const chart = state.chart;
  return path
    .map((id) => {
      const person = findPerson(chart, id);
      if (!person) return '';
      const label = esc(person.name);
      return id === ancestorId ? `<span class="via">${label}</span>` : label;
    })
    .filter(Boolean)
    .join(' <span class="arrow">·</span> ');
}

/**
 * Two legs, not one long chain: up from the first person to the ancestor, then
 * down to the second. That shape is the answer, so it is the shape on screen.
 */
function legsHtml(path: string[], up: number, ancestorId: string): string {
  // a direct line has one leg, not two: saying "down: Rosa" on its own is noise
  if (up === 0 || up === path.length - 1) {
    return `<div class="legs"><p><span class="tag">line</span><span>${namesIn(path, ancestorId)}</span></p></div>`;
  }
  const upLeg = path.slice(0, up + 1);
  const downLeg = path.slice(up);
  return `<div class="legs">
      <p><span class="tag">up</span><span>${namesIn(upLeg, ancestorId)}</span></p>
      <p><span class="tag">down</span><span>${namesIn(downLeg, ancestorId)}</span></p>
    </div>`;
}

/** For a tie that runs through a partnership, the role of each step is the point. */
function hopsHtml(path: string[], ancestorId: string): string {
  if (!state || path.length === 0) return '';
  const start = findPerson(state.chart, path[0] as string);
  if (!start) return '';
  const parts = [`<span class="hop${path[0] === ancestorId ? ' via' : ''}">${esc(start.name)}</span>`];
  for (const hop of hopsOf(state.chart, path)) {
    const cls = hop.to.id === ancestorId ? 'hop via' : 'hop';
    parts.push(`<span class="${cls}"><span class="role">${esc(hop.role)}</span>${esc(hop.to.name)}</span>`);
  }
  return parts.join(' <span class="sep">·</span> ');
}

function metaLine(parts: string[]): string {
  return `<p class="meta">${parts.join('<i>·</i>')}</p>`;
}

function overlapNote(a: Person, b: Person): string {
  const years = livedTogether(a, b, NOW);
  if (years === null) return '';
  return years === 0
    ? ' They never overlapped.'
    : ` They were alive at the same time for ${years} ${years === 1 ? 'year' : 'years'}.`;
}

function renderBlood(v: BloodVerdict): void {
  const shared = v.shared === 1 ? 'one ancestor in common' : `${v.shared} ancestors in common`;
  const sameParentNote =
    v.up === 1 && v.down === 1 && !v.fullSibling ? ' They share one parent, not two.' : '';

  // A direct line is not a sideways step: say it that way when one leg is zero.
  let sentence: string;
  if (v.up === 0) {
    sentence = `${esc(v.b.name)} sits ${numberWord(v.down)} ${v.down === 1 ? 'generation' : 'generations'} below ${esc(v.a.name)} — a direct line, no sideways step.`;
  } else if (v.down === 0) {
    sentence = `${esc(v.a.name)} climbs ${numberWord(v.up)} ${v.up === 1 ? 'generation' : 'generations'} to ${esc(v.b.name)} — a direct line, no sideways step.`;
  } else {
    sentence = `${capitalise(numberWord(v.up))} ${v.up === 1 ? 'step' : 'steps'} up from ${esc(firstName(v.a))}, ${numberWord(v.down)} down from ${esc(firstName(v.b))} — the lines meet at <b>${esc(v.ancestor.name)}</b>, ${shared}.${sameParentNote}`;
  }

  const meta = [`${v.up} up`, `${v.down} down`, shared].filter((part) => !part.startsWith('0 '));
  answerEl.innerHTML = `
    <p class="kicker">${esc(v.a.name)} <span class="long">⟶</span> ${esc(v.b.name)}</p>
    <p class="term${v.forward.term.length >= 22 ? ' tight' : ''}">${esc(v.b.name)} is ${esc(v.a.name)}’s <em>${esc(v.forward.term)}</em>.</p>
    <p class="why">${sentence}${overlapNote(v.a, v.b)}</p>
    ${metaLine(meta)}
    ${legsHtml(v.path, v.up, v.ancestor.id)}
    <p class="mirror">Which makes ${esc(firstName(v.a))} ${esc(v.b.name)}’s ${esc(v.backward.term)}.</p>`;
}

function renderMarriage(v: MarriageVerdict): void {
  const clause = v.aLinked
    ? `${esc(v.a.name)} is married to <b>${esc(v.anchorA.name)}</b>, and ${esc(v.b.name)} is ${esc(v.anchorA.name)}’s ${esc(v.term.term)}.`
    : `${esc(v.b.name)} is married to <b>${esc(v.anchorB.name)}</b>, who is ${esc(v.a.name)}’s ${esc(v.term.term)}.`;
  answerEl.innerHTML = `
    <p class="kicker">${esc(v.a.name)} <span class="long">⟶</span> ${esc(v.b.name)}</p>
    <p class="term">No shared ancestor — <em>a tie by marriage</em>.</p>
    <p class="why">${clause}${overlapNote(v.a, v.b)}</p>
    ${metaLine(['by marriage', 'no shared blood'])}
    <p class="hops">${hopsHtml(v.path, '')}</p>`;
}

function renderProfile(person: Person): void {
  if (!state) return;
  const n = neighbours(state.db, person.id);
  const stamp =
    person.born && person.died
      ? `${person.born} – ${person.died}`
      : person.born
        ? `born ${person.born}`
        : person.died
          ? `died ${person.died}`
          : 'no dates recorded';
  const names = (people: Person[]): string => people.map((p) => esc(p.name)).join(', ');
  const lines: string[] = [];
  if (n.parents.length > 0) lines.push(`child of ${names(n.parents)}`);
  if (n.partners.length > 0) lines.push(`partner of ${names(n.partners)}`);
  if (n.children.length > 0) lines.push(`parent of ${names(n.children)}`);
  const rows = ledger(state.db, state.chart, person.id);
  answerEl.innerHTML = `
    <p class="kicker">${esc(stamp)}</p>
    <p class="term">${esc(person.name)}</p>
    <p class="why">${lines.length > 0 ? capitalise(lines.join('; ')) : 'Nobody connected to them yet.'}</p>
    ${metaLine([`${rows.filter((r) => r.kind === 'blood').length} by blood`, `${rows.filter((r) => r.kind === 'marriage').length} by marriage`])}
    <p class="actions"><button type="button" data-person-act="edit" data-id="${esc(person.id)}">Edit</button><button type="button" data-person-act="remove" data-id="${esc(person.id)}">Remove</button></p>
    <p class="mirror">Pick a second name to ask how they are related.</p>`;
  queryBox.hidden = true;
}

function twoNames(): [string, string] | null {
  if (!state) return null;
  const people = state.chart.people;
  if (people.length < 2) return null;
  const first = people[0] as Person;
  // a second name that is actually related to the first, if we can find one
  const related = people.slice(1).find((person) => {
    const verdict = findRelationship(state?.db as Db, first.id, person.id).verdict;
    return verdict.kind === 'blood' || verdict.kind === 'marriage';
  });
  const second = related ?? (people[1] as Person);
  return [firstName(first), firstName(second)];
}

function renderPrompt(): void {
  if (!state) return;
  const count = state.chart.people.length;
  const pair = twoNames();
  answerEl.innerHTML =
    count > 1 && pair
      ? `<p class="note">Two names, one question. Try <b>${esc(pair[0])}</b> and <b>${esc(pair[1])}</b> — or type a question below.</p>`
      : count === 1
        ? `<p class="note">One person so far. Add another, or import a file.</p>`
        : `<p class="note">The chart is empty. Import a GEDCOM file, or start from the sample family.</p>`;
  queryBox.hidden = true;
  askInput.placeholder = pair ? `How are ${pair[0]} and ${pair[1]} related?` : 'Ask about two people';
}

function answerPair(): void {
  if (!state) return;
  const [aId, bId] = state.subjects as [string, string];
  const answer = findRelationship(state.db, aId, bId);
  const v = answer.verdict;

  if (v.kind === 'blood') {
    state.path = v.path;
    renderBlood(v);
  } else if (v.kind === 'marriage') {
    state.path = v.path;
    renderMarriage(v);
  } else if (v.kind === 'shared-partner') {
    state.path = [v.a.id, v.hinge.id, v.b.id];
    answerEl.innerHTML = `
      <p class="kicker">${esc(v.a.name)} <span class="long">⟶</span> ${esc(v.b.name)}</p>
      <p class="term">Both married to <em>${esc(v.hinge.name)}</em>.</p>
      <p class="why">No shared ancestor either — the only line between them is a partnership they have in common.</p>
      ${metaLine(['by marriage'])}
      <p class="hops">${hopsHtml(state.path, v.hinge.id)}</p>`;
  } else if (v.kind === 'self') {
    state.path = [];
    draw();
    paintIndex();
    renderProfile(v.person);
    return;
  } else {
    state.path = [];
    answerEl.innerHTML = `
      <p class="kicker">${esc(v.a.name)} <span class="long">⟶</span> ${esc(v.b.name)}</p>
      <p class="term">Nothing connects them — <em>yet</em>.</p>
      <p class="note">Add the missing parent or partner and the line will appear.</p>`;
  }

  draw();
  paintIndex();
  queryBox.hidden = false;
  cypherEl.textContent = answer.cypher;
  queryMeta.textContent = `${v.kind} · ${answer.elapsedMs.toFixed(1)} ms · in-process WebAssembly, no network`;
}

/* ---------------- selection ---------------- */

function select(id: string): void {
  if (!state) return;
  const at = state.subjects.indexOf(id);
  const person = findPerson(state.chart, id);

  if (at !== -1) {
    state.subjects.splice(at, 1);
    state.path = [];
    rebuildView();
    draw();
    paintIndex();
    const remaining = state.subjects[0];
    if (!remaining) {
      renderPrompt();
    } else {
      const other = findPerson(state.chart, remaining);
      if (other) renderProfile(other);
    }
    return;
  }

  if (state.subjects.length >= 2) state.subjects = [];
  state.subjects.push(id);
  rebuildView();
  draw();
  paintIndex();
  if (state.subjects.length === 2) {
    answerPair();
  } else if (person) {
    renderProfile(person);
  }
}

function runAsk(text: string): void {
  if (!state) return;
  const ask = parseAsk(text, state.chart.people);

  if (ask.intent === 'relationship') {
    state.subjects = [ask.a, ask.b];
    rebuildView();
    draw();
    paintIndex();
    answerPair();
    return;
  }

  if (ask.intent === 'neighbours') {
    const person = findPerson(state.chart, ask.who);
    if (!person) return;
    const n = neighbours(state.db, person.id);
    const which = ask.which === 'parents' ? n.parents : ask.which === 'children' ? n.children : n.partners;
    state.subjects = [ask.who];
    state.path = [];
    rebuildView();
    draw();
    paintIndex();
    answerEl.innerHTML = `
      <p class="kicker">${esc(person.name)}</p>
      <p class="term">${which.length === 0 ? `No ${ask.which} recorded.` : which.map((p) => `<em>${esc(p.name)}</em>`).join(', ')}</p>
      <p class="why">${which.length === 0 ? 'Add one and it will show on the chart.' : `That is ${which.length === 1 ? 'the only one' : `${numberWord(which.length)} of them`} in this chart.`}</p>`;
    queryBox.hidden = true;
    return;
  }

  if (ask.intent === 'person') {
    select(ask.who);
    return;
  }

  answerEl.innerHTML = `<p class="note">I can only read names I know. Ask “how are <b>Ada</b> and <b>Milo</b> related?”, or pick two names on the chart.</p>`;
}

/* ---------------- editing ---------------- */

function slug(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'person';
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

function fillSelect(target: HTMLSelectElement, people: Person[], selected?: string): void {
  target.innerHTML = [`<option value="">—</option>`]
    .concat(
      people
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (person) =>
            `<option value="${esc(person.id)}"${person.id === selected ? ' selected' : ''}>${esc(person.name)}</option>`,
        ),
    )
    .join('');
}

function openPersonDialog(person?: Person): void {
  if (!state) return;
  editing = person?.id ?? null;
  addForm.reset();
  fillSelect(el<HTMLSelectElement>('#f-mother'), state.chart.people);
  fillSelect(el<HTMLSelectElement>('#f-father'), state.chart.people);
  fillSelect(el<HTMLSelectElement>('#f-partner'), state.chart.people);
  el<HTMLElement>('#add-title').textContent = person ? 'Edit this person' : 'Add a person';
  el<HTMLElement>('#add-note').textContent = person
    ? 'Relationships are edited on the chart: remove the person and add them again to change parents.'
    : '';
  if (person) {
    el<HTMLInputElement>('#f-name').value = person.name;
    el<HTMLSelectElement>('#f-sex').value = person.sex;
    el<HTMLInputElement>('#f-born').value = person.born ? String(person.born) : '';
    el<HTMLInputElement>('#f-died').value = person.died ? String(person.died) : '';
  }
  dialog.showModal();
}

function savePerson(): void {
  if (!state) return;
  const data = new FormData(addForm);
  const name = String(data.get('name') ?? '').trim();
  if (!name) return;
  const sex = String(data.get('sex') ?? 'X');
  const born = String(data.get('born') ?? '').trim();
  const died = String(data.get('died') ?? '').trim();

  if (editing) {
    state.db.run('MATCH (p:Person {id: $id}) SET p.name = $name, p.sex = $sex, p.born = $born, p.died = $died', {
      id: editing,
      name,
      sex,
      born: born ? Number(born) : null,
      died: died ? Number(died) : null,
    });
    const id = editing;
    editing = null;
    refresh();
    const person = findPerson(state.chart, id);
    if (person) renderProfile(person);
    return;
  }

  const mother = String(data.get('mother') ?? '');
  const father = String(data.get('father') ?? '');
  const partner = String(data.get('partner') ?? '');
  const taken = new Set(state.chart.people.map((person) => person.id));
  const id = slug(name, taken);

  state.db.run('CREATE (:Person {id: $id, name: $name, sex: $sex, born: $born, died: $died})', {
    id,
    name,
    sex,
    born: born ? Number(born) : null,
    died: died ? Number(died) : null,
  });
  for (const parent of [mother, father]) {
    if (!parent) continue;
    state.db.run('MATCH (p:Person {id: $parent}), (c:Person {id: $child}) MERGE (p)-[:PARENT]->(c)', {
      parent,
      child: id,
    });
  }
  if (partner) {
    state.db.run('MATCH (a:Person {id: $a}), (b:Person {id: $b}) MERGE (a)-[:PARTNER]->(b)', {
      a: partner,
      b: id,
    });
  }
  state.subjects = [id];
  state.path = [];
  refresh();
  const person = findPerson(state.chart, id);
  if (person) renderProfile(person);
}

function removePerson(id: string): void {
  if (!state) return;
  const person = findPerson(state.chart, id);
  if (!person) return;
  if (!window.confirm(`Remove ${person.name} from the chart? Their links go with them.`)) return;
  state.db.run('MATCH (p:Person {id: $id}) DETACH DELETE p', { id });
  state.subjects = state.subjects.filter((subject) => subject !== id);
  state.path = [];
  refresh();
  renderPrompt();
}

/* ---------------- files ---------------- */

function saveJson(): void {
  if (!state) return;
  const blob = new Blob([JSON.stringify({ app: 'kin', version: 1, ...state.chart }, null, 2)], {
    type: 'application/json',
  });
  download(blob, 'kin-family.json');
}

function saveGedcom(): void {
  if (!state) return;
  download(new Blob([fromChart(state.chart)], { type: 'text/plain' }), 'kin-family.ged');
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

interface FilePayload {
  people?: Person[];
  parents?: Edge[];
  partners?: Edge[];
}

async function loadFile(file: File): Promise<void> {
  if (!state) return;
  const text = await file.text();
  const isGedcom = /\.(ged|gedcom)$/i.test(file.name) || /(^|\n)0 HEAD/.test(text.slice(0, 400));

  let chart: Chart;
  if (isGedcom) {
    const parsed = parseGedcom(text);
    chart = toChart(parsed);
    if (parsed.warnings.length > 0) {
      answerEl.innerHTML = `<p class="kicker">Imported with notes</p><p class="term">${parsed.people.length} people</p><p class="why">${parsed.warnings.slice(0, 4).map(esc).join('<br>')}</p>`;
    }
  } else {
    const parsed = JSON.parse(text) as FilePayload;
    if (!Array.isArray(parsed.people)) throw new Error('not a Kin file');
    chart = {
      people: parsed.people,
      parents: parsed.parents ?? [],
      partners: parsed.partners ?? [],
    };
  }

  replaceChart(chart);
}

function replaceChart(chart: Chart): void {
  if (!state) return;
  clearAll(state.db);

  if (chart.people.length > 0) {
    state.db.run('UNWIND $rows AS r CREATE (:Person {id: r.id, name: r.name, sex: r.sex, born: r.born, died: r.died})', {
      rows: chart.people.map((person) => ({
        id: person.id,
        name: person.name,
        sex: person.sex,
        born: person.born ?? null,
        died: person.died ?? null,
      })),
    });
  }
  if (chart.parents.length > 0) {
    chunk(chart.parents, 400).forEach((rows) => {
      state?.db.run('UNWIND $rows AS r MATCH (p:Person {id: r.from}), (c:Person {id: r.to}) MERGE (p)-[:PARENT]->(c)', {
        rows,
      });
    });
  }
  if (chart.partners.length > 0) {
    chunk(chart.partners, 400).forEach((rows) => {
      state?.db.run('UNWIND $rows AS r MATCH (a:Person {id: r.from}), (b:Person {id: r.to}) MERGE (a)-[:PARTNER]->(b)', {
        rows,
      });
    });
  }

  state.subjects = [];
  state.path = [];
  state.focus = chart.people.length > BIG ? 2 : 'all';
  refresh();
  renderPrompt();
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/* ---------------- the report ---------------- */

function openReport(): void {
  if (!state) return;
  const chart = state.chart;
  if (chart.people.length === 0) {
    reportEl.innerHTML = '<h2>Checks</h2><p class="empty">The chart is empty.</p>';
    reportDialog.showModal();
    return;
  }

  const facts: Insights = analyse(state.db, chart);
  const chain = longestChain(chart);
  const pair = state.subjects.length === 2 ? state.subjects : [];

  const fact = (label: string, value: string | number, note = ''): string =>
    `<div><dt>${label}</dt><dd>${value}${note ? ` <small>${note}</small>` : ''}</dd></div>`;

  const cousinRows =
    facts.consanguineous.length === 0
      ? '<p class="empty">No couple in this chart shares an ancestor.</p>'
      : `<ul class="rows">${facts.consanguineous
          .map(
            (pair_) =>
              `\n<li><span>${esc(pair_.a.name)} × ${esc(pair_.b.name)}</span><span class="leader"></span><span class="note">${esc(pair_.term.term)}, ${pair_.shared} shared</span></li>`,
          )
          .join('')}</ul>`;

  const gaps: string[] = [];
  if (facts.undated.length > 0) {
    gaps.push(
      `No birth year for ${facts.undated.length} ${facts.undated.length === 1 ? 'person' : 'people'}: ${facts.undated
        .slice(0, 6)
        .map((p) => esc(p.name))
        .join(', ')}${facts.undated.length > 6 ? '…' : ''}`,
    );
  }
  if (facts.isolated.length > 0) {
    gaps.push(`Unconnected: ${facts.isolated.map((p) => esc(p.name)).join(', ')}`);
  }
  if (gaps.length === 0) gaps.push('Nothing missing: every person has a birth year and at least one link.');

  reportEl.innerHTML = `
    <h2>Checks</h2>
    <p class="lede">Everything below is a walk of this graph, run in the tab.</p>
    <dl class="facts">
      ${fact('People', facts.people)}
      ${fact('Generations', facts.generations)}
      ${fact('Families', facts.surnames, 'surnames')}
      ${fact('Parent links', facts.parentLinks)}
      ${fact('Partnerships', facts.partnerLinks)}
      ${fact('Span', facts.span ? `${facts.span.from}–${facts.span.to}` : '—')}
    </dl>

    <h3>Cousins who married</h3>
    ${cousinRows}

    <h3>Longest unbroken line</h3>
    ${
      chain.length > 1
        ? `<ul class="rows"><li><span>${chain.map((p) => esc(p.name)).join(' <span class="note">→</span> ')}</span><span class="leader"></span><span class="note">${chain.length} generations</span></li></ul>`
        : '<p class="empty">No parent chain longer than one link.</p>'
    }

    <h3>Who connects them?</h3>
    <p class="asker">
      <select id="ask-a">${optionsFor(chart, pair[0])}</select>
      <select id="ask-b">${optionsFor(chart, pair[1])}</select>
      <select id="ask-c">${optionsFor(chart, undefined, '— third, optional —')}</select>
      <button type="button" id="ask-go">Find</button>
    </p>
    <p class="answer-line" id="ask-out"></p>

    <h3>Missing</h3>
    <p class="empty">${gaps.join('<br>')}</p>
  `;

  reportDialog.showModal();
  const run = (): void => {
    const ids = ['ask-a', 'ask-b', 'ask-c']
      .map((id) => el<HTMLSelectElement>(`#${id}`).value)
      .filter(Boolean);
    const out = el<HTMLElement>('#ask-out');
    if (ids.length < 2) {
      out.textContent = 'Pick at least two people.';
      return;
    }
    const shared = commonAncestorsOf(state?.db as Db, state?.chart as Chart, ids);
    if (shared.length === 0) {
      out.innerHTML = `<b>${ids.length === 2 ? 'Those two' : 'Those three'} share no ancestor</b> in this chart — any tie between them runs through a partnership.`;
      return;
    }
    const top = shared.slice(0, 2);
    const names = top
      .map((row) => `<b>${esc(row.ancestor.name)}</b> (${row.distances.join(', ')} generations away)`)
      .join(', ');
    out.innerHTML = `${ids.length === 2 ? 'Closest shared ancestor' : 'Closest shared ancestors'}: ${names}. ${shared.length} in common.`;
  };
  el<HTMLButtonElement>('#ask-go').addEventListener('click', run);
}

function optionsFor(chart: Chart, selected?: string, blank = '—'): string {
  return [`<option value="">${esc(blank)}</option>`]
    .concat(
      chart.people
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (person) =>
            `<option value="${esc(person.id)}"${person.id === selected ? ' selected' : ''}>${esc(person.name)}</option>`,
        ),
    )
    .join('');
}

/* ---------------- boot ---------------- */

async function boot(): Promise<void> {
  const db = await openDb();
  seedSample(db);
  const chart = loadChart(db);
  state = { db, chart, view: chart, layout: layoutChart(chart), subjects: [], path: [], focus: 'all', hidden: 0 };
  refresh();

  const params = new URLSearchParams(location.search);
  const anchor = params.get('a');
  const partner = params.get('b');
  const focus = params.get('focus');
  if (focus === '2' || focus === '3') state.focus = Number(focus);
  if (anchor && findPerson(state.chart, anchor)) {
    state.subjects = [anchor];
    const second = partner ? findPerson(state.chart, partner) : null;
    if (second) state.subjects.push(second.id);
    rebuildView();
    draw();
    paintIndex();
    if (state.subjects.length === 2) {
      answerPair();
    } else {
      const only = findPerson(state.chart, anchor);
      if (only) renderProfile(only);
    }
  } else {
    renderPrompt();
    if (findPerson(chart, 'ada') && findPerson(chart, 'theo')) {
      state.subjects = ['ada', 'theo'];
      answerPair();
    }
  }

  el<HTMLButtonElement>('[data-act="sample"]').addEventListener('click', () => {
    if (!state) return;
    clearAll(state.db);
    seedSample(state.db);
    state.subjects = [];
    state.path = [];
    state.focus = 'all';
    refresh();
    renderPrompt();
  });

  el<HTMLButtonElement>('[data-act="add"]').addEventListener('click', () => openPersonDialog());
  el<HTMLButtonElement>('[data-act="save"]').addEventListener('click', saveJson);
  el<HTMLButtonElement>('[data-act="report"]').addEventListener('click', openReport);
  el<HTMLButtonElement>('#export-ged').addEventListener('click', saveGedcom);

  const importButton = el<HTMLButtonElement>('[data-act="import"]');
  importButton.addEventListener('click', () => gedFile.click());
  gedFile.addEventListener('change', () => {
    const file = gedFile.files?.[0];
    if (file) void loadFile(file);
    gedFile.value = '';
  });

  addForm.addEventListener('submit', (event) => {
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value === 'add') savePerson();
  });

  chartEl.addEventListener('click', (event) => {
    const node = (event.target as Element).closest('.person');
    const id = node?.getAttribute('data-id');
    if (id) select(id);
  });

  answerEl.addEventListener('click', (event) => {
    const target = (event.target as Element).closest('[data-person-act]');
    if (!target) return;
    const id = target.getAttribute('data-id') ?? '';
    if (target.getAttribute('data-person-act') === 'remove') removePerson(id);
    if (target.getAttribute('data-person-act') === 'edit') {
      const person = findPerson(state?.chart ?? chart, id);
      if (person) openPersonDialog(person);
    }
  });

  ledgerEl.addEventListener('click', (event) => {
    const id = (event.target as Element).closest('button')?.getAttribute('data-pick');
    if (id) select(id);
  });

  focusBox.addEventListener('click', (event) => {
    const value = (event.target as Element).closest('button')?.getAttribute('data-focus');
    if (!value || !state) return;
    state.focus = value === 'all' ? 'all' : Number(value);
    rebuildView();
    draw();
  });

  askForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runAsk(askInput.value);
  });

  const shell = el<HTMLElement>('.chart-shell');
  shell.addEventListener('dragover', (event) => {
    event.preventDefault();
    shell.classList.add('drop-target');
  });
  shell.addEventListener('dragleave', () => shell.classList.remove('drop-target'));
  shell.addEventListener('drop', (event) => {
    event.preventDefault();
    shell.classList.remove('drop-target');
    const file = event.dataTransfer?.files?.[0];
    if (file) void loadFile(file);
  });
}

void boot();
