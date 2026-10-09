import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SITE = 'https://st-catherines-school.webflow.io/';
const EVIDENCE = resolve(process.env.HERO_EVIDENCE_DIR ?? '/tmp/stcaths-hero-evidence');
const embed = process.env.HERO_COMPONENT_EMBED_PATH
  ? await readFile(resolve(process.env.HERO_COMPONENT_EMBED_PATH), 'utf8')
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

async function pageFor(name, width = 1440, settings = {}) {
  const page = await browser.newPage({ viewport: { width, height: 960 }, ...settings });
  activePage = page;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/gh/igniteagency/stcaths-webflow-site/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/dist/prod/')[1];
    if (!path || path.includes('..')) return route.continue();
    if (name === 'missing-text' && path === 'components/text-reveal.js') return route.abort();
    if (name === 'slow-component' && path === 'components/hero-intro.js') {
      await new Promise((resolve) => setTimeout(resolve, 3200));
    }
    await route.fulfill({
      body: await readFile(new URL('dist/prod/' + path, ROOT)),
      contentType: 'text/javascript',
    });
  });
  if (name === 'slow-fonts') {
    await page.route(/\.(woff2?|ttf)(\?.*)?$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3200));
      await route.continue();
    });
  }
  await page.route(SITE, async (route) => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace(
        'class="intro-loader_component is-active"',
        'data-hero-intro="" class="intro-loader_component is-active"'
      )
      .replace(
        'class="section_hero-header dark"',
        'data-hero-intro-content="" class="section_hero-header dark"'
      )
      .replace('class="navbar_logo-link"', 'data-hero-intro-nav="brand" class="navbar_logo-link"')
      .replace('class="nav-menu_trigger"', 'data-hero-intro-nav="menu" class="nav-menu_trigger"')
      .replace(
        'class="navbar_button-wrapper"',
        'data-hero-intro-nav="actions" class="navbar_button-wrapper"'
      )
      .replace('</head>', `${embed}</head>`);
    await route.fulfill({ response, body: html });
  });
  await page.addInitScript(() => {
    window.heroFrames = [];
    window.heroEvents = [];
    window.addEventListener('resize', () =>
      window.heroEvents.push({ at: performance.now(), type: 'resize' })
    );
    document.fonts.addEventListener('loadingdone', () =>
      window.heroEvents.push({ at: performance.now(), type: 'fonts' })
    );
    const until = performance.now() + 10000;
    function sample(now) {
      const loader = document.querySelector('[data-hero-intro]');
      const heading = document.querySelector('[data-hero-intro-content] h1');
      if (loader && heading) {
        const clock = loader.getAnimations().find((a) => a.animationName === 'intro-loader-hide');
        const char = heading.querySelector('[data-char]');
        window.heroFrames.push({
          at: now,
          elapsed: clock?.startTime == null ? null : now - clock.startTime,
          state: loader.dataset.heroIntroState,
          loader: getComputedStyle(loader).visibility,
          ring: Number.parseFloat(
            getComputedStyle(loader.querySelector('circle')).strokeDashoffset
          ),
          diameter: loader.querySelector('.intro-loader_aperture').getBoundingClientRect().width,
          clip: getComputedStyle(heading).clipPath,
          split: heading.hasAttribute('data-split'),
          chars: heading.querySelectorAll('[data-char]').length,
          width: heading.clientWidth,
          opacity: char ? Number(getComputedStyle(char).opacity) : 1,
          nav: [...document.querySelectorAll('[data-hero-intro-nav]')].map((el) => ({
            part: el.dataset.heroIntroNav,
            opacity: Number(getComputedStyle(el).opacity),
          })),
        });
      }
      if (now < until) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await page.goto(SITE + (name === 'hash' ? '#main' : ''), { waitUntil: 'domcontentloaded' });
  return { page, errors };
}

async function readable(page) {
  const state = await page.evaluate(() => {
    const hero = document.querySelector('[data-hero-intro-content]');
    const h = hero.querySelector('h1');
    return {
      text: h.innerText,
      visible: h.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      clip: getComputedStyle(h).clipPath,
      splits: hero.querySelectorAll('[data-split]').length,
      loader: getComputedStyle(document.querySelector('[data-hero-intro]')).visibility,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.equal(state.text, 'Influence for Good');
  assert(state.visible);
  assert(['none', 'inset(0px)', 'inset(0px 0px 0%)'].includes(state.clip), JSON.stringify(state));
  assert.equal(state.splits, 0);
  assert.equal(state.loader, 'hidden');
  assert.equal(state.overflow, false);
  return state;
}

try {
  for (const width of process.env.HERO_WIDTH
    ? [Number(process.env.HERO_WIDTH)]
    : [1440, 820, 667, 390]) {
    const { page, errors } = await pageFor('normal', width);
    await page.waitForFunction(
      () => document.querySelector('[data-hero-intro]')?.dataset.heroIntroState === 'playing',
      undefined,
      { timeout: 5000 }
    );
    await page.screenshot({ path: `${EVIDENCE}/${width}-intro.png` });
    await page.waitForFunction(() =>
      window.heroFrames.some((f) => f.split && f.opacity > 0 && f.opacity < 1)
    );
    await page.screenshot({ path: `${EVIDENCE}/${width}-text-reveal.png` });
    await page.waitForFunction(
      () => document.querySelector('[data-hero-intro]')?.dataset.heroIntroState === 'complete'
    );
    const final = await readable(page);
    await page.screenshot({ path: `${EVIDENCE}/${width}-complete.png` });
    const frames = await page.evaluate(() => window.heroFrames);
    assert(
      frames.some((f) => f.ring > 0 && f.ring < 100),
      'Ring progresses naturally'
    );
    assert(
      frames.some((f) => f.elapsed > 1000 && f.elapsed < 2154 && f.diameter > 150),
      'Circle aperture expands'
    );
    assert(
      frames.some((f) => f.split && f.opacity > 0 && f.opacity < 1),
      'Text reveals progressively'
    );
    assert(
      frames.some((f) => f.nav.some((n) => n.opacity > 0 && n.opacity < 1)),
      'Navbar arrives progressively'
    );
    const firstSplit = frames.findIndex((f) => f.split);
    assert(firstSplit >= 0);
    assert(
      frames.slice(0, firstSplit).every((f) => f.clip === 'inset(0px 0px 100%)'),
      'No unprepared hero text flashes'
    );
    assert.deepEqual(errors, []);
    results.push({ name: 'normal', width, final, frames });
    await page.close();
  }

  if (!process.env.HERO_WIDTH) {
    for (const name of ['pointer', 'keyboard', 'resize', 'scroll', 'reduced-change']) {
      const { page, errors } = await pageFor(name);
      await page.waitForFunction(
        () => document.querySelector('[data-hero-intro]')?.dataset.heroIntroState === 'playing'
      );
      if (name === 'pointer') await page.mouse.click(80, 40);
      if (name === 'keyboard') await page.keyboard.press('Tab');
      if (name === 'resize') await page.setViewportSize({ width: 1420, height: 960 });
      if (name === 'scroll') await page.evaluate(() => window.scrollTo(0, 100));
      if (name === 'reduced-change') await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(
        () => document.querySelector('[data-hero-intro]')?.dataset.heroIntroState === 'complete'
      );
      const final = await readable(page);
      if (name === 'pointer') {
        await page.waitForFunction(() =>
          document.querySelector('[data-nav-menu-popover]').matches(':popover-open')
        );
        await page.keyboard.press('Escape');
      }
      assert.deepEqual(errors, []);
      results.push({ name, final });
      await page.close();
    }
    for (const name of [
      'reduced',
      'hash',
      'slow-fonts',
      'slow-component',
      'missing-text',
      'no-js',
    ]) {
      const settings =
        name === 'reduced'
          ? { reducedMotion: 'reduce' }
          : name === 'no-js'
            ? { javaScriptEnabled: false }
            : {};
      const { page, errors } = await pageFor(name, 390, settings);
      await page.waitForTimeout(name.startsWith('slow') ? 6500 : 3500);
      const final = await readable(page);
      const frames = await page.evaluate(() => window.heroFrames ?? []);
      assert(
        frames.every((f) => !f.split),
        `${name}: skipped intros must not replay late`
      );
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
  const trace =
    activePage && !activePage.isClosed()
      ? await activePage.evaluate(() => ({ frames: window.heroFrames, events: window.heroEvents }))
      : undefined;
  await writeFile(
    `${EVIDENCE}/results.json`,
    JSON.stringify({ status: 'failed', error: error.stack, trace, results }, null, 2)
  );
  throw error;
} finally {
  await browser.close();
}
