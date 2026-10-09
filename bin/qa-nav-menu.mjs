import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const EVIDENCE = resolve(process.env.MENU_EVIDENCE_DIR ?? '/tmp/stcaths-menu-evidence');
const SITE = 'https://st-catherines-school.webflow.io/';
const MARKERS = {
  'nav-menu_wrapper': { 'data-menu-motion': '', 'data-text-trigger': 'manual' },
  'nav-menu_link-text': { 'data-menu-label': '' },
  'nav-menu_group': { 'data-details-animate': 'false' },
  'nav-menu_heading': { 'data-menu-heading': '' },
  'nav-menu_back': { 'data-menu-back': '' },
  'nav-menu_expand-icon': { 'data-menu-icon': '' },
  'nav-menu_arrow-icon': { 'data-menu-icon': '' },
  'nav-menu_ornament': { 'data-menu-ornament': '' },
  'nav-menu_links-wrapper': { 'data-menu-surface': 'navigation' },
  'nav-menu_image': { 'data-menu-surface': 'image' },
  'nav-menu_quicklinks_component': { 'data-menu-surface': 'quicklinks' },
  'nav-menu_footer-wrapper': { 'data-menu-surface': 'footer' },
  'nav-menu_top-wrapper': { 'data-menu-surface': 'top' },
};
await mkdir(EVIDENCE, { recursive: true });
const { chromium } = await import(
  pathToFileURL(
    process.env.PLAYWRIGHT_MODULE ??
      '/Users/iggy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
  )
);
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  chromiumSandbox: true,
});
const css = await readFile(new URL('webflow/nav-menu-motion.css', ROOT), 'utf8');
const results = [];
try {
  for (const width of process.env.MENU_WIDTH
    ? [Number(process.env.MENU_WIDTH)]
    : [1440, 820, 667, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/gh/igniteagency/stcaths-webflow-site/**', async (route) => {
      const path = new URL(route.request().url()).pathname.split('/dist/prod/')[1];
      if (!path || path.includes('..')) return route.continue();
      const body = await readFile(new URL('dist/prod/' + path, ROOT));
      await route.fulfill({ body, contentType: 'text/javascript' });
    });
    await page.route(SITE, async (route) => {
      const response = await route.fetch();
      let html = await response.text();
      html = html
        .replace(/class="([^"]*)"/g, (whole, classes) => {
          const attrs = Object.assign({}, ...classes.split(/\s+/).map((name) => MARKERS[name]));
          return (
            whole +
            Object.entries(attrs)
              .map(([key, value]) => ` ${key}="${value}"`)
              .join('')
          );
        })
        .replace('</head>', `<style>${css}</style></head>`);
      await route.fulfill({ response, body: html });
    });
    await page.goto(SITE, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-menu-motion-ready]', { state: 'attached' });
    const menu = page.locator('[data-nav-menu-popover]');
    const open = page.locator('[popovertargetaction="show"]');
    const summary = menu.locator('details > summary').first();
    const group = menu.locator('details').first();
    const restored = () =>
      page.waitForFunction(
        () => !document.querySelector('[data-nav-menu-popover] [data-split]'),
        undefined,
        { timeout: 5000 }
      );
    const revealed = async (selector) => {
      await menu
        .locator(selector + ' [data-menu-label][data-split]')
        .first()
        .waitFor({ state: 'attached', timeout: 3000 });
      await restored();
    };
    const state = () =>
      menu.evaluate((el) => ({
        open: el.matches(':popover-open'),
        display: getComputedStyle(el).display,
        clip: getComputedStyle(el).clipPath,
        splits: el.querySelectorAll('[data-split]').length,
        selected: el.querySelector('details[open]')?.getAttribute('data-menu-section') ?? null,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
    await open.click();
    await menu
      .locator('[data-menu-label][data-split]')
      .first()
      .waitFor({ state: 'attached', timeout: 2500 });
    await page.waitForTimeout(320);
    const opening = await state();
    assert(opening.open);
    assert(opening.splits > 0, 'Menu labels must actually split during opening');
    await page.screenshot({ path: `${EVIDENCE}/${width}-opening.png` });
    await page.waitForTimeout(1500);
    assert.equal((await state()).splits, 0, 'Finished opening restores original labels');
    const names = await summary.innerText();
    assert(names.includes('Why St Catherine'));
    await page.screenshot({ path: `${EVIDENCE}/${width}-open.png` });
    await summary.click();
    await menu
      .locator('details[open] [data-split]')
      .first()
      .waitFor({ state: 'attached', timeout: 2500 });
    const submenu = await state();
    assert.equal(submenu.selected, '0', JSON.stringify({ submenu, errors }));
    await page.screenshot({ path: `${EVIDENCE}/${width}-submenu-entering.png` });
    assert(submenu.splits > 0, 'Submenu labels animate on selection');
    await page.waitForTimeout(1000);
    assert.equal((await state()).splits, 0);
    await page.screenshot({ path: `${EVIDENCE}/${width}-submenu.png` });
    await summary.click();
    await revealed('details:not([open]) > summary');
    assert.equal((await state()).selected, null);
    for (let index = 1; index < 5; index++) {
      const control = menu.locator('details > summary').nth(index);
      await control.click();
      await revealed('details[open]');
      assert.equal((await state()).selected, String(index));
      const overview = menu.locator('details[open] a').first();
      assert.equal(await overview.innerText(), 'Overview');
      await control.click();
      await revealed('details:not([open]) > summary');
      assert.equal((await state()).selected, null);
    }
    await summary.focus();
    await page.keyboard.press('Enter');
    await revealed('details[open]');
    assert.equal(await group.getAttribute('open'), '');
    assert.equal(await summary.evaluate((el) => document.activeElement === el), true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(130);
    const closing = await state();
    assert.equal(closing.open, false);
    assert.notEqual(closing.display, 'none', 'Native close remains painted during exit');
    await page.screenshot({ path: `${EVIDENCE}/${width}-closing.png` });
    await page.waitForTimeout(500);
    assert.equal((await state()).display, 'none');
    assert.equal(await open.evaluate((el) => document.activeElement === el), true);
    await open.click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(550);
    assert.equal((await state()).splits, 0);
    await open.click();
    await page.waitForTimeout(1500);
    assert.equal((await state()).selected, null, 'Reopening starts on main menu');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await summary.click();
    assert.equal((await state()).selected, '0');
    assert.equal((await state()).splits, 0);
    await menu.locator('[popovertargetaction="hide"]').click();
    assert.equal((await state()).display, 'none');
    assert.equal((await state()).overflow, false);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open.click();
    await page.waitForTimeout(250);
    await page.setViewportSize({ width: width + 2, height: 960 });
    await page.waitForTimeout(50);
    assert.equal((await state()).splits, 0, 'Resize restores readable labels');
    await summary.click();
    await page.waitForTimeout(80);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(
      () => document.querySelector('[data-menu-section="0"]')?.open,
      undefined,
      {
        timeout: 1500,
      }
    );
    assert.equal((await state()).selected, '0', 'Reduced motion settles the requested panel');
    assert.equal((await state()).splits, 0);
    const href = await menu.locator('details[open] a').first().getAttribute('href');
    await page.route(new URL(href, SITE).href, (route) =>
      route.fulfill({ body: '<h1>Navigation succeeded</h1>', contentType: 'text/html' })
    );
    await menu.locator('details[open] a').first().click();
    await page.waitForURL(new URL(href, SITE).href);
    assert.equal(await page.locator('h1').innerText(), 'Navigation succeeded');
    assert.deepEqual(errors, [], 'No page errors during the menu lifecycle');
    results.push({ width, opening, submenu, closing, errors });
    await page.close();
  }
  await writeFile(
    `${EVIDENCE}/results.json`,
    JSON.stringify({ status: 'passed', browser: browser.version(), results }, null, 2)
  );
  console.log(JSON.stringify({ status: 'passed', evidence: EVIDENCE, results }, null, 2));
} catch (error) {
  await writeFile(
    `${EVIDENCE}/results.json`,
    JSON.stringify({ status: 'failed', message: error.stack, results }, null, 2)
  );
  throw error;
} finally {
  await browser.close();
}
