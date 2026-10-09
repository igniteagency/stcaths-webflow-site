#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const EVIDENCE = resolve(
  process.env.BUTTON_TEXT_EVIDENCE_DIR ??
    '/Volumes/Sandisk-2TB-SSD/hermes/outputs/stcaths-button-text-motion/final'
);
const FONT =
  process.env.BUTTON_TEXT_FONT_PATH ??
  '/Volumes/Sandisk-2TB-SSD/hermes/outputs/stcaths-main-concept-review/concept/node_modules/@fontsource-variable/libre-franklin/files/libre-franklin-latin-wght-normal.woff2';
const result = {
  startedAt: new Date().toISOString(),
  status: 'running',
  scenarios: [],
  evidence: [],
};
const hash = (body) => createHash('sha256').update(body).digest('hex');
let browser, server;
try {
  await mkdir(EVIDENCE, { recursive: true });
  result.bundleSha256 = hash(await readFile(new URL('dist/prod/components/button-text.js', ROOT)));
  const playwright = process.env.PLAYWRIGHT_MODULE
    ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
    : await import('playwright');
  const files = new Map();
  for (const [url, path, type] of [
    ['/', new URL('tests/fixtures/button-text.html', ROOT), 'text/html'],
    [
      '/dist/prod/components/button-text.js',
      new URL('dist/prod/components/button-text.js', ROOT),
      'text/javascript',
    ],
    [
      '/dist/prod/components/text-reveal.js',
      new URL('dist/prod/components/text-reveal.js', ROOT),
      'text/javascript',
    ],
    ['/font.woff2', FONT, 'font/woff2'],
    ['/late.woff2', FONT, 'font/woff2'],
    [
      '/gsap.js',
      process.env.TEXT_REVEAL_GSAP_PATH ?? new URL('node_modules/gsap/dist/gsap.min.js', ROOT),
      'text/javascript',
    ],
    [
      '/ScrollTrigger.js',
      process.env.TEXT_REVEAL_SCROLLTRIGGER_PATH ??
        new URL('node_modules/gsap/dist/ScrollTrigger.min.js', ROOT),
      'text/javascript',
    ],
  ]) {
    const body = await readFile(path);
    files.set(url, { body, type });
    (result.assets ??= {})[url] = { source: String(path), sha256: hash(body) };
  }
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const file =
      path === '/native-submit'
        ? {
            type: 'text/html',
            body: '<!doctype html><title>Submitted</title>Native submission received',
          }
        : files.get(path);
    const respond = () => {
      response.writeHead(file ? 200 : 404, {
        'Content-Type': file?.type ?? 'text/plain',
        'Cache-Control': 'no-store',
      });
      response.end(file?.body ?? 'Not found');
    };
    if (path === '/late.woff2') setTimeout(respond, 350);
    else respond();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({
    headless: true,
    chromiumSandbox: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  result.browser = browser.version();

  async function capture(page, name, phase) {
    const stem = `${name}-${phase}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    const state = await page.evaluate(() => fixture.state());
    const cdp = await page.context().newCDPSession(page);
    try {
      const ax = await cdp.send('Accessibility.getFullAXTree');
      await page.screenshot({ path: join(EVIDENCE, `${stem}.png`), animations: 'allow' });
      await writeFile(join(EVIDENCE, `${stem}.state.json`), JSON.stringify(state, null, 2) + '\n');
      await writeFile(join(EVIDENCE, `${stem}.ax.json`), JSON.stringify(ax, null, 2) + '\n');
      result.evidence.push({
        name,
        phase,
        screenshot: `${stem}.png`,
        state: `${stem}.state.json`,
        ax: `${stem}.ax.json`,
      });
      return { state, ax };
    } finally {
      await cdp.detach();
    }
  }
  async function scenario(name, run, options = {}) {
    if (process.env.BUTTON_TEXT_SCENARIO && !name.includes(process.env.BUTTON_TEXT_SCENARIO))
      return;
    const entry = { name, status: 'running' };
    result.scenarios.push(entry);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1100 },
      ...options,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    try {
      await page.goto(base);
      await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.evaluate(() => document.fonts.check('16px "Libre Franklin QA"')));
      await run(page, name);
      assert.deepEqual(errors, [], 'uncaught browser errors');
      await capture(page, name, 'result');
      entry.status = 'passed';
      console.info(`PASS ${name}`);
    } catch (error) {
      entry.status = 'failed';
      entry.error = error.stack ?? String(error);
      try {
        await capture(page, name, 'failure');
      } catch (captureError) {
        entry.captureError = String(captureError);
      }
      throw error;
    } finally {
      await context.close();
    }
  }
  const start = (page, scroll = false) =>
    page.evaluate((scroll) => fixture.start({ scroll }), scroll);
  const event = (page, id, type, pointerType = 'mouse') =>
    page.locator(`#${id}`).dispatchEvent(type, { pointerType });
  const restored = async (page, ids) => {
    await page.waitForFunction((ids) => ids.every((id) => fixture.clean(id)), ids);
  };
  const playing = async (page, id) => {
    await page.waitForFunction((id) => !fixture.clean(id), id);
  };
  const count = (page) => page.evaluate(() => fixture.records.length);
  const dispose = (page) => page.evaluate(() => stCathsButtonText.dispose());
  function axName(ax, role, name) {
    assert.equal(
      ax.nodes.filter((n) => !n.ignored && n.role?.value === role && n.name?.value === name).length,
      1,
      `${role}: ${name}`
    );
  }

  for (const width of [360, 768, 1280]) {
    await scenario(
      `typography-${width}-real-progress-completion`,
      async (page, name) => {
        await start(page);
        const ids = ['overlay-label', 'direct-label', 'glyph-label', 'wrap-label'];
        const before = await page.evaluate(
          (ids) => Object.fromEntries(ids.map((id) => [id, fixture.geometry(id)])),
          ids
        );
        await page.evaluate(() => {
          for (const id of ['overlay', 'direct', 'glyph', 'wrap-link'])
            document
              .getElementById(id)
              .dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
        });
        await playing(page, 'glyph-label');
        const geometry = await page.evaluate((ids) => {
          const flow = Object.fromEntries(ids.map((id) => [id, fixture.geometry(id, true)]));
          const visuals = fixture.records
            .filter((_, i) => i % 2 === 0)
            .map(({ target, label, animation }) => {
              const range = document.createRange();
              range.selectNodeContents(target);
              const box = range.getBoundingClientRect();
              const matrix = new DOMMatrix(getComputedStyle(target).transform);
              return {
                label,
                text: target.textContent,
                left: box.left,
                top: box.top - matrix.m42,
                delay: animation.effect.getTiming().delay,
              };
            });
          return { flow, visuals };
        }, ids);
        for (const id of ids) {
          for (const key of ['width', 'height', 'left', 'top'])
            assert.ok(
              Math.abs(geometry.flow[id][key] - before[id][key]) < 0.5,
              `${id} ${key} drift`
            );
          assert.deepEqual(
            geometry.flow[id].glyphs,
            before[id].glyphs,
            `${id} native wrapping and spacing`
          );
          const visuals = geometry.visuals.filter((v) => v.label === id);
          for (let i = 0; i < visuals.length; i++) {
            if (!visuals[i].text.trim()) continue;
            assert.equal(visuals[i].text, before[id].glyphs[i].text);
            for (const key of ['left', 'top'])
              assert.ok(
                Math.abs(visuals[i][key] - before[id].glyphs[i][key]) < 1,
                `${id} glyph ${i} ${key}`
              );
          }
        }
        await page.waitForFunction(() =>
          fixture.records.some(({ animation: a }) => a.currentTime > 20 && a.currentTime < 350)
        );
        const partial = await capture(page, name, 'partial');
        assert.ok(
          partial.state.records.some((r) => r.progress > 0 && r.progress < 1),
          'real partial progress'
        );
        axName(partial.ax, 'link', 'Enquire');
        axName(partial.ax, 'link', 'Arrange a visit');
        axName(partial.ax, 'link', 'AV y 👩‍🎓 é');
        await restored(page, ids);
        assert.ok(
          await page.evaluate(() => fixture.records.every((r) => r.finishedAt !== null)),
          'all native WAAPI copies actually finished before reset'
        );
        await capture(page, name, 'completed');
        const after = await page.evaluate(
          (ids) => Object.fromEntries(ids.map((id) => [id, fixture.geometry(id)])),
          ids
        );
        assert.deepEqual(after, before);
        await page.evaluate(() =>
          document.getElementById('glyph-label').dispatchEvent(new Event('qa-identity'))
        );
        assert.equal(await page.evaluate(() => fixture.listenerCalls), 1);
      },
      { viewport: { width, height: 1200 } }
    );
  }

  await scenario('overlay-scope-independent-nested-direct-button', async (page) => {
    await start(page);
    await event(page, 'overlay-label', 'pointerenter');
    assert.equal(await count(page), 0);
    await event(page, 'outer-link', 'pointerenter');
    await playing(page, 'outer-label');
    assert.ok(
      await page.evaluate(() => fixture.clean('inner-label') && fixture.clean('overlay-label'))
    );
    await event(page, 'inner-link', 'pointerenter');
    await playing(page, 'inner-label');
    await page.evaluate(() => stCathsButtonText.dispose(document.getElementById('outer-label')));
    await restored(page, ['outer-label']);
    assert.ok(await page.evaluate(() => !fixture.clean('inner-label')));
    await event(page, 'native-button', 'focus');
    await playing(page, 'button-label');
    await dispose(page);
    await restored(page, ['inner-label', 'button-label']);
  });

  await scenario('enter-leave-focus-blur-one-replay', async (page) => {
    await start(page);
    await page.locator('#overlay').hover();
    await playing(page, 'overlay-label');
    await page.mouse.move(0, 0);
    for (const type of ['focus', 'blur', 'pointerenter', 'pointerleave'])
      await event(page, 'overlay', type);
    await page.waitForFunction(() => fixture.records.length === 28);
    await restored(page, ['overlay-label']);
    await page.waitForTimeout(100);
    assert.equal(await count(page), 28);
    await page.locator('#overlay').focus();
    await playing(page, 'overlay-label');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'overlay');
    await restored(page, ['overlay-label']);
    await page.locator('#overlay').evaluate((el) => el.blur());
    await playing(page, 'overlay-label');
    assert.notEqual(await page.evaluate(() => document.activeElement.id), 'overlay');
    await restored(page, ['overlay-label']);
    assert.equal(await count(page), 56);
  });

  await scenario('native-keyboard-click-and-submit', async (page) => {
    await start(page);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'overlay');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/#destination');
    await page.evaluate(() => {
      history.replaceState(null, '', '/');
      document.activeElement.blur();
    });
    await page.locator('#direct').click();
    await page.waitForURL('**/#destination');
    await page.locator('#native-button').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => document.querySelector('iframe').contentWindow.location.search === '?action=tour'
    );
    assert.equal(await page.locator('#overlay').getAttribute('aria-label'), 'Enquire');
    assert.equal(await page.locator('#inner-link').getAttribute('aria-labelledby'), 'inner-label');
    await dispose(page);
    await restored(page, ['overlay-label', 'direct-label', 'button-label']);
  });

  await scenario('optouts-unsafe-empty-disabled-inert', async (page) => {
    await start(page);
    await page.evaluate(() =>
      document.querySelectorAll('#skips .button_link').forEach((el) => {
        el.dispatchEvent(new Event('focus'));
        el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
      })
    );
    assert.equal(await count(page), 0);
    for (const [attribute, value] of [
      ['data-text-reveal', 'off'],
      ['data-no-text-motion', ''],
      ['data-no-heading-motion', ''],
      ['data-button-text', 'off'],
    ]) {
      await page.evaluate(
        ([attribute, value]) => document.body.setAttribute(attribute, value),
        [attribute, value]
      );
      await event(page, 'overlay', 'focus');
      assert.equal(await count(page), 0);
      await page.evaluate((attribute) => document.body.removeAttribute(attribute), attribute);
    }
    await page
      .locator('#overlay-label')
      .evaluate((el) => el.setAttribute('data-text-trigger', 'manual'));
    await event(page, 'overlay', 'focus');
    await playing(page, 'overlay-label');
    await dispose(page);
    await page.evaluate(() => {
      document.getElementById('overlay-label').removeAttribute('data-text-trigger');
      document.getElementById('rich-child').dispatchEvent(new Event('qa-identity'));
    });
    await restored(page, [...(await page.evaluate(() => [...fixture.native.keys()]))]);
    assert.equal(await page.evaluate(() => fixture.listenerCalls), 1);
  });

  await scenario('scroll-integration-button-exclusion-neighbor-reveal', async (page) => {
    await start(page, true);
    assert.ok(await page.evaluate(() => fixture.calls.includes('neighbor')));
    assert.equal(
      await page.evaluate(() =>
        fixture.calls.some((id) => document.getElementById(id)?.closest('.button_text'))
      ),
      false
    );
    await event(page, 'overlay', 'pointerenter');
    await playing(page, 'overlay-label');
    await page.locator('#neighbor').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => !!document.querySelector('#neighbor [data-line]'));
    await page.waitForFunction(() => !document.querySelector('#neighbor [data-line]'));
    await restored(page, ['overlay-label']);
  });

  await scenario(
    'initial-and-live-reduced-motion',
    async (page) => {
      await start(page);
      await event(page, 'overlay', 'focus');
      assert.equal(await count(page), 0);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await event(page, 'overlay', 'focus');
      await playing(page, 'overlay-label');
      await event(page, 'overlay', 'blur');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await restored(page, ['overlay-label']);
      await page.waitForTimeout(1000);
      assert.equal(await count(page), 14);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await event(page, 'overlay', 'focus');
      await playing(page, 'overlay-label');
      await dispose(page);
    },
    { reducedMotion: 'reduce' }
  );

  await scenario(
    'touch-coarse-no-hover-keyboard-parity',
    async (page) => {
      await start(page);
      assert.equal(
        await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches),
        false
      );
      for (const pointerType of ['touch', 'mouse', 'pen'])
        for (const type of ['pointerenter', 'pointerleave'])
          await event(page, 'overlay', type, pointerType);
      assert.equal(await count(page), 0);
      await page.locator('#overlay').focus();
      await playing(page, 'overlay-label');
      await dispose(page);
    },
    { hasTouch: true, isMobile: true, viewport: { width: 360, height: 900 } }
  );

  for (const reason of ['resize', 'container', 'fonts', 'dispose', 'pagehide']) {
    await scenario(`cancel-${reason}-drops-replay`, async (page) => {
      await start(page);
      await event(page, 'overlay', 'pointerenter');
      await playing(page, 'overlay-label');
      await event(page, 'overlay', 'pointerleave');
      if (reason === 'resize') await page.setViewportSize({ width: 768, height: 1100 });
      if (reason === 'container')
        await page.locator('#overlay-label').evaluate((el) => {
          el.parentElement.style.width = '220px';
        });
      if (reason === 'fonts')
        await page.evaluate(() => {
          const font = new FontFace('Late QA', 'url(/late.woff2)');
          document.fonts.add(font);
          void font.load();
        });
      if (reason === 'dispose') await dispose(page);
      if (reason === 'pagehide')
        await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
      await restored(page, ['overlay-label']);
      await page.waitForTimeout(900);
      assert.equal(await count(page), 14);
    });
  }

  await scenario('pending-fonts-native-until-ready', async (page) => {
    await start(page);
    await page.evaluate(() => {
      const font = new FontFace('Late QA', 'url(/late.woff2)');
      document.fonts.add(font);
      void font.load();
      document.getElementById('overlay').dispatchEvent(new Event('focus'));
    });
    assert.equal(await count(page), 0);
    assert.ok(await page.evaluate(() => fixture.clean('overlay-label')));
    await playing(page, 'overlay-label');
    await restored(page, ['overlay-label']);
  });

  await scenario('repeat-load-init-dynamic-content-disposal', async (page) => {
    await start(page);
    await page.evaluate(async () => {
      stCathsButtonText.init();
      await fixture.load('/dist/prod/components/button-text.js?repeat');
      stCathsButtonText.init(document.getElementById('overlay'));
    });
    await event(page, 'overlay', 'focus');
    await playing(page, 'overlay-label');
    await restored(page, ['overlay-label']);
    assert.equal(await count(page), 14);
    await page.evaluate(() => {
      const parent = document.createElement('div');
      parent.innerHTML =
        '<a class="button_link direct" id="dynamic" href="#destination"><span class="button_text" id="dynamic-label">New</span></a>';
      document.querySelector('main').prepend(parent);
      fixture.remember(parent);
      stCathsButtonText.init(parent);
      stCathsButtonText.init(parent);
    });
    await event(page, 'dynamic', 'focus');
    await playing(page, 'dynamic-label');
    await page.evaluate(() => stCathsButtonText.dispose(document.getElementById('dynamic')));
    await restored(page, ['dynamic-label']);
    await event(page, 'dynamic', 'blur');
    assert.equal(await count(page), 20);
  });

  for (const dependency of [
    'gsap',
    'WAAPI',
    'Segmenter',
    'ResizeObserver',
    'throw-WAAPI',
    'throw-Range',
  ]) {
    await scenario(`deps-fallback-${dependency}`, async (page) => {
      await page.evaluate((dependency) => {
        if (dependency === 'gsap') {
          window.gsap = undefined;
          window.ScrollTrigger = undefined;
        }
        if (dependency === 'WAAPI') Element.prototype.animate = undefined;
        if (dependency === 'Segmenter') Intl.Segmenter = undefined;
        if (dependency === 'ResizeObserver') window.ResizeObserver = undefined;
        if (dependency === 'throw-Range')
          Range.prototype.getBoundingClientRect = () => {
            throw new Error('Forced range error');
          };
        if (dependency === 'throw-WAAPI') {
          const animate = Element.prototype.animate;
          let count = 0;
          Element.prototype.animate = function (...args) {
            if (++count === 2) throw new Error('Forced WAAPI error');
            return animate.apply(this, args);
          };
        }
      }, dependency);
      await start(page);
      await event(page, 'glyph', 'focus');
      if (['WAAPI', 'ResizeObserver', 'throw-WAAPI', 'throw-Range'].includes(dependency)) {
        await restored(page, ['glyph-label']);
        assert.ok((await count(page)) <= 1);
      } else {
        await playing(page, 'glyph-label');
        await restored(page, ['glyph-label']);
        assert.ok((await count(page)) > 0);
      }
    });
  }
  assert.ok(result.scenarios.length, 'scenario filter matched nothing');
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = error.stack ?? String(error);
  console.error(error);
  process.exitCode = 1;
  if (
    /MachPort|bootstrap_check_in|Operation not permitted|Permission denied|EPERM/i.test(
      String(error)
    )
  )
    console.error(
      'Sandbox denied browser setup. Parent must run this QA outside Codex; do not retry or bypass the sandbox.'
    );
} finally {
  try {
    await browser?.close();
  } catch (error) {
    result.status = 'failed';
    result.error = String(error);
    process.exitCode = 1;
  }
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  result.finishedAt = new Date().toISOString();
  result.passedScenarios = result.scenarios.filter((s) => s.status === 'passed').length;
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(join(EVIDENCE, 'run-result.json'), JSON.stringify(result, null, 2) + '\n');
}
