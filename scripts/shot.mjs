/**
 * Screenshots of the built app, at the sizes a judge will actually see it.
 *
 *   node scripts/shot.mjs            # all
 *   node scripts/shot.mjs hero       # one
 */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import { startServer } from './serve.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const CHROME =
  process.env.KIN_CHROME ??
  'C:/Users/张一/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';

const only = process.argv[2] ?? '';

async function main() {
  await mkdir(resolve(root, 'shots'), { recursive: true });
  const server = await startServer(resolve(root, 'dist'), 0);
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-svg .person', { timeout: 30000 });
    await page.waitForTimeout(600);

    const shot = async (name, action) => {
      if (only && only !== name) return;
      if (action) await action(page);
      await page.waitForTimeout(320);
      await page.screenshot({ path: resolve(root, 'shots', `${name}.png`) });
      process.stdout.write(`shots/${name}.png\n`);
    };

    await shot('01-hero', null);

    await shot('02-cousins-removed', async (p) => {
      await p.fill('#q', 'how are Milo and Theo related');
      await p.press('#q', 'Enter');
    });

    await shot('03-marriage', async (p) => {
      await p.fill('#q', 'how are Wilma and Suze related');
      await p.press('#q', 'Enter');
    });

    await shot('04-half-sister', async (p) => {
      await p.fill('#q', 'how are Daan and Noor related');
      await p.press('#q', 'Enter');
    });

    await shot('05-picked-one', async (p) => {
      await p.click('.person[data-id="rosa"] .hit');
    });

    await shot('06-phone', async (p) => {
      await p.setViewportSize({ width: 430, height: 900 });
      await p.reload({ waitUntil: 'networkidle' });
      await p.waitForSelector('.chart-svg .person');
    });
  } finally {
    await browser.close();
    await server.close();
  }
}

await main();
