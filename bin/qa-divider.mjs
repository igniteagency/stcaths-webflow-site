import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SITE = 'https://st-catherines-school.webflow.io';
const SENIOR = '/why-st-catherines/education-for-life/senior-school';
const EVIDENCE = resolve(process.env.DIVIDER_EVIDENCE_DIR ?? '/tmp/stcaths-divider-evidence');
const LIVE = process.env.DIVIDER_LIVE === '1';
const embed = process.env.DIVIDER_COMPONENT_EMBED_PATH
  ? await readFile(resolve(process.env.DIVIDER_COMPONENT_EMBED_PATH), 'utf8')
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

async function createPage(name, width, path = '/', settings = {}) {
  const page = await browser.newPage({ viewport: { width, height: 979 }, ...settings });
  activePage = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (!LIVE) {
    await page.route('**/gh/igniteagency/stcaths-webflow-site/**', async (route) => {
      const file = new URL(route.request().url()).pathname.split('/dist/prod/')[1];
      if (!file || file.includes('..')) return route.continue();
      if (name === 'blocked-js' && file === 'components/divider.js') return route.abort();
      await route.fulfill({
        body: await readFile(new URL('dist/prod/' + file, ROOT)),
        contentType: 'text/javascript',
      });
    });
    await page.route(SITE + path, async (route) => {
      const response = await route.fetch();
      let html = (await response.text()).replace(
        /class="([^"]*)"/g,
        (whole, classes) =>
          whole + (classes.split(/\s+/).includes('divider') ? ' data-divider-reveal=""' : '')
      );
      if (name !== 'no-css') html = html.replace('</head>', `${embed}</head>`);
      await route.fulfill({ response, body: html });
    });
  }
  await page.addInitScript(() => {
    window.dividerStarts = [];
    document.addEventListener('animationstart', (e) => {
      if (e.animationName.startsWith('divider-reveal-'))
        window.dividerStarts.push({ element: e.target, name: e.animationName });
    });
  });
  await page.goto(SITE + path, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.dividerStarts ??= [];
    window.dividerOriginal = [...document.querySelectorAll('[data-divider-reveal]')].map(
      (element) => ({
        element,
        width: element.offsetWidth,
        height: element.offsetHeight,
        clip: getComputedStyle(element).clipPath,
      })
    );
    window.dividerFrames = [];
  });
  return { page, errors };
}

async function enter(page, selector) {
  await page.evaluate((selector) => {
    const target = document.querySelector(selector);
    window.dividerFrames = [];
    const until = performance.now() + 3200;
    function sample(at) {
      window.dividerFrames.push(
        [...target.querySelectorAll('[data-divider-reveal]')].map((e) => {
          const s = getComputedStyle(e);
          return {
            state: e.dataset.dividerState,
            axis: e.getAttribute('data-wf--atom-divider--orientation'),
            scale: s.scale,
            origin: s.transformOrigin,
            rowOrigin: e.parentElement.matches('[data-pathways-rule="row"]')
              ? getComputedStyle(e.parentElement).transformOrigin
              : null,
            delay: parseFloat(s.animationDelay),
            width: e.offsetWidth,
            height: e.offsetHeight,
          };
        })
      );
      if (at < until) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
    window.scrollTo(0, scrollY + target.getBoundingClientRect().top - 160);
  }, selector);
}

async function finishState(page) {
  const state = await page.evaluate(() => ({
    starts: window.dividerStarts.length,
    overflow: document.documentElement.scrollWidth > innerWidth,
    progress: [
      ...document.querySelectorAll('.switching-tabs_loader-wrap [data-divider-reveal]'),
    ].map((e) => e.dataset.dividerState ?? null),
    rules: window.dividerOriginal.map(({ element, width, height, clip }) => ({
      state: element.dataset.dividerState,
      widthDelta: element.offsetWidth - width,
      heightDelta: element.offsetHeight - height,
      sameClip: getComputedStyle(element).clipPath === clip,
      scale: getComputedStyle(element).scale,
    })),
  }));
  assert.equal(state.overflow, false);
  assert(
    state.progress.every((s) => s === null),
    'Progress indicators keep their existing animation'
  );
  assert(
    state.rules.every((r) => r.sameClip && r.widthDelta === 0 && r.heightDelta === 0),
    'Divider geometry is unchanged'
  );
  return state;
}

try {
  const widths = process.env.DIVIDER_EXTRA_ONLY
    ? []
    : process.env.DIVIDER_WIDTH
      ? [Number(process.env.DIVIDER_WIDTH)]
      : [1440, 992, 667, 390];
  for (const width of widths)
    for (const path of ['/', SENIOR]) {
      const { page, errors } = await createPage('normal', width, path);
      const group = '[data-pathways-rules]';
      assert(await page.locator(group).count());
      await enter(page, group);
      await page.waitForSelector(`${group} [data-divider-state="revealing"]`, {
        state: 'attached',
      });
      await page.waitForTimeout(450);
      await page.screenshot({
        path: `${EVIDENCE}/${path === '/' ? 'home' : 'senior'}-${width}-drawing.png`,
      });
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-pathways-rules] [data-divider-state="revealing"]') &&
          [...document.querySelectorAll('[data-pathways-rules] [data-divider-reveal]')]
            .filter((e) => !e.closest('[data-pathways-rule="row"]'))
            .every((e) => e.dataset.dividerState === 'complete')
      );
      const state = await finishState(page);
      const frames = await page.evaluate(() => window.dividerFrames);
      const rows = frames.flat();
      assert(
        rows.some((r) => r.axis === 'horizontal' && /^0\./.test(r.scale)),
        'Horizontal rules grow across the X axis'
      );
      if (rows.some((r) => r.axis === 'vertical' && r.width && r.height)) {
        assert(
          rows.some((r) => r.axis === 'vertical' && /^1 0\./.test(r.scale)),
          'Vertical rules grow up the Y axis'
        );
        assert(
          rows
            .filter((r) => r.axis === 'vertical' && r.state === 'revealing' && r.height)
            .every((r) => Math.abs(parseFloat(r.origin.split(' ')[1]) - r.height) < 1),
          'Vertical origin stays at the bottom'
        );
      }
      assert(
        rows
          .filter((r) => r.rowOrigin && r.state === 'revealing' && r.width)
          .every((r) => r.origin === r.rowOrigin),
        'Paired row lines inherit their outward origins'
      );
      if (width === 1440 && path === SENIOR) {
        const delays = rows
          .filter((r) => r.axis === 'vertical' && r.state === 'revealing' && r.height)
          .map((r) => r.delay);
        assert(
          delays.includes(0) && delays.some((d) => Math.abs(d - 0.9) < 0.01),
          'Outer verticals wait for the sweep to reach them'
        );
      }
      await page.screenshot({
        path: `${EVIDENCE}/${path === '/' ? 'home' : 'senior'}-${width}-complete.png`,
      });
      const laterRows = await page
        .locator('[data-pathways-rule="row"] > [data-divider-state="pending"]')
        .elementHandles();
      let deferredRows = 0;
      for (const row of laterRows) {
        if (!(await row.evaluate((e) => e.offsetWidth && e.offsetHeight))) continue;
        if (await row.evaluate((e) => e.dataset.dividerState !== 'pending')) {
          await page.waitForFunction((e) => e.dataset.dividerState === 'complete', row);
          continue;
        }
        assert(
          await row.evaluate((e) => e.getBoundingClientRect().top >= innerHeight),
          'Unseen mobile separators wait below the viewport'
        );
        await row.evaluate((e) => e.scrollIntoView({ block: 'center' }));
        await page.waitForFunction((e) => e.dataset.dividerState === 'complete', row);
        deferredRows++;
      }
      const starts = await page.evaluate(
        () => window.dividerStarts.filter((s) => s.element.closest('[data-pathways-rules]')).length
      );
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(100);
      await enter(page, group);
      await page.waitForTimeout(200);
      assert.equal(
        await page.evaluate(
          () =>
            window.dividerStarts.filter((s) => s.element.closest('[data-pathways-rules]')).length
        ),
        starts,
        'The section does not replay'
      );
      const ordinary = await page.evaluate(() =>
        [...document.querySelectorAll('[data-divider-state="pending"]')].findIndex(
          (e) => !e.closest('[data-pathways-rules]') && e.offsetWidth && e.offsetHeight
        )
      );
      if (ordinary >= 0) {
        await page.evaluate((index) => {
          const e = document.querySelectorAll('[data-divider-state="pending"]')[index];
          e.setAttribute('data-qa-divider', '');
          e.scrollIntoView({ block: 'center' });
        }, ordinary);
        await page.waitForSelector('[data-qa-divider][data-divider-state="revealing"]', {
          state: 'attached',
        });
        await page.waitForSelector('[data-qa-divider][data-divider-state="complete"]', {
          state: 'attached',
        });
      }
      assert.deepEqual(errors, []);
      results.push({
        name: 'normal',
        width,
        path,
        state,
        frames,
        deferredRows,
        standaloneTested: ordinary >= 0,
      });
      await page.close();
    }
  if (!process.env.DIVIDER_WIDTH) {
    for (const name of ['resize', 'reduced-change', 'pagehide']) {
      const { page, errors } = await createPage(name, 1440, SENIOR);
      await enter(page, '[data-pathways-rules]');
      await page.waitForSelector('[data-pathways-rules] [data-divider-state="revealing"]', {
        state: 'attached',
      });
      if (name === 'resize') await page.setViewportSize({ width: 390, height: 979 });
      if (name === 'reduced-change') await page.emulateMedia({ reducedMotion: 'reduce' });
      if (name === 'pagehide')
        await page.evaluate(() =>
          dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
        );
      await page.waitForFunction(
        () => !document.querySelector('[data-pathways-rules] [data-divider-state="revealing"]')
      );
      assert(await page.locator('[data-pathways-rules] [data-divider-state="complete"]').count());
      assert.deepEqual(errors, []);
      results.push({ name });
      await page.close();
    }
    for (const name of ['reduced', 'no-css', 'no-js', 'blocked-js']) {
      const { page, errors } = await createPage(
        name,
        390,
        SENIOR,
        name === 'reduced'
          ? { reducedMotion: 'reduce' }
          : name === 'no-js'
            ? { javaScriptEnabled: false }
            : {}
      );
      await enter(page, '[data-pathways-rules]');
      await page.waitForTimeout(400);
      assert.equal(await page.locator('[data-divider-state]').count(), 0);
      const state = await finishState(page);
      assert.deepEqual(errors, []);
      results.push({ name, state });
      await page.close();
    }
  }
  await writeFile(
    `${EVIDENCE}/results.json`,
    JSON.stringify({ status: 'passed', results }, null, 2)
  );
  console.log(
    JSON.stringify({
      status: 'passed',
      scenarios: results.map(({ name, width, path }) => ({ name, width, path })),
    })
  );
} catch (error) {
  const frames =
    activePage && !activePage.isClosed()
      ? await activePage.evaluate(() => window.dividerFrames)
      : null;
  await writeFile(
    `${EVIDENCE}/results.json`,
    JSON.stringify({ status: 'failed', error: error.stack, frames, results }, null, 2)
  );
  throw error;
} finally {
  await browser.close();
}
