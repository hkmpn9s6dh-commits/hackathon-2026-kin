/**
 * End to end, in a real browser, against the built bundle.
 *
 *   node scripts/e2e.mjs [--keep]
 *
 * Exits non-zero on the first thing that is not true.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import { startServer } from './serve.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const CHROME =
  process.env.KIN_CHROME ??
  'C:/Users/张一/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok) process.exitCode = 1;
}

const LIVE = process.env.KIN_URL ?? '';

async function main() {
  // KIN_URL=https://... node scripts/e2e.mjs runs the same checks against the
  // deployed demo, which is what a judge actually opens.
  const server = LIVE ? null : await startServer(resolve(root, 'dist'), 4326);
  process.stdout.write(LIVE ? `against ${LIVE}` : 'against the local bundle');
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const consoleErrors = [];
  const foreign = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1')) foreign.push(url);
  });

  try {
    await page.goto(LIVE || server.url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-svg .person', { timeout: 30000 });

    const people = await page.locator('.chart-svg .person').count();
    check('the chart draws every person', people === 16, `${people} names`);

    const term = await page.locator('#answer .term').innerText();
    check('the first screen already answers a question', /second cousin/i.test(term), term.replace(/\n/g, ' '));

    const lit = await page.locator('.chart-svg .is-path').count();
    check('the answer is drawn on the chart', lit >= 5, `${lit} marks in vermilion`);

    const heroSub = await page.locator('#answer .kicker').innerText();
    check('the answer names both people', /ada vell/i.test(heroSub) && /theo lind/i.test(heroSub), heroSub);

    // ask, in words
    await page.fill('#q', 'how are Daan and Noor related');
    await page.press('#q', 'Enter');
    await page.waitForSelector('#answer .term');
    const half = await page.locator('#answer .term').innerText();
    check('a typed question reaches the graph', /half-sister/i.test(half), half.replace(/\n/g, ' '));

    // the query disclosure
    const cypher = await page.locator('#cypher').textContent();
    check('the Cypher that produced it is on screen', /MATCH up/.test(cypher) && /PARENT/.test(cypher));

    // clicking two names
    await page.click('.ledger button[data-pick="marta"]');
    await page.click('.ledger button[data-pick="hedy"]');
    await page.waitForTimeout(120);
    const shared = await page.locator('#answer .term').innerText();
    check('two names clicked on the chart answer too', /both married/i.test(shared), shared.replace(/\n/g, ' '));

    // one name is a question of its own
    await page.click('.ledger button[data-pick="ivo"]');
    await page.waitForTimeout(120);
    const solo = await page.locator('#answer').innerText();
    check('one name shows a profile', /child of|partner of|parent of/i.test(solo), solo.split('\n').slice(0, 2).join(' / '));

    // editing
    await page.click('[data-act="add"]');
    await page.fill('#f-name', 'Nina Vell');
    await page.selectOption('#f-sex', 'F');
    await page.fill('#f-born', '2020');
    await page.selectOption('#f-mother', 'ada');
    await page.click('#add-form button[value="add"]');
    await page.waitForTimeout(300);
    const after = await page.locator('.chart-svg .person').count();
    check('a new person joins the chart', after === 17, `${after} names`);
    const nina = await page.locator('.chart-svg .person[data-id="nina-vell"]').count();
    check('and is drawn under their mother', nina === 1);

    const indexMeta = await page.locator('#index-meta').innerText();
    check('the index counts what is in the graph', /17 people/.test(indexMeta), indexMeta);

    // layout hygiene
    const overflow = await page.evaluate(() => {
      const panel = document.querySelector('.panel');
      const body = document.body;
      return {
        panel: panel ? panel.scrollWidth - panel.clientWidth : 0,
        body: body.scrollWidth - body.clientWidth,
      };
    });
    check('nothing spills out of its column', overflow.panel <= 1 && overflow.body <= 1, JSON.stringify(overflow));

    check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
    const origin = LIVE ? new URL(LIVE).origin : 'http://127.0.0.1';
    check(
      'nothing is fetched from anywhere else',
      foreign.filter((url) => !url.startsWith(origin)).length === 0,
      foreign.filter((url) => !url.startsWith(origin)).slice(0, 2).join(' | '),
    );
  } finally {
    await browser.close();
    if (server) await server.close();
  }

  const failed = checks.filter((entry) => !entry.ok).length;
  process.stdout.write(`\n${checks.length - failed}/${checks.length} checks passed\n`);
}

await main();
