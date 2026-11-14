/**
 * A synthetic village, for the scale story.
 *
 *   node scripts/make-big-ged.mjs > .tmp/village.ged
 *
 * Nine generations. Each generation pairs up inside itself the way a village
 * would, and every couple has two or three children, so the population holds
 * steady while the file grows. Nobody here is real.
 */

let next = 1;
const people = [];
const families = [];

const HOUSES = ['Village', 'Marsh', 'Field', 'Brook'];

function person(gen, sex, house) {
  const id = `I${next++}`;
  const home = house ?? HOUSES[next % HOUSES.length];
  people.push({ id, name: `${sex === 'M' ? 'Adam' : 'Eve'} ${home} ${String(next).padStart(4, '0')}`, sex, gen });
  return id;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const familyOf = new Map();
let cohort = [];
for (let i = 0; i < 60; i += 1) cohort.push(person(0, i % 2 === 0 ? 'M' : 'F'));

for (let gen = 0; gen < 9; gen += 1) {
  const men = shuffle(cohort.filter((id) => people.find((p) => p.id === id)?.sex === 'M'));
  const women = shuffle(cohort.filter((id) => people.find((p) => p.id === id)?.sex === 'F'));
  const pairList = [];
  const pool = [...women];
  for (const man of men) {
    const index = pool.findIndex((woman) => {
      const hers = familyOf.get(woman);
      const his = familyOf.get(man);
      return hers === undefined || his === undefined || hers !== his;
    });
    if (index === -1) continue;
    const wife = pool.splice(index, 1)[0];
    if (!wife) continue;
    pairList.push([man, wife]);
  }
  const next_cohort = [];
  for (let i = 0; i < pairList.length; i += 1) {
    const [man, wife] = pairList[i];
    const house = (people.find((p) => p.id === man)?.name.split(' ')[1]) ?? 'Village';
    const kids = [];
    const count = 2 + (i % 3 === 0 ? 1 : 0);
    for (let k = 0; k < count; k += 1) {
      const child = person(gen + 1, (i + k) % 2 === 0 ? 'M' : 'F', house);
      kids.push(child);
      next_cohort.push(child);
    }
    families.push({ id: `F${families.length + 1}`, husband: man, wife: wife, children: kids });
    for (const kid of kids) familyOf.set(kid, families.length);
  }
  cohort = next_cohort;
}

const lines = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8'];
for (const p of people) {
  if (p.gen > 8) continue;
  const [given, house, number] = p.name.split(' ');
  lines.push(`0 @${p.id}@ INDI`, `1 NAME ${given} /${house}/`, `1 SEX ${p.sex}`);
  const born = 1700 + p.gen * 28;
  lines.push('1 BIRT', `2 DATE ${born}`);
  lines.push('1 DEAT', `2 DATE ${born + 62 + (p.gen % 7)}`);
}
for (const f of families) {
  lines.push(`0 @${f.id}@ FAM`, `1 HUSB @${f.husband}@`, `1 WIFE @${f.wife}@`);
  for (const child of f.children) lines.push(`1 CHIL @${child}@`);
}
lines.push('0 TRLR');
process.stdout.write(`${lines.join('\n')}\n`);
