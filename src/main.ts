/**
 * Wiring: the chart on the left, the answer on the right, and the one
 * interaction the whole app is built around — pick two names, read the line.
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
  type MarriageVerdict,
  type Person,
} from './relatives';
import { layoutChart, type Layout } from './layout';
import { renderChart } from './render';
import { parseAsk } from './ask';

interface State {
  db: Db;
  chart: Chart;
  layout: Layout;
  subjects: string[];
  path: string[];
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
const queryBox = el<HTMLDetailsElement>('#query');
const cypherEl = el<HTMLElement>('#cypher');
const queryMeta = el<HTMLParagraphElement>('#query-meta');
const askForm = el<HTMLFormElement>('#ask');
const askInput = el<HTMLInputElement>('#q');
const dialog = el<HTMLDialogElement>('#add-dialog');
const addForm = el<HTMLFormElement>('#add-form');

let state: State | null = null;

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

function refresh(): void {
  if (!state) return;
  const chart = loadChart(state.db);
  state.chart = chart;
  state.layout = layoutChart(chart);
  state.subjects = state.subjects.filter((id) => findPerson(chart, id));
  if (state.subjects.length < 2) state.path = [];
  draw();
  paintIndex();
}

function draw(): void {
  if (!state) return;
  renderChart(chartEl, {
    chart: state.chart,
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
  runRight.textContent = [span, `${state.layout.rows.length} generations`].filter(Boolean).join(' · ');
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
          `<li data-id="${esc(person.id)}"><button type="button" data-pick="${esc(person.id)}"><span class="who">${esc(person.name)}</span><span class="leader"></span><span class="rel">${person.born ?? ''}</span></button></li>`,
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
    <p class="why">${sentence}</p>
    ${metaLine(meta)}
    ${legsHtml(v.path, v.up, v.ancestor.id)}
    <p class="mirror">Which makes ${esc(firstName(v.a))} ${esc(v.b.name)}’s ${esc(v.backward.term)}.</p>`;
}

function renderMarriage(v: MarriageVerdict, elapsed: number): void {
  const clause = v.aLinked
    ? `${esc(v.a.name)} is married to <b>${esc(v.anchorA.name)}</b>, and ${esc(v.b.name)} is ${esc(v.anchorA.name)}’s ${esc(v.term.term)}.`
    : `${esc(v.b.name)} is married to <b>${esc(v.anchorB.name)}</b>, who is ${esc(v.a.name)}’s ${esc(v.term.term)}.`;
  answerEl.innerHTML = `
    <p class="kicker">${esc(v.a.name)} <span class="long">⟶</span> ${esc(v.b.name)}</p>
    <p class="term">No shared ancestor — <em>a tie by marriage</em>.</p>
    <p class="why">${clause} One side is blood, the other arrives by a partnership, and the chart draws both the same way.</p>
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
    <p class="mirror">Pick a second name to ask how they are related.</p>`;
  queryBox.hidden = true;
}

function renderPrompt(): void {
  answerEl.innerHTML = `<p class="note">Two names, one question. Try <b>Ada</b> and <b>Theo</b> — or type it: “how are Milo and Rosa related?”</p>`;
  queryBox.hidden = true;
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
    renderMarriage(v, answer.elapsedMs);
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

function fillSelect(target: HTMLSelectElement, people: Person[]): void {
  target.innerHTML = [`<option value="">—</option>`]
    .concat(
      people
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((person) => `<option value="${esc(person.id)}">${esc(person.name)}</option>`),
    )
    .join('');
}

function openAddDialog(): void {
  if (!state) return;
  addForm.reset();
  fillSelect(el<HTMLSelectElement>('#f-mother'), state.chart.people);
  fillSelect(el<HTMLSelectElement>('#f-father'), state.chart.people);
  fillSelect(el<HTMLSelectElement>('#f-partner'), state.chart.people);
  dialog.showModal();
}

function addPerson(): void {
  if (!state) return;
  const data = new FormData(addForm);
  const name = String(data.get('name') ?? '').trim();
  if (!name) return;
  const sex = String(data.get('sex') ?? 'X');
  const born = String(data.get('born') ?? '').trim();
  const died = String(data.get('died') ?? '').trim();
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

/* ---------------- save / load ---------------- */

function saveJson(): void {
  if (!state) return;
  const payload = {
    app: 'kin',
    version: 1,
    people: state.chart.people,
    parents: state.chart.parents,
    partners: state.chart.partners,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kin-family.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function loadJson(file: File): Promise<void> {
  if (!state) return;
  const parsed = JSON.parse(await file.text()) as {
    people?: Person[];
    parents?: Array<{ from: string; to: string }>;
    partners?: Array<{ from: string; to: string }>;
  };
  if (!Array.isArray(parsed.people)) throw new Error('not a Kin file');
  clearAll(state.db);
  for (const person of parsed.people) {
    state.db.run('CREATE (:Person {id: $id, name: $name, sex: $sex, born: $born, died: $died})', {
      id: person.id,
      name: person.name,
      sex: person.sex,
      born: person.born ?? null,
      died: person.died ?? null,
    });
  }
  for (const edge of parsed.parents ?? []) {
    state.db.run('MATCH (p:Person {id: $from}), (c:Person {id: $to}) MERGE (p)-[:PARENT]->(c)', edge);
  }
  for (const edge of parsed.partners ?? []) {
    state.db.run('MATCH (a:Person {id: $from}), (b:Person {id: $to}) MERGE (a)-[:PARTNER]->(b)', edge);
  }
  state.subjects = [];
  refresh();
  renderPrompt();
}

/* ---------------- boot ---------------- */

async function boot(): Promise<void> {
  const db = await openDb();
  seedSample(db);
  const chart = loadChart(db);
  state = { db, chart, layout: layoutChart(chart), subjects: [], path: [] };
  refresh();
  renderPrompt();

  el<HTMLButtonElement>('[data-act="sample"]').addEventListener('click', () => {
    if (!state) return;
    clearAll(state.db);
    seedSample(state.db);
    state.subjects = [];
    state.path = [];
    refresh();
    renderPrompt();
  });

  el<HTMLButtonElement>('[data-act="add"]').addEventListener('click', openAddDialog);
  el<HTMLButtonElement>('[data-act="save"]').addEventListener('click', saveJson);

  addForm.addEventListener('submit', (event) => {
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value === 'add') addPerson();
  });

  chartEl.addEventListener('click', (event) => {
    const node = (event.target as Element).closest('.person');
    const id = node?.getAttribute('data-id');
    if (id) select(id);
  });

  ledgerEl.addEventListener('click', (event) => {
    const id = (event.target as Element).closest('button')?.getAttribute('data-pick');
    if (id) select(id);
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
    if (file) void loadJson(file);
  });

  // first look: answer the question the app is named after
  if (findPerson(chart, 'ada') && findPerson(chart, 'theo')) {
    state.subjects = ['ada', 'theo'];
    answerPair();
  }
}

void boot();
