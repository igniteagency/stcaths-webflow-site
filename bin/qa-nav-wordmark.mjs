import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SITE = 'https://st-catherines-school.webflow.io';
const LIVE = process.env.WORDMARK_LIVE === '1';
const OUT = resolve(process.env.WORDMARK_EVIDENCE_DIR ?? '/tmp/stcaths-wordmark-evidence');
const before = !LIVE ? (await readFile(process.env.WORDMARK_BEFORE_EMBED_PATH, 'utf8')).trim() : '';
const after = !LIVE ? (await readFile(process.env.WORDMARK_EMBED_PATH, 'utf8')).trim() : '';
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
let active;
async function open(width, path = '/', mode = 'normal') {
  const page = await browser.newPage({
    viewport: { width, height: 979 },
    reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference',
  });
  active = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let originalSVG = '';
  page.on('response', async (response) => {
    if (response.request().isNavigationRequest() && response.url().startsWith(SITE)) {
      originalSVG =
        (await response.text()).match(/<svg[^>]*class="logo_wordmark[^>]*>[\s\S]*?<\/svg>/)?.[0] ??
        '';
    }
  });
  if (!LIVE) {
    await page.route('**/gh/igniteagency/stcaths-webflow-site/**', async (route) => {
      const file = new URL(route.request().url()).pathname.split('/dist/prod/')[1];
      if (!file || file.includes('..')) return route.continue();
      if (mode === 'blocked-js' && file === 'components/nav-wordmark.js') return route.abort();
      await route.fulfill({
        body: await readFile(new URL('dist/prod/' + file, ROOT)),
        contentType: 'text/javascript',
      });
    });
    await page.route(SITE + path, async (route) => {
      const response = await route.fetch();
      let html = await response.text();
      html = html.replace(
        'data-hero-intro-nav="brand"',
        'data-hero-intro-nav="brand" data-nav-wordmark=""'
      );
      assert(html.includes(before), 'Navbar embed found');
      html = html.replace(before, mode === 'no-css' ? before : after);
      await route.fulfill({ response, body: html });
    });
  }
  await page.goto(SITE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.wordmarkLink = document.querySelector('[data-nav-wordmark] a');
    window.wordmarkFooter = document.querySelector('.section_footer .logo_component')?.innerHTML;
  });
  return { page, errors, originalSVG };
}
async function scroll(page, y) {
  await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y);
  await page.waitForTimeout(60);
}
async function state(page) {
  return page.locator('[data-nav-wordmark]').evaluate((b) => ({
    state: b.dataset.navWordmarkState,
    inert: b.inert,
    aria: b.getAttribute('aria-hidden'),
    visibility: getComputedStyle(b).visibility,
    parts: b.querySelectorAll('[data-nav-wordmark-part]').length,
    childCount: b.querySelector('.logo_wordmark').children.length,
    linkSame: window.wordmarkLink === b.querySelector('a'),
    home: b.querySelector('a').getAttribute('href'),
    footerSame:
      window.wordmarkFooter ===
      document.querySelector('.section_footer .logo_component')?.innerHTML,
    overflow: document.documentElement.scrollWidth > innerWidth,
    scrollY,
    values: [...b.querySelectorAll('[data-nav-wordmark-part]')].map((p) => ({
      opacity: +getComputedStyle(p).opacity,
      y: p.style.getPropertyValue('--nav-wordmark-y'),
      transform: getComputedStyle(p).transform,
    })),
  }));
}
async function partial(page, phase) {
  const frame = await page.waitForFunction((phase) => {
    const brand = document.querySelector('[data-nav-wordmark]');
    const values = [...brand.querySelectorAll('[data-nav-wordmark-part]')].map((p) => ({
      opacity: +getComputedStyle(p).opacity,
      y: p.style.getPropertyValue('--nav-wordmark-y'),
      transform: getComputedStyle(p).transform,
    }));
    if (
      brand.dataset.navWordmarkState !== phase ||
      !values.some((p) => p.opacity > 0 && p.opacity < 1) ||
      new Set(values.map((p) => p.opacity)).size < 4
    )
      return false;
    return { state: phase, inert: brand.inert, aria: brand.getAttribute('aria-hidden'), values };
  }, phase);
  return frame.jsonValue();
}
async function wait(page, value) {
  await page.waitForFunction(
    (value) => document.querySelector('[data-nav-wordmark]').dataset.navWordmarkState === value,
    value
  );
}
async function pixelCheck(page, original) {
  return page.evaluate(async (original) => {
    const parse = (text) => new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    const svg = document.querySelector('[data-nav-wordmark] .logo_wordmark').cloneNode(true);
    const originalNode = parse(original);
    async function pixels(node) {
      node.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      node.setAttribute('width', '725');
      node.setAttribute('height', '132');
      node.setAttribute('style', 'color:black;fill:currentColor');
      const img = new Image();
      img.src =
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(new XMLSerializer().serializeToString(node));
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 725;
      canvas.height = 132;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, 725, 132).data;
    }
    const a = await pixels(originalNode),
      b = await pixels(svg);
    return a.reduce((n, value, i) => n + (value !== b[i] ? 1 : 0), 0);
  }, original);
}
try {
  for (const width of process.env.WORDMARK_EXTRA_ONLY
    ? []
    : process.env.WORDMARK_QUICK
      ? [1440, 390]
      : [1440, 992, 667, 390])
    for (const path of ['/', '/why-st-catherines']) {
      const { page, errors, originalSVG } = await open(width, path);
      const label = `${path === '/' ? 'home' : 'why'}-${width}`;
      const initial = await state(page);
      assert.equal(initial.parts, 20);
      assert.equal(initial.state, 'visible');
      assert(!initial.inert);
      assert(initial.linkSame && initial.footerSame);
      assert.equal(
        await pixelCheck(page, originalSVG),
        0,
        'The split SVG is pixel-identical to the authored artwork'
      );
      await scroll(page, 640);
      assert.equal((await state(page)).state, 'visible');
      await scroll(page, 800);
      const hiding = await partial(page, 'hiding');
      assert.equal(hiding.state, 'hiding');
      assert(hiding.inert);
      assert(hiding.values.some((p) => p.opacity > 0 && p.opacity < 1));
      assert(new Set(hiding.values.map((p) => p.opacity)).size > 3, 'Letters are staggered');
      await page.screenshot({ path: `${OUT}/${label}-hiding.png` });
      await wait(page, 'hidden');
      const hidden = await state(page);
      assert.equal(hidden.visibility, 'hidden');
      assert.equal(hidden.aria, 'true');
      assert(hidden.values.every((p) => p.opacity === 0));
      // Sub-threshold trackpad jitter cannot change direction.
      await scroll(page, 796);
      await scroll(page, 800);
      assert.equal((await state(page)).state, 'hidden');
      await scroll(page, 780);
      const showing = await partial(page, 'showing');
      assert.equal(showing.state, 'showing');
      assert(!showing.inert);
      assert.equal(showing.aria, null);
      assert(showing.values.some((p) => p.opacity > 0 && p.opacity < 1));
      await page.screenshot({ path: `${OUT}/${label}-returning.png` });
      await wait(page, 'visible');
      assert.equal(await pixelCheck(page, originalSVG), 0, 'Returning restores the same artwork');
      // Reverse an unfinished exit without a flash or stranded letters.
      await scroll(page, 850);
      await page.waitForTimeout(100);
      await scroll(page, 820);
      await wait(page, 'visible');
      await scroll(page, 900);
      await wait(page, 'hidden');
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      await page.waitForTimeout(800);
      await page.locator('[data-nav-menu-popover]').evaluate((e) => e.hidePopover());
      await page.waitForTimeout(800);
      assert.equal((await state(page)).state, 'hidden');
      await scroll(page, 570);
      await wait(page, 'visible');
      await page.locator('[data-nav-wordmark] a').focus();
      await scroll(page, 900);
      assert.equal((await state(page)).state, 'visible', 'Focused home link stays visible');
      await page.locator('[data-nav-wordmark] a').evaluate((e) => e.blur());
      await page.waitForTimeout(100);
      await wait(page, 'hidden');
      await scroll(page, 0);
      await wait(page, 'visible');
      const final = await state(page);
      assert(final.linkSame && final.footerSame && !final.overflow);
      assert.equal(final.home, '/');
      assert.equal(errors.length, 0);
      results.push({ label, initial, hiding, showing, final, pixelDifference: 0, errors });
      await page.close();
    }
  if (!process.env.WORDMARK_QUICK)
    for (const mode of ['reduced', 'blocked-js', 'no-css', 'resize', 'motion-change', 'history']) {
      const { page, errors, originalSVG } = await open(390, '/why-st-catherines', mode);
      if (['reduced', 'blocked-js', 'no-css'].includes(mode)) {
        await scroll(page, 900);
        const s = await state(page);
        assert.equal(s.parts, 0);
        assert.equal(s.childCount, 1);
        assert(!s.inert);
        assert.equal(s.visibility, 'visible');
        results.push({ mode, ...s, errors });
      } else {
        await scroll(page, 900);
        await wait(page, 'hidden');
        if (mode === 'resize') {
          await page.setViewportSize({ width: 667, height: 500 });
          await page.waitForTimeout(250);
          await wait(page, 'hidden');
          await scroll(page, await page.evaluate(() => scrollY - 30));
          await wait(page, 'visible');
          assert.equal(await pixelCheck(page, originalSVG), 0);
        }
        if (mode === 'motion-change') {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.waitForTimeout(100);
          assert.equal((await state(page)).parts, 0);
          assert(!(await state(page)).inert);
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          await wait(page, 'hidden');
          await scroll(page, 870);
          await wait(page, 'visible');
        }
        if (mode === 'history') {
          await page.evaluate(() =>
            dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
          );
          assert.equal((await state(page)).parts, 0);
          await page.evaluate(() =>
            dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
          );
          await wait(page, 'hidden');
          await scroll(page, 870);
          await wait(page, 'visible');
        }
        const s = await state(page);
        assert(s.linkSame && s.footerSame && !s.inert);
        results.push({ mode, ...s, errors });
      }
      await page.close();
    }
  await writeFile(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.length, output: OUT }));
} catch (e) {
  await writeFile(`${OUT}/partial-results.json`, JSON.stringify(results, null, 2));
  if (active && !active.isClosed()) {
    console.error(await state(active));
    await active.screenshot({ path: `${OUT}/failure.png` });
  }
  throw e;
} finally {
  await browser.close();
}
