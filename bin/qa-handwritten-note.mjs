import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SITE = 'https://st-catherines-school.webflow.io/';
const LIVE = process.env.HANDWRITING_LIVE === '1';
const OUT = resolve(process.env.HANDWRITING_EVIDENCE_DIR ?? '/tmp/stcaths-handwriting-evidence');
const EMBED = LIVE ? '' : await readFile(process.env.HANDWRITING_EMBED_PATH, 'utf8');
const MARKUP = LIVE ? '' : await readFile(process.env.HANDWRITING_MARKUP_PATH, 'utf8');
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

async function open(width, height, mode = 'normal') {
  const page = await browser.newPage({
    viewport: { width, height },
    reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference',
  });
  current = page;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text());
  });
  if (!LIVE) {
    await page.route('**/gh/igniteagency/stcaths-webflow-site/**', async (route) => {
      const file = new URL(route.request().url()).pathname.split('/dist/prod/')[1];
      if (!file || file.includes('..')) return route.continue();
      if (
        (mode === 'blocked-js' && file.endsWith('handwritten-note.js')) ||
        (mode === 'blocked-data' && file.endsWith('tegaki.json')) ||
        (mode === 'blocked-wasm' && file.endsWith('.wasm'))
      )
        return route.abort();
      const ext = file.split('.').at(-1);
      return route.fulfill({
        body: await readFile(new URL('dist/prod/' + file, ROOT)),
        contentType:
          {
            js: 'text/javascript',
            wasm: 'application/wasm',
            ttf: 'font/ttf',
            json: 'application/json',
          }[ext] ?? 'text/plain',
      });
    });
    await page.route('http://localhost:3000/**', (route) => route.abort());
    await page.route('**/__handwriting-preview/*', async (route) =>
      route.fulfill({
        body: await readFile(
          resolve(
            process.env.HANDWRITING_ASSETS_DIR,
            new URL(route.request().url()).pathname.split('/').at(-1)
          )
        ),
        contentType: 'image/png',
      })
    );
    await page.route(SITE, async (route) => {
      const response = await route.fetch();
      let html = await response.text();
      const index = html.indexOf('class="section_testimonial');
      const start = html.lastIndexOf('<section', index),
        end = html.indexOf('</section>', index) + 10;
      assert(
        index > 0 && html.slice(start, end).includes('Natalie Charles'),
        'Principal testimonial found'
      );
      html = html.slice(0, start) + MARKUP + (mode === 'no-css' ? '' : EMBED) + html.slice(end);
      html = html.replace(
        '</head>',
        `<style>
        @font-face {font-family:'Homemade Apple';src:url('https://cdn.jsdelivr.net/gh/igniteagency/stcaths-webflow-site/dist/prod/assets/handwriting/homemade-apple/HomemadeApple-Regular.ttf') format('truetype');font-display:swap;}
        .section_handwritten-note {--handwritten-note-texture:url('${SITE}__handwriting-preview/principal-letter-paper.png');}
      </style></head>`
      );
      await route.fulfill({ response, body: html });
    });
  }
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  if (!['blocked-js', 'blocked-wasm'].includes(mode))
    await page.waitForFunction(() => window.stCathsHandwriting);
  if (mode === 'normal' && height >= 500) await page.waitForSelector('[data-handwriting-ready]');
  if (mode === 'blocked-data') await page.waitForSelector('[data-handwriting-state="error"]');
  return { page, errors };
}

async function state(page) {
  return page.locator('[data-handwritten-note]').evaluate((section) => {
    const stage = section.querySelector('[data-handwritten-note-stage]');
    const renderer = section.querySelector('[data-handwritten-note-renderer]');
    const source = section.querySelector('[data-handwritten-note-text]');
    const paper = section.querySelector('[data-handwritten-note-paper]');
    const bounds = paper.getBoundingClientRect();
    const canvas = renderer?.querySelector('canvas');
    const pixels = canvas?.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    if (pixels) for (let i = 3; i < pixels.length; i += 4) ink += pixels[i];
    return {
      ready: section.hasAttribute('data-handwriting-ready'),
      state: section.dataset.handwritingState,
      progress: renderer
        ? parseFloat(renderer.style.getPropertyValue('--tegaki-progress')) || 0
        : 0,
      pin: getComputedStyle(stage).position,
      top: stage.getBoundingClientRect().top,
      text: source.textContent,
      sourceHidden: source.hidden || source.getAttribute('aria-hidden') === 'true',
      rendererHidden: renderer?.getAttribute('aria-hidden'),
      clippedFallback: getComputedStyle(source).clipPath,
      paper: { top: bounds.top, bottom: bounds.bottom, width: bounds.width },
      overflow: document.documentElement.scrollWidth > innerWidth,
      canvases: section.querySelectorAll('canvas').length,
      ink,
      split: !!section.querySelector('[data-split]'),
    };
  });
}

async function scroll(page, viewports) {
  await page.locator('[data-handwritten-note]').evaluate((section, distance) => {
    const stage = section.querySelector('[data-handwritten-note-stage]');
    scrollTo({
      top: scrollY + section.getBoundingClientRect().top + stage.offsetHeight * distance,
      behavior: 'instant',
    });
  }, viewports);
}

async function settled(page, target) {
  await page.waitForFunction(
    (target) => {
      const value = parseFloat(
        document
          .querySelector('[data-handwritten-note-renderer]')
          ?.style.getPropertyValue('--tegaki-progress')
      );
      return Math.abs(value - target) < 0.001;
    },
    target,
    { timeout: 15000 }
  );
}

try {
  for (const [width, height] of [
    [1440, 979],
    [820, 1180],
    [667, 375],
    [390, 844],
  ]) {
    const { page, errors } = await open(width, height);
    const initial = await state(page);
    assert(!initial.overflow && !initial.sourceHidden && !initial.split);
    if (height < 500) {
      assert(!initial.ready && initial.clippedFallback === 'none');
      await scroll(page, -0.1);
      await page.screenshot({ path: `${OUT}/${width}-static.png` });
      results.push({ width, height, initial, errors });
    } else {
      assert.equal(initial.progress, 0);
      assert.equal(initial.rendererHidden, 'true');
      await scroll(page, 0.632);
      await page.waitForFunction(() => {
        const v = parseFloat(
          document
            .querySelector('[data-handwritten-note-renderer]')
            .style.getPropertyValue('--tegaki-progress')
        );
        return v > 0.04 && v < 0.4;
      });
      const partial = await state(page);
      assert.equal(partial.pin, 'sticky');
      assert(Math.abs(partial.top) <= 1 && partial.ink > 0);
      assert(partial.paper.top >= 50 && partial.paper.bottom <= height - 10);
      await page.screenshot({ path: `${OUT}/${width}-writing.png` });
      await settled(page, 0.5);
      const caughtUp = await state(page);
      assert(caughtUp.ink > partial.ink);
      await scroll(page, 0);
      await settled(page, 0);
      await scroll(page, 5);
      await page.waitForTimeout(250);
      const offscreen = await state(page);
      assert(offscreen.progress < 0.02, 'Fast fling must not complete offscreen');
      await scroll(page, 1.8);
      await page.waitForTimeout(100);
      const returned = await state(page);
      assert(
        returned.progress > 0 && returned.progress < 0.12,
        'Returning must write from actual ink'
      );
      await settled(page, 1);
      const complete = await state(page);
      assert(complete.ink > caughtUp.ink);
      await page.screenshot({ path: `${OUT}/${width}-complete.png` });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-handwritten-note]').hasAttribute('data-handwriting-ready')
      );
      const reduced = await state(page);
      assert(!reduced.ready && reduced.clippedFallback === 'none' && !reduced.sourceHidden);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.waitForSelector('[data-handwriting-ready]');
      await page.locator('[data-handwritten-note-text]').evaluate((el) => {
        el.textContent = 'Client edited words, café — 123.';
      });
      await page.waitForSelector('[data-handwriting-ready]');
      assert.equal((await state(page)).text, 'Client edited words, café — 123.');
      await page.locator('[data-handwritten-note-text]').evaluate((el) => {
        el.textContent = 'A new note 🌻';
      });
      await page.waitForSelector('[data-handwriting-state="unsupported"]');
      assert(!(await state(page)).ready, 'Unsupported characters retain complete original copy');
      await page.evaluate(() => {
        window.stCathsHandwriting.dispose();
        window.stCathsHandwriting.init();
        window.stCathsHandwriting.init();
      });
      assert.equal(await page.locator('[data-handwritten-note-renderer]').count(), 1);
      await page.evaluate(() => window.stCathsHandwriting.dispose());
      assert.equal((await state(page)).canvases, 0);
      results.push({
        width,
        height,
        initial,
        partial,
        caughtUp,
        offscreen,
        returned,
        complete,
        reduced,
        errors,
      });
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Passed ${width}×${height}`);
  }
  for (const mode of LIVE
    ? ['reduced']
    : ['reduced', 'blocked-js', 'blocked-data', 'blocked-wasm', 'no-css']) {
    const { page, errors } = await open(1440, 979, mode);
    await scroll(page, -0.1);
    await page.waitForTimeout(300);
    const fallback = await state(page);
    assert(!fallback.ready && !fallback.sourceHidden && fallback.clippedFallback === 'none');
    assert(fallback.text.includes('Heyington Gates'));
    if (mode !== 'blocked-wasm') assert.deepEqual(errors, []);
    results.push({ mode, fallback, errors });
    await page.close();
    console.log(`Passed ${mode}`);
  }
  await writeFile(`${OUT}/results.json`, JSON.stringify(results, null, 2));
} catch (error) {
  if (current && !current.isClosed()) {
    console.error(await state(current));
    await current.screenshot({ path: `${OUT}/failure.png` });
  }
  throw error;
} finally {
  await browser.close();
}
