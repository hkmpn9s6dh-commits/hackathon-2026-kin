/**
 * Wiring: the chart on the left, the answer on the right, and the one
 * interaction the whole app is built around — pick two names, read the line.
 */

import './styles.css';
import { openDb, type Db } from './db';
import { SAMPLE_PEOPLE, clearAll, seedSample } from './sample';
import { findPerson, findRelationship, loadChart, neighbours, type Chart, type Person } from './relatives';
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
const answerEl = el<HTMLDivElement>('#answer');
const rosterEl = el<HTMLUListElement>('#roster');
const rosterMeta = el<HTMLParagraphElement>('#roster-meta');
const hintEl = el<HTMLParagraphElement>('#hint');
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

function refresh(): void {
  if (!state) return;
  const chart = loadChart(state.db);
  state.chart = chart;
  state.layout = layoutChart(chart);
  state.subjects = state.subjects.filter((id) => findPerson(chart, id));
  if (state.subjects.length < 2) state.path = [];
  draw();
  paintRoster();
}

function draw(): void {
  if (!state) return;
  renderChart(chartEl, {
    chart: state.chart,
    layout: state.layout,
    path: state.path,
    subjects: state.subjects,
  });
  hintEl.textContent =
    state.subjects.length === 0
      ? 'Pick two names to ask about them.'
      : state.subjects.length === 1
        ? 'Now pick the second name.'
        : 'Pick a name to start again.';
}

function paintRoster(): void {
  if (!state) return;
  const people = [...state.chart.people].sort((a, b) => a.name.localeCompare(b.name));
  rosterMeta.textContent = `${people.length} people, ${state.chart.parents.length} parent links, ${state.chart.partners.length} partnerships — all of it in this tab.`;
  rosterEl.innerHTML = people
    .map(
      (person) =>
        `<li class="${state?.subjects.includes(person.id) ? 'on' : ''}"><button type="button" data-pick="${esc(person.id)}">${esc(person.name)}</button></li>`,
    )
    .join('');
}

function select(id: string): void {
  if (!state) return;
  const at = state.subjects.indexOf(id);
  if (at !== -1) {
    state.subjects.splice(at, 1);
    state.path = [];
    draw();
    paintRoster();
    if (state.subjects.length < 2) renderPrompt();
    return;
  }
  if (state.subjects.length >= 2) state.subjects = [];
  state.subjects.push(id);
  draw();
  paintRoster();
  if (state.subjects.length === 2) {
    answerPair();
  } else {
    renderPrompt();
  }
}

function renderPrompt(): void {
  if (!state) return;
  if (state.subjects.length === 0) {
    answerEl.innerHTML = `<p class="empty-note">Two names, one question. Try <b>Ada</b> and <b>Theo</b> — or type it: “how are Milo and Rosa related?”</p>`;
  } else {
    const person = findPerson(state.chart, state.subjects[0] as string);
    const n = person ? neighbours(state.db, person.id) : null;
    answerEl.innerHTML = n
      ? `<p class="kicker">${esc(person?.name ?? '')}</p>
         <p class="plain">${describeNeighbours(n)}</p>
         <p class="empty-note" style="margin-top:12px">Pick one more name to ask how they are related.</p>`
      : '';
  }
  queryBox.hidden = true;
}

function describeNeighbours(n: ReturnType<typeof neighbours>): string {
  const list = (people: Person[], plural: string): string =>
    people.length === 0 ? `no ${plural} in the chart` : `${plural}: ${people.map((p) => `<b>${esc(p.name)}</b>`).join(', ')}`;
  return [list(n.parents, 'parents'), list(n.children, 'children'), list(n.partners, 'partners')]
    .map((line) => line.charAt(0).toUpperCase() + line.slice(1))
    .join('. ')
    .concat('.');
}

function chain(path: string[], ancestorId: string | null): string {
  if (!state) return '';
  const chart = state.chart;
  const names = path.map((id) => {
    const person = findPerson(chart, id);
    const label = esc(person?.name ?? id);
    return id === ancestorId ? `<span class="via">${label}</span>` : `<span class="link">${label}</span>`;
  });
  return names.join(' <span class="arrow">·</span> ');
}

function answerPair(): void {
  if (!state) return;
  const [aId, bId] = state.subjects as [string, string];
  const answer = findRelationship(state.db, aId, bId);
  const v = answer.verdict;

  if (v.kind === 'blood') {
    state.path = v.path;
    const badge = `${v.up} up · ${v.down} down`;
    const shared = v.shared === 1 ? 'one shared ancestor' : `${v.shared} shared ancestors`;
    answerEl.innerHTML = `
      <p class="kicker">${esc(v.a.name)} → ${esc(v.b.name)}</p>
      <p class="term">${esc(v.b.name)} is ${esc(v.a.name)}’s <em>${esc(v.forward.term)}</em>.</p>
      <p class="why">Climb ${v.up} ${v.up === 1 ? 'step' : 'steps'} from ${esc(firstName(v.a))} and ${v.down} from ${esc(firstName(v.b))} and the lines meet at <b>${esc(v.ancestor.name)}</b> — ${shared}.${v.up === 1 && v.down === 1 && !v.fullSibling ? ' They share one parent, not two.' : ''}</p>
      <span class="badge">${badge}</span><span class="badge">${shared}</span>
      <p class="chain">${chain(v.path, v.ancestor.id)}</p>
      <p class="mirror">Which makes ${esc(firstName(v.a))} ${esc(v.b.name)}’s ${esc(v.backward.term)}.</p>`;
  } else if (v.kind === 'marriage') {
    state.path = v.path;
    const clause = v.aLinked
      ? `${esc(v.a.name)} is married to <b>${esc(v.anchorA.name)}</b>, and ${esc(v.b.name)} is ${esc(v.anchorA.name)}’s ${esc(v.term.term)}.`
      : `${esc(v.b.name)} is married to <b>${esc(v.anchorB.name)}</b>, who is ${esc(v.a.name)}’s ${esc(v.term.term)}.`;
    answerEl.innerHTML = `
      <p class="kicker">${esc(v.a.name)} → ${esc(v.b.name)}</p>
      <p class="term">No shared ancestor — a tie by marriage.</p>
      <p class="why">${clause} Blood runs through one name; the other arrives by a partnership, and the chart draws both the same way.</p>
      <span class="badge">by marriage</span><span class="badge">no shared blood</span>
      <p class="chain">${chain(v.path, null)}</p>`;
  } else if (v.kind === 'shared-partner') {
    state.path = [v.a.id, v.hinge.id, v.b.id];
    answerEl.innerHTML = `
      <p class="kicker">${esc(v.a.name)} → ${esc(v.b.name)}</p>
      <p class="term">Both married to <em>${esc(v.hinge.name)}</em>.</p>
      <p class="why">No shared ancestor either — the only line between them is a partnership they have in common.</p>
      <span class="badge">by marriage</span>
      <p class="chain">${chain(state.path, v.hinge.id)}</p>`;
  } else if (v.kind === 'self') {
    state.path = [];
    answerEl.innerHTML = `<p class="kicker">${esc(v.person.name)}</p><p class="term">That is one person.</p>`;
  } else {
    state.path = [];
    answerEl.innerHTML = `
      <p class="kicker">${esc(v.a.name)} → ${esc(v.b.name)}</p>
      <p class="term">Nothing connects them — yet.</p>
      <p class="empty-note" style="margin-top:12px">Add the missing parent or partner and the line will appear.</p>`;
  }

  draw();
  queryBox.hidden = false;
  cypherEl.textContent = answer.cypher;
  queryMeta.textContent = `${v.kind} · ${answer.elapsedMs.toFixed(1)} ms · in-process WebAssembly, no network`;
}

function firstName(person: Person): string {
  return person.name.split(/\s+/)[0] ?? person.name;
}

function runAsk(text: string): void {
  if (!state) return;
  const ask = parseAsk(text, state.chart.people);
  if (ask.intent === 'relationship') {
    state.subjects = [ask.a, ask.b];
    draw();
    paintRoster();
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
    paintRoster();
    answerEl.innerHTML = `
      <p class="kicker">${esc(person.name)}</p>
      <p class="term">${
        which.length === 0
          ? `No ${ask.which} recorded.`
          : which.map((p) => `<em>${esc(p.name)}</em>`).join(', ')
      }</p>
      <p class="why">${which.length === 0 ? 'Add one and it will show on the chart.' : `That is ${which.length === 1 ? 'the only one' : `${which.length} of them`} in this chart.`}</p>`;
    queryBox.hidden = true;
    return;
  }
  if (ask.intent === 'person') {
    select(ask.who);
    return;
  }
  answerEl.innerHTML = `<p class="empty-note">I can only read names I know. Ask “how are <b>Ada</b> and <b>Milo</b> related?”, or pick two names on the chart.</p>`;
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

function fillSelect(select: HTMLSelectElement, people: Person[], skip?: string): void {
  const options = [`<option value="">—</option>`]
    .concat(
      people
        .filter((person) => person.id !== skip)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((person) => `<option value="${esc(person.id)}">${esc(person.name)}</option>`),
    )
    .join('');
  select.innerHTML = options;
}

function openAddDialog(): void {
  if (!state) return;
  const people = state.chart.people;
  addForm.reset();
  fillSelect(el<HTMLSelectElement>('#f-mother'), people);
  fillSelect(el<HTMLSelectElement>('#f-father'), people);
  fillSelect(el<HTMLSelectElement>('#f-partner'), people);
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

  state.db.run(
    `CREATE (:Person {id: $id, name: $name, sex: $sex, born: $born, died: $died})`,
    {
      id,
      name,
      sex,
      born: born ? Number(born) : null,
      died: died ? Number(died) : null,
    },
  );
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
  renderPrompt();
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
    state.db.run(
      `CREATE (:Person {id: $id, name: $name, sex: $sex, born: $born, died: $died})`,
      {
        id: person.id,
        name: person.name,
        sex: person.sex,
        born: person.born ?? null,
        died: person.died ?? null,
      },
    );
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

  rosterEl.addEventListener('click', (event) => {
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
  const ada = SAMPLE_PEOPLE.find((p) => p.id === 'ada');
  const theo = SAMPLE_PEOPLE.find((p) => p.id === 'theo');
  if (ada && theo) {
    state.subjects = [ada.id, theo.id];
    draw();
    paintRoster();
    answerPair();
  }
}

void boot();
