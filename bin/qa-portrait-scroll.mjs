import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SITE = 'https://st-catherines-school.webflow.io/why-st-catherines';
const LIVE = process.env.PORTRAIT_LIVE === '1';
const OUT = resolve(process.env.PORTRAIT_EVIDENCE_DIR ?? '/tmp/stcaths-portrait-evidence');
const before = !LIVE ? (await readFile(process.env.PORTRAIT_BEFORE_EMBED_PATH, 'utf8')).trim() : '';
const after = !LIVE ? (await readFile(process.env.PORTRAIT_EMBED_PATH, 'utf8')).trim() : '';
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
await mkdir(OUT, { recursive: true });
const results = [];
let current;
async function open(width, mode = 'normal', height = 979) {
  const page = await browser.newPage({
    viewport: { width, height },
    reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference',
  });
  current = page;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (!LIVE) {
    await page.route('**/gh/igniteagency/stcaths-webflow-site/**', async (route) => {
      const file = new URL(route.request().url()).pathname.split('/dist/prod/')[1];
      if (!file || file.includes('..')) return route.continue();
      if (mode === 'blocked-js' && file === 'components/portrait-scroll.js') return route.abort();
      return route.fulfill({
        body: await readFile(new URL('dist/prod/' + file, ROOT)),
        contentType: 'text/javascript',
      });
    });
    await page.route(SITE, async (route) => {
      const response = await route.fetch();
      let html = await response.text();
      assert(html.includes(before), 'Existing portrait embed found');
      html = html.replace(before, mode === 'no-css' ? '' : after);
      html = html.replace(
        'class="section_editorial-portrait-scroll"',
        'class="section_editorial-portrait-scroll" data-portrait-scroll="" data-text-trigger="manual"'
      );
      await route.fulfill({ response, body: html });
    });
  }
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.stCathsTextReveal);
  await page.evaluate(() => document.fonts.ready);
  if (!['blocked-js', 'no-css'].includes(mode))
    await page.waitForFunction(() =>
      [...document.scripts].some((s) => s.src.includes('components/portrait-scroll.js'))
    );
  await page.waitForTimeout(600);
  return { page, errors };
}
async function state(page) {
  return page.locator('[data-portrait-scroll]').evaluate((section) => ({
    ready: section.querySelector('.portrait-scroll_component').hasAttribute('data-portrait-ready'),
    overflow: document.documentElement.scrollWidth > innerWidth,
    panels: [...section.querySelectorAll('[data-portrait-moment]')].map((p) => ({
      active: p.hasAttribute('data-active'),
      leaving: p.hasAttribute('data-leaving'),
      inert: p.inert,
      hidden: p.getAttribute('aria-hidden'),
      state: p.dataset.portraitTextState,
      visibility: getComputedStyle(p).visibility,
      mask: getComputedStyle(p.querySelector('.portrait-scroll_heading')).clipPath,
      opacity: +getComputedStyle(p.querySelector('.portrait-scroll_heading')).opacity,
      split: p.querySelectorAll('[data-split]').length,
      image: getComputedStyle(p.querySelector('.portrait-scroll_visual > *')).transform,
    })),
  }));
}
async function scroll(page, index) {
  await page.locator('[data-portrait-scroll]').evaluate((section, index) => {
    const track = section.querySelector('.portrait-scroll_component');
    const stage = section.querySelector('.portrait-scroll_stage');
    const y =
      scrollY +
      track.getBoundingClientRect().top -
      parseFloat(getComputedStyle(stage).top) +
      innerHeight * 0.8 * index +
      20;
    scrollTo({ top: y, behavior: 'instant' });
  }, index);
}
async function settled(page, index) {
  await page.waitForFunction((index) => {
    const moments = [...document.querySelectorAll('[data-portrait-scroll] [data-portrait-moment]')];
    return (
      moments[index]?.hasAttribute('data-active') &&
      moments[index].dataset.portraitTextState === 'visible' &&
      !document.querySelector('[data-portrait-scroll] [data-leaving]') &&
      !moments[index].querySelector('[data-split]')
    );
  }, index);
}
async function partial(page, index) {
  return (
    await page.waitForFunction((index) => {
      const p = [...document.querySelectorAll('[data-portrait-scroll] [data-portrait-moment]')][
        index
      ];
      const chars = [...p.querySelectorAll('h2 [style]')].map(
        (el) => +getComputedStyle(el).opacity
      );
      if (p.dataset.portraitTextState !== 'visible' || !chars.some((x) => x > 0 && x < 1))
        return false;
      return {
        mask: getComputedStyle(p.querySelector('.portrait-scroll_heading')).clipPath,
        image: getComputedStyle(p.querySelector('.portrait-scroll_visual > *')).transform,
        heading: p.querySelector('h2').getAttribute('aria-label'),
        chars,
      };
    }, index)
  ).jsonValue();
}
try {
  for (const width of [1440, 992, 820, 667, 390]) {
    const { page, errors } = await open(width);
    const initial = await state(page);
    assert.equal(initial.panels.length, 3);
    assert(!initial.overflow);
    if (width >= 992) {
      assert(initial.ready);
      assert(initial.panels.slice(1).every((p) => p.inert && p.hidden === 'true'));
      await scroll(page, 0);
      const entrance = await partial(page, 0);
      assert.equal(entrance.mask, 'none');
      await settled(page, 0);
      await scroll(page, 1);
      const exit = await page.waitForFunction(() => {
        const p = document.querySelector('[data-portrait-scroll] [data-leaving]');
        if (!p) return false;
        const opacity = +getComputedStyle(p.querySelector('.portrait-scroll_heading')).opacity;
        return opacity > 0 && opacity < 1
          ? { opacity, inert: p.inert, state: p.dataset.portraitTextState }
          : false;
      });
      assert((await exit.jsonValue()).inert);
      const transition = await partial(page, 1);
      assert.equal(transition.mask, 'none');
      assert.equal(transition.heading, 'Character');
      await page.screenshot({ path: `${OUT}/${width}-transition.png` });
      await settled(page, 1);
      await scroll(page, 0);
      const reverse = await partial(page, 0);
      assert.equal(reverse.mask, 'none');
      await settled(page, 0);
      await scroll(page, 1);
      await partial(page, 1);
      await scroll(page, 2);
      await scroll(page, 0);
      await settled(page, 0);
      await scroll(page, 2);
      await settled(page, 2);
      const end = await state(page);
      assert(end.panels[2].active && !end.panels[2].inert);
      assert(end.panels.slice(0, 2).every((p) => p.inert && p.hidden === 'true'));
      await page.screenshot({ path: `${OUT}/${width}-complete.png` });
      await scroll(page, 1);
      await partial(page, 1);
      await page.locator('[data-portrait-scroll] [data-active] a').first().focus();
      await settled(page, 1);
      assert(
        await page
          .locator('[data-portrait-scroll] [data-active]')
          .evaluate((p) => p.contains(document.activeElement))
      );
      await page.evaluate(() => document.activeElement.blur());
      await scroll(page, 0);
      await partial(page, 0);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(
        () =>
          !document.querySelector('.portrait-scroll_component').hasAttribute('data-portrait-ready')
      );
      const reduced = await state(page);
      assert(reduced.panels.every((p) => !p.inert && p.hidden === null && p.split === 0));
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.waitForFunction(() =>
        document.querySelector('.portrait-scroll_component').hasAttribute('data-portrait-ready')
      );
      await scroll(page, 0);
      await settled(page, 0);
      // Responsive interruption must restore all complete articles.
      await scroll(page, 1);
      await partial(page, 1);
      await page.setViewportSize({ width: 820, height: 979 });
      await page.waitForFunction(
        () =>
          !document.querySelector('.portrait-scroll_component').hasAttribute('data-portrait-ready')
      );
      const resized = await state(page);
      assert(
        resized.panels.every(
          (p) => !p.inert && p.hidden === null && p.visibility === 'visible' && p.mask === 'none'
        )
      );
      results.push({ width, initial, entrance, transition, reverse, end, resized, errors });
    } else {
      assert(!initial.ready);
      assert(initial.panels.every((p) => !p.inert && p.visibility === 'visible'));
      await page
        .locator('.portrait-scroll_heading')
        .first()
        .evaluate((e) =>
          scrollTo({ top: scrollY + e.getBoundingClientRect().top - 180, behavior: 'instant' })
        );
      await page.waitForFunction(() =>
        document.querySelector('[data-portrait-scroll] [data-split]')
      );
      await page.waitForFunction(
        () => !document.querySelector('[data-portrait-scroll] [data-split]')
      );
      await page.screenshot({ path: `${OUT}/${width}-static.png` });
      results.push({ width, initial, final: await state(page), errors });
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Passed ${width}px`);
  }
  for (const mode of LIVE ? ['reduced', 'short'] : ['reduced', 'short', 'blocked-js', 'no-css']) {
    const { page, errors } = await open(1440, mode, mode === 'short' ? 600 : 979);
    const fallback = await state(page);
    assert(!fallback.ready);
    assert(
      fallback.panels.every(
        (p) => !p.inert && p.hidden === null && p.visibility === 'visible' && p.mask === 'none'
      )
    );
    assert.deepEqual(errors, []);
    results.push({ mode, fallback, errors });
    await page.close();
    console.log(`Passed ${mode}`);
  }
  await writeFile(`${OUT}/results.json`, JSON.stringify(results, null, 2));
} catch (error) {
  if (current && !current.isClosed()) {
    console.error(JSON.stringify(await state(current), null, 2));
    await current.screenshot({ path: `${OUT}/failure.png` });
  }
  throw error;
} finally {
  await browser.close();
}
