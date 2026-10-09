import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SITE = 'https://st-catherines-school.webflow.io/';
const EVIDENCE = resolve(process.env.STATISTICS_EVIDENCE_DIR ?? '/tmp/stcaths-statistics-evidence');
const embed = process.env.STATISTICS_COMPONENT_EMBED_PATH
  ? await readFile(resolve(process.env.STATISTICS_COMPONENT_EMBED_PATH), 'utf8')
  : '';
const { chromium } = await import(
  pathToFileURL(
    process.env.PLAYWRIGHT_MODULE ??
      '/Users/iggy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
  )
);
await mkdir(EVIDENCE, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  chromiumSandbox: true,
});
const results = [];
let activePage;

async function createPage(name, width = 1333, settings = {}) {
  const page = await browser.newPage({ viewport: { width, height: 979 }, ...settings });
  activePage = page;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/gh/igniteagency/stcaths-webflow-site/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/dist/prod/')[1];
    if (!path || path.includes('..')) return route.continue();
    if (name === 'blocked-js' && path === 'components/statistics.js') return route.abort();
    await route.fulfill({
      body: await readFile(new URL('dist/prod/' + path, ROOT)),
      contentType: 'text/javascript',
    });
  });
  await page.route(SITE, async (route) => {
    const response = await route.fetch();
    let html = (await response.text()).replace(
      /class="([^"]*)"/g,
      (whole, classes) =>
        whole +
        (classes.split(/\s+/).includes('academic-results_component')
          ? ' data-statistics=""'
          : classes.split(/\s+/).includes('academic-results_value')
            ? ' data-statistic-value=""'
            : '')
    );
    if (name !== 'no-css') html = html.replace('</head>', `${embed}</head>`);
    await route.fulfill({ response, body: html });
  });
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.statisticOriginal = [...document.querySelectorAll('[data-statistic-value]')].map(
      (element) => ({
        element,
        nodes: [...element.childNodes],
        html: element.innerHTML,
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      })
    );
    window.statisticStarts = 0;
    window.statisticFrames = [];
    const root = document.querySelector('[data-statistics]');
    const observer = new MutationObserver((records) => {
      window.statisticStarts += records.filter(
        (r) =>
          r.attributeName === 'data-statistic-running' &&
          r.target.hasAttribute('data-statistic-running')
      ).length;
    });
    observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-statistic-running'],
    });
  });
  return { page, errors };
}

async function enter(page) {
  await page.evaluate(() => {
    const root = document.querySelector('[data-statistics]');
    const end = performance.now() + 3200;
    function frame(now) {
      window.statisticFrames.push({
        at: now,
        stats: [...root.querySelectorAll('[data-statistic-value]')].map((el) => ({
          running: el.hasAttribute('data-statistic-running'),
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
          transforms: [...el.querySelectorAll('[data-statistic-digit] [data-statistic-strip]')].map(
            (strip) => getComputedStyle(strip).transform
          ),
        })),
      });
      if (now < end) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    const bounds = root.getBoundingClientRect();
    window.scrollTo(0, bounds.top + scrollY - Math.max(100, (innerHeight - bounds.height) / 2));
  });
}

async function restored(page, checkSize = true) {
  const state = await page.evaluate(() => ({
    values: window.statisticOriginal.map(({ element, nodes, html, width, height }) => ({
      text: element.textContent,
      sameNodes: nodes.every((node, i) => element.childNodes[i] === node),
      sameHTML: element.innerHTML === html,
      widthDelta: element.getBoundingClientRect().width - width,
      heightDelta: element.getBoundingClientRect().height - height,
    })),
    running: document.querySelectorAll('[data-statistic-running]').length,
    overflow: document.documentElement.scrollWidth > innerWidth,
    starts: window.statisticStarts,
  }));
  assert.deepEqual(
    state.values.map((value) => value.text),
    ['44%', '99.85', '11']
  );
  assert(state.values.every((value) => value.sameNodes && value.sameHTML));
  assert.equal(state.running, 0);
  assert.equal(state.overflow, false);
  if (checkSize)
    assert(
      state.values.every(
        (value) => Math.abs(value.heightDelta) < 0.1 && Math.abs(value.widthDelta) < 0.1
      )
    );
  return state;
}

try {
  for (const width of process.env.STATISTICS_WIDTH
    ? [Number(process.env.STATISTICS_WIDTH)]
    : [1333, 820, 667, 390]) {
    const { page, errors } = await createPage('normal', width);
    const originalAX = await page.locator('[data-statistics]').ariaSnapshot();
    const geometry = await page.evaluate(() =>
      window.statisticOriginal.map(({ width, height }) => ({ width, height }))
    );
    const before = await restored(page);
    assert.equal(before.starts, 0, 'Offscreen statistics remain native');
    await enter(page);
    await page.waitForSelector('[data-statistic-running]', { state: 'attached' });
    await page.waitForTimeout(300);
    const duringAX = await page.locator('[data-statistics]').ariaSnapshot();
    assert.equal(duringAX, originalAX, 'Assistive technology sees the final values throughout');
    const punctuation = await page.evaluate(() =>
      [...document.querySelectorAll('[data-statistic-slot]:not([data-statistic-digit])')].map(
        (slot) => {
          const range = document.createRange();
          range.selectNodeContents(slot.querySelector('[data-statistic-cell]'));
          const box = range.getBoundingClientRect();
          return { text: slot.textContent, x: box.x, y: box.y };
        }
      )
    );
    await page.screenshot({ path: `${EVIDENCE}/${width}-rolling.png` });
    await page.waitForFunction(
      () => window.statisticStarts === 3 && !document.querySelector('[data-statistic-running]')
    );
    const final = await restored(page);
    await page.screenshot({ path: `${EVIDENCE}/${width}-complete.png` });
    const frames = await page.evaluate(() => window.statisticFrames);
    const motion = frames.flatMap((frame) => frame.stats.flatMap((stat) => stat.transforms));
    assert(
      new Set(motion.filter((transform) => transform !== 'none')).size > 10,
      'Digit reels show real intermediate motion'
    );
    assert(
      frames.every((frame) =>
        frame.stats.every(
          (stat, i) =>
            Math.abs(stat.height - geometry[i].height) < 0.1 &&
            Math.abs(stat.width - geometry[i].width) < 0.1
        )
      ),
      'The animation preserves the authored value dimensions'
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    await enter(page);
    await page.waitForTimeout(300);
    assert.equal((await restored(page)).starts, 3, 'Re-entering does not replay');
    assert.equal(await page.locator('[data-statistics]').ariaSnapshot(), originalAX);
    assert.deepEqual(errors, []);
    results.push({ name: 'normal', width, final, punctuation, accessibility: duringAX, frames });
    await page.close();
  }
  if (!process.env.STATISTICS_WIDTH) {
    for (const name of ['reduced-change', 'resize', 'pagehide']) {
      const { page, errors } = await createPage(name);
      await enter(page);
      await page.waitForSelector('[data-statistic-running]', { state: 'attached' });
      if (name === 'reduced-change') await page.emulateMedia({ reducedMotion: 'reduce' });
      if (name === 'resize') await page.setViewportSize({ width: 1280, height: 979 });
      if (name === 'pagehide')
        await page.evaluate(() =>
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
        );
      await page.waitForFunction(() => !document.querySelector('[data-statistic-running]'));
      const final = await restored(page, name !== 'resize');
      assert.deepEqual(errors, []);
      results.push({ name, final });
      await page.close();
    }
    for (const name of ['reduced', 'no-css', 'no-js', 'blocked-js']) {
      const settings =
        name === 'reduced'
          ? { reducedMotion: 'reduce' }
          : name === 'no-js'
            ? { javaScriptEnabled: false }
            : {};
      const { page, errors } = await createPage(name, 390, settings);
      await enter(page);
      await page.waitForTimeout(700);
      const final = await restored(page);
      assert.equal(final.starts, 0);
      assert.deepEqual(errors, []);
      results.push({ name, final });
      await page.close();
    }
  }
  await writeFile(
    `${EVIDENCE}/results.json`,
    JSON.stringify({ status: 'passed', browser: browser.version(), results }, null, 2)
  );
  console.log(
    JSON.stringify({
      status: 'passed',
      scenarios: results.map(({ name, width }) => ({ name, width })),
    })
  );
} catch (error) {
  const frames =
    activePage && !activePage.isClosed()
      ? await activePage.evaluate(() => window.statisticFrames)
      : undefined;
  await writeFile(
    `${EVIDENCE}/results.json`,
    JSON.stringify({ status: 'failed', error: error.stack, frames, results }, null, 2)
  );
  throw error;
} finally {
  await browser.close();
}
