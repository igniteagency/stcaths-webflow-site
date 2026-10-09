import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SITE = 'https://st-catherines-school.webflow.io';
const LIVE = process.env.FOOTER_LIVE === '1';
const OUT = resolve(process.env.FOOTER_EVIDENCE_DIR ?? '/tmp/stcaths-footer-evidence');
const before = !LIVE ? (await readFile(process.env.FOOTER_BEFORE_EMBED_PATH, 'utf8')).trim() : '';
const after = !LIVE ? (await readFile(process.env.FOOTER_EMBED_PATH, 'utf8')).trim() : '';
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
let activePage;
async function open(width, height, path = '/', mode = 'normal') {
  const page = await browser.newPage({
    viewport: { width, height },
    reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference',
  });
  activePage = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (!LIVE) {
    await page.route('**/gh/igniteagency/stcaths-webflow-site/**', async (route) => {
      const file = new URL(route.request().url()).pathname.split('/dist/prod/')[1];
      if (!file || file.includes('..')) return route.continue();
      if (mode === 'blocked-js' && file === 'components/footer.js') return route.abort();
      await route.fulfill({
        body:
          (file === 'components/footer.js' && process.env.FOOTER_DELAY_TEXT
            ? `(() => { const create = window.stCathsTextReveal.create; window.stCathsTextReveal.create = async (...args) => { await new Promise(resolve => setTimeout(resolve, 700)); return create(...args); }; })();`
            : '') + (await readFile(new URL('dist/prod/' + file, ROOT), 'utf8')),
        contentType: 'text/javascript',
      });
    });
    await page.route(SITE + path, async (route) => {
      const response = await route.fetch();
      let html = await response.text();
      html = html.replace(
        '<footer class="section_footer"',
        '<footer data-footer-reveal="" data-text-trigger="manual" data-divider-trigger="manual" class="section_footer"'
      );
      assert(html.includes(before), 'Existing footer embed found');
      html = html.replace(before, mode === 'no-css' ? before : after);
      await route.fulfill({ response, body: html });
    });
  }
  await page.addInitScript(() => {
    window.footerEvents = [];
    document.addEventListener('animationstart', (e) => {
      if (e.target.closest('[data-footer-reveal]') && e.animationName.startsWith('divider-reveal'))
        window.footerEvents.push({ at: performance.now(), name: e.animationName });
    });
  });
  await page.goto(SITE + path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const footer = document.querySelector('[data-footer-reveal]');
    window.footerOriginal = footer.querySelector('h1,h2').innerHTML;
    window.footerFrames = [];
  });
  return { page, errors };
}
async function state(page) {
  return page.evaluate(() => {
    const footer = document.querySelector('[data-footer-reveal]');
    const h = footer.querySelector('h1,h2');
    const d = footer.querySelector('[data-divider-reveal]');
    return {
      state: footer.dataset.footerState,
      layout: footer.dataset.footerLayout,
      position: getComputedStyle(footer).position,
      split: h.hasAttribute('data-split'),
      clip: getComputedStyle(h).clipPath,
      rule: d.dataset.dividerState,
      scale: getComputedStyle(d).scale,
      mainBottom: document.querySelector('main').getBoundingClientRect().bottom,
      headingTop: h.getBoundingClientRect().top,
      overflow: document.documentElement.scrollWidth > innerWidth,
      original: window.footerOriginal === h.innerHTML,
      events: window.footerEvents,
    };
  });
}
async function move(page, position) {
  await page.evaluate((position) => {
    const f = document.querySelector('[data-footer-reveal]');
    const m = document.querySelector('main');
    const h = f.querySelector('h1,h2');
    const end = m.getBoundingClientRect().bottom + scrollY;
    const sticky = getComputedStyle(f).position === 'sticky';
    const point = sticky
      ? end - Math.min(innerHeight * 0.35, Math.max(0, h.getBoundingClientRect().top - 12))
      : h.getBoundingClientRect().top +
        scrollY +
        Math.min(h.getBoundingClientRect().height, innerHeight * 0.7) -
        innerHeight * 0.85;
    scrollTo({
      top:
        position === 'covered'
          ? end - innerHeight * 0.7
          : position === 'before'
            ? point - 15
            : position === 'bottom'
              ? document.documentElement.scrollHeight
              : point + 2,
      behavior: 'instant',
    });
  }, position);
  await page.waitForTimeout(100);
}
async function sample(page) {
  await page.evaluate(() => {
    const footer = document.querySelector('[data-footer-reveal]');
    const h = footer.querySelector('h1,h2');
    const d = footer.querySelector('[data-divider-reveal]');
    const end = performance.now() + 3100;
    function frame(at) {
      window.footerFrames.push({
        at,
        state: footer.dataset.footerState,
        rule: d.dataset.dividerState,
        scale: getComputedStyle(d).scale,
        clip: getComputedStyle(h).clipPath,
        split: h.hasAttribute('data-split'),
        mainBottom: document.querySelector('main').getBoundingClientRect().bottom,
        headingTop: h.getBoundingClientRect().top,
      });
      if (at < end) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
try {
  const viewports = process.env.FOOTER_WIDTH
    ? [[Number(process.env.FOOTER_WIDTH), Number(process.env.FOOTER_HEIGHT ?? 979)]]
    : process.env.FOOTER_QUICK
      ? [
          [1440, 979],
          [390, 844],
        ]
      : [
          [1440, 979],
          [992, 979],
          [667, 500],
          [390, 844],
        ];
  for (const [width, height] of viewports)
    for (const path of ['/', '/why-st-catherines/education-for-life/senior-school']) {
      const { page, errors } = await open(width, height, path);
      const initial = await state(page);
      assert.equal(initial.state, 'pending');
      assert.equal(initial.split, false);
      assert.equal(initial.rule, 'pending');
      assert.equal(initial.events.length, 0);
      if (initial.layout !== 'flow') {
        await move(page, 'covered');
        await page.waitForTimeout(400);
        assert.equal((await state(page)).state, 'pending');
      }
      await move(page, 'before');
      assert.equal((await state(page)).state, 'pending');
      await sample(page);
      await move(page, 'enter');
      await page.waitForFunction(
        () => document.querySelector('[data-footer-reveal]').dataset.footerState === 'playing'
      );
      await page.waitForTimeout(450);
      const playing = await state(page);
      assert.equal(playing.clip, 'none');
      assert(playing.split);
      assert(
        await page
          .locator('[data-footer-reveal] h1,[data-footer-reveal] h2')
          .evaluate((h) =>
            window.gsap
              .getTweensOf([...h.querySelectorAll('*')])
              .some((t) => t.vars.ease === 'power4.out')
          ),
        'Footer uses the concept easing'
      );
      assert(!playing.overflow);
      if (playing.position === 'sticky')
        assert(playing.mainBottom < playing.headingTop, 'The covering section cleared the heading');
      const label = `${path === '/' ? 'home' : 'senior'}-${width}`;
      await page.screenshot({ path: `${OUT}/${label}-playing.png` });
      await page.waitForFunction(
        () => document.querySelector('[data-footer-reveal]').dataset.footerState === 'complete'
      );
      await move(page, 'bottom');
      await page.waitForTimeout(2500);
      const complete = await state(page);
      assert(complete.original);
      assert(!complete.split);
      assert.equal(complete.rule, 'complete');
      assert(!complete.overflow);
      const frames = await page.evaluate(() => window.footerFrames);
      assert(frames.some((f) => f.state === 'playing' && f.clip === 'none'));
      if (initial.layout === 'sticky') {
        const first = frames.find((f) => f.state === 'playing');
        const event = complete.events[0];
        assert(
          event && event.at - first.at >= 230 && event.at - first.at < 500,
          'Divider follows the heading by 0.3 seconds'
        );
        assert(
          frames.some((f) => /^0\./.test(f.scale)),
          'Divider grows from its centre'
        );
      }
      await page.screenshot({ path: `${OUT}/${label}-complete.png` });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await move(page, 'bottom');
      assert.equal((await state(page)).events.length, 1, 'No replay');
      results.push({ label, initial, playing, complete, errors });
      assert.equal(errors.length, 0);
      await page.close();
    }
  if (!process.env.FOOTER_QUICK)
    for (const mode of ['reduced', 'blocked-js', 'no-css', 'resize', 'focus', 'change-motion']) {
      const { page, errors } = await open(390, 844, '/', mode);
      if (['reduced', 'blocked-js', 'no-css'].includes(mode)) {
        await move(page, 'bottom');
        const s = await state(page);
        assert(!s.split);
        assert.equal(s.clip, 'none');
        assert(!s.overflow);
        results.push({ mode, ...s, errors });
      } else {
        if (mode === 'focus') await page.locator('[data-footer-reveal] a').first().focus();
        else {
          await move(page, 'enter');
          await page.waitForFunction(
            () => document.querySelector('[data-footer-reveal]').dataset.footerState === 'playing'
          );
          if (mode === 'resize') await page.setViewportSize({ width: 667, height: 500 });
          else await page.emulateMedia({ reducedMotion: 'reduce' });
        }
        await page.waitForTimeout(150);
        const s = await state(page);
        assert.equal(s.state, 'complete');
        assert(s.original);
        assert.equal(s.rule, 'complete');
        results.push({ mode, ...s, errors });
      }
      await page.close();
    }
  await writeFile(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.length, output: OUT }));
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    console.error(await state(activePage));
    await activePage.screenshot({ path: `${OUT}/failure.png` });
  }
  throw error;
} finally {
  await browser.close();
}
