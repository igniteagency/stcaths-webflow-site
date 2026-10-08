#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const FONT_URL =
  'https://fonts.gstatic.com/s/opensans/v44/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsjZ0B4gaVIUwaEQbjA.woff2';
const EVIDENCE_DIR = process.env.TEXT_REVEAL_EVIDENCE_DIR
  ? resolve(process.env.TEXT_REVEAL_EVIDENCE_DIR)
  : null;
const result = {
  startedAt: new Date().toISOString(),
  status: 'running',
  scenarios: [],
  evidence: [],
};
const require = createRequire(import.meta.url);
let browser;
let server;
let checks = 0;
try {
  if (EVIDENCE_DIR) await mkdir(EVIDENCE_DIR, { recursive: true });
  const playwright = process.env.PLAYWRIGHT_MODULE
    ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
    : await import('playwright');
  const files = new Map(
    await Promise.all(
      [
        ['/', new URL('tests/fixtures/text-reveal.html', ROOT), 'text/html'],
        [
          '/dist/prod/components/text-reveal.js',
          new URL('dist/prod/components/text-reveal.js', ROOT),
          'text/javascript',
        ],
        ['/gsap.js', require.resolve('gsap/dist/gsap.min.js'), 'text/javascript'],
      ].map(async ([url, path, type]) => [url, { body: await readFile(path), type }])
    )
  );
  result.bundleSha256 = createHash('sha256')
    .update(files.get('/dist/prod/components/text-reveal.js').body)
    .digest('hex');
  const font = process.env.TEXT_REVEAL_FONT_PATH
    ? await readFile(process.env.TEXT_REVEAL_FONT_PATH)
    : await fetch(FONT_URL).then(async (response) => {
        assert.equal(response.ok, true, `webfont fetch failed: ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
      });
  files.set('/qa-font.woff2', { body: font, type: 'font/woff2' });
  server = createServer((request, response) => {
    const file = files.get(new URL(request.url, 'http://localhost').pathname);
    response.writeHead(file ? 200 : 404, {
      'Content-Type': file?.type ?? 'text/plain',
      'Cache-Control': 'no-store',
    });
    response.end(file?.body ?? 'Not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  result.browser = browser.version();
  async function capture(page, name, phase) {
    if (!EVIDENCE_DIR) return;
    const stem = `${name}-${phase}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    const state = await page.evaluate(
      (phase) => ({
        phase,
        viewport: { width: innerWidth, height: innerHeight },
        tweens:
          window.fixture?.tweens.map((tween) => ({
            progress: tween.progress(),
            paused: tween.paused(),
            targetCount: tween.targets().length,
          })) ?? [],
        targets: [...(window.fixture?.native ?? [])].map(([id, before]) => {
          const element = document.getElementById(id);
          const chars = [...element.querySelectorAll('[data-char]')];
          return {
            id,
            charCount: chars.length,
            // Reading the host's attributes while split can mask lazy CSSOM restoration bugs.
            ...(phase === 'split' ? {} : { before: before.html, after: element.outerHTML }),
            chars: chars.map((char) => ({
              opacity: getComputedStyle(char).opacity,
              transform: getComputedStyle(char).transform,
            })),
          };
        }),
      }),
      phase
    );
    const cdp = await page.context().newCDPSession(page);
    try {
      const ax = await cdp.send('Accessibility.getFullAXTree');
      await page.screenshot({ path: join(EVIDENCE_DIR, `${stem}.png`), animations: 'allow' });
      await writeFile(join(EVIDENCE_DIR, `${stem}.ax.json`), JSON.stringify(ax, null, 2) + '\n');
      await writeFile(
        join(EVIDENCE_DIR, `${stem}.state.json`),
        JSON.stringify(state, null, 2) + '\n'
      );
      result.evidence.push({
        name,
        phase,
        screenshot: `${stem}.png`,
        ax: `${stem}.ax.json`,
        state: `${stem}.state.json`,
      });
    } finally {
      await cdp.detach();
    }
  }
  async function scenario(name, run, options = {}) {
    if (process.env.TEXT_REVEAL_SCENARIO && !name.includes(process.env.TEXT_REVEAL_SCENARIO))
      return;
    const entry = { name, status: 'running' };
    result.scenarios.push(entry);
    let context;
    let page;
    const errors = [];
    try {
      context = await browser.newContext({
        viewport: { width: 900, height: 1200 },
        ...options,
      });
      page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.on('pageerror', (error) => errors.push(error.message));
      await run(page);
      assert.deepEqual(errors, [], 'uncaught browser errors');
      checks++;
      entry.status = 'passed';
      console.info(`PASS ${name}`);
    } catch (error) {
      entry.status = 'failed';
      entry.error = error.stack ?? String(error);
      entry.pageErrors = errors;
      try {
        if (page) await capture(page, name, 'failure');
      } catch (evidenceError) {
        entry.evidenceError = String(evidenceError);
      }
      throw error;
    } finally {
      await context?.close();
    }
  }
  async function open(page, query = '') {
    await page.goto(base + query);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.fonts.check('20px "Reveal QA"')), true);
  }
  async function start(page, ids) {
    await page.evaluate((ids) => fixture.prepare(ids), ids);
    await page.evaluate(() => fixture.load());
  }
  async function split(page, id) {
    await page.waitForFunction(
      (id) => document.getElementById(id).querySelector('[data-char]'),
      id
    );
  }
  async function restored(page, ids) {
    try {
      await page.waitForFunction((ids) => fixture.restored(ids), ids);
    } catch (error) {
      console.error(
        await page.evaluate(
          (ids) =>
            ids.map((id) => ({
              id,
              before: fixture.native.get(id).html,
              after: document.getElementById(id).outerHTML,
              tweens: fixture.tweens.map((t) => t.progress()),
            })),
          ids
        )
      );
      throw error;
    }
    assert.equal(await page.evaluate(() => fixture.clean()), true, 'observers released');
  }
  async function complete(page) {
    await page.evaluate(() => fixture.tweens.forEach((tween) => tween.progress(1)));
  }
  async function noReplay(page) {
    const count = await page.evaluate(() => fixture.tweens.length);
    await page.evaluate(() => fixture.load());
    await page.evaluate(() => window.stCathsTextReveal.init());
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => fixture.tweens.length), count);
  }

  await scenario('webfont loading blocks splitting', async (page) => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/qa-font.woff2', async (route) => {
      await gate;
      await route.fulfill({ body: font, contentType: 'font/woff2' });
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await start(page, ['balance']);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.fonts.status), 'loading');
    assert.equal(await page.locator('#balance [data-char]').count(), 0);
    release();
    await split(page, 'balance');
    assert.equal(await page.evaluate(() => document.fonts.status), 'loaded');
    await complete(page);
    await restored(page, ['balance']);
  });

  for (const width of [360, 1280]) {
    for (const style of [null, '', 'color: rgb(24, 40, 60); --chars: 77']) {
      await scenario(
        `paragraph style ${JSON.stringify(style)} restores without inspection at ${width}px`,
        async (page) => {
          await open(page);
          await page.locator('#pretty').evaluate((element, style) => {
            if (style !== null) element.setAttribute('style', style);
          }, style);
          await start(page, ['pretty']);
          await split(page, 'pretty');
          // No host attribute reads or evidence capture between splitting and completion.
          await complete(page);
          await restored(page, ['pretty']);
          await page.waitForTimeout(100);
          assert.equal(
            await page.evaluate(() => fixture.restored(['pretty'])),
            true,
            'restoration remains exact after later GSAP ticks'
          );
        },
        { viewport: { width, height: 1600 } }
      );
    }
  }

  for (const width of [360, 768, 1280]) {
    await scenario(
      `balance/pretty geometry and restoration at ${width}px`,
      async (page) => {
        await open(page);
        await start(page, ['balance', 'pretty']);
        await split(page, 'balance');
        await split(page, 'pretty');
        const geometry = await page.evaluate(() =>
          ['balance', 'pretty'].map((id) => {
            const element = document.getElementById(id);
            return {
              id,
              before: fixture.native.get(id).lines,
              after: [...element.querySelectorAll('[data-line]')].map((line) => ({
                text: line.textContent.replace(/\s+/g, ' ').trim(),
                width: line.getBoundingClientRect().width,
              })),
              heightBefore: fixture.native.get(id).height,
              heightAfter: element.getBoundingClientRect().height,
              width: element.clientWidth,
            };
          })
        );
        for (const item of geometry) {
          assert.deepEqual(
            item.after.map((row) => row.text),
            item.before.map((row) => row.text),
            `${item.id} painted line breaks`
          );
          assert.ok(Math.abs(item.heightBefore - item.heightAfter) <= 2, `${item.id} height drift`);
          assert.ok(
            item.after.every((row) => row.width <= item.width + 2),
            `${item.id} overflow`
          );
        }
        await page.evaluate(() => fixture.tweens.forEach((tween) => tween.progress(0.35)));
        const progress = await page.evaluate(() => ({
          tweens: fixture.tweens.map((tween) => tween.progress()),
          chars: ['balance', 'pretty'].map(
            (id) => document.getElementById(id).querySelectorAll('[data-char]').length
          ),
        }));
        assert.equal(progress.tweens.length, 2);
        assert.ok(progress.tweens.every((value) => Math.abs(value - 0.35) < 0.001));
        assert.ok(progress.chars.every((count) => count > 0));
        await capture(page, `geometry-${width}px`, 'split');
        await complete(page);
        await restored(page, ['balance', 'pretty']);
        assert.equal(
          await page.evaluate(() => fixture.tweens.every((tween) => tween.progress() === 1)),
          true
        );
        await capture(page, `geometry-${width}px`, 'complete');
        await noReplay(page);
        assert.equal(await page.evaluate(() => fixture.sameGSAP()), true);
      },
      { viewport: { width, height: 1600 } }
    );
  }

  await scenario(
    'accessibility tree keeps heading names, paragraph text and authored ARIA',
    async (page) => {
      await open(page);
      const before = await page.locator('#balance').ariaSnapshot();
      const authoredBefore = await page.locator('#authored').ariaSnapshot();
      const paragraphBefore = await page.locator('#pretty').ariaSnapshot();
      await start(page, ['balance', 'pretty', 'authored', 'at-hidden']);
      await split(page, 'authored');
      await split(page, 'pretty');
      const during = await page.locator('#balance').ariaSnapshot();
      assert.match(during, /heading "St Catherine’s School inspires girls to shape their future"/);
      assert.equal((during.match(/heading /g) ?? []).length, 1);
      assert.match(
        await page.locator('#authored').ariaSnapshot(),
        /heading "The authored accessible name"/
      );
      assert.equal(await page.locator('#pretty').ariaSnapshot(), paragraphBefore);
      assert.equal(await page.locator('#at-hidden').ariaSnapshot(), '');
      assert.equal(await page.locator('[data-char]:not([aria-hidden="true"])').count(), 0);
      const cdp = await page.context().newCDPSession(page);
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      const headings = nodes.filter((node) => !node.ignored && node.role?.value === 'heading');
      assert.equal(
        headings.filter(
          (node) =>
            node.name?.value?.replace(/\s+/g, ' ').trim() ===
            'St Catherine’s School inspires girls to shape their future'
        ).length,
        1
      );
      assert.equal(
        headings.filter((node) => node.name?.value === 'The authored accessible name').length,
        1
      );
      console.info(`  AX evidence: ${headings.map((node) => node.name?.value).join(' | ')}`);
      await complete(page);
      await restored(page, ['balance', 'pretty', 'authored', 'at-hidden']);
      assert.equal(await page.locator('#balance').ariaSnapshot(), before);
      assert.equal(await page.locator('#authored').ariaSnapshot(), authoredBefore);
    }
  );

  for (const kind of ['viewport', 'container']) {
    await scenario(`${kind} resize mid-animation cancels and does not replay`, async (page) => {
      await open(page);
      await start(page, ['balance']);
      await split(page, 'balance');
      // Returning a paused GSAP tween makes Playwright await its completion forever.
      const partial = await page.evaluate(() => {
        fixture.tweens[0].progress(0.3);
        return [...document.querySelectorAll('#balance [data-char]')].map((char) =>
          Number(getComputedStyle(char).opacity)
        );
      });
      assert.ok(
        partial.some((opacity) => opacity > 0 && opacity < 1),
        'characters visibly animate'
      );
      assert.ok(partial[0] > partial.at(-1), 'character stagger advances in order');
      if (kind === 'viewport') await page.setViewportSize({ width: 600, height: 1200 });
      else
        await page.locator('.column').evaluate((el) => {
          el.style.width = '370px';
        });
      await restored(page, ['balance']);
      await noReplay(page);
    });
  }

  await scenario(
    'reduced motion initially skips without watchers',
    async (page) => {
      await open(page);
      await start(page, ['balance', 'hidden']);
      await restored(page, ['balance', 'hidden']);
      assert.equal(await page.evaluate(() => fixture.tweens.length), 0);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await noReplay(page);
    },
    { reducedMotion: 'reduce' }
  );

  await scenario(
    'reduced motion change cancels active and hidden pending targets',
    async (page) => {
      await open(page);
      await start(page, ['balance', 'hidden']);
      await split(page, 'balance');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await restored(page, ['balance', 'hidden']);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.locator('#hidden-parent').evaluate((el) => {
        el.style.display = 'block';
      });
      await noReplay(page);
    }
  );

  for (const id of ['hidden', 'visibility', 'zero', 'offscreen']) {
    await scenario(`${id} activation waits for visible measurable text`, async (page) => {
      await open(page);
      await start(page, [id]);
      await page.waitForTimeout(100);
      assert.equal(await page.locator(`#${id} [data-char]`).count(), 0);
      assert.equal(await page.evaluate(([id]) => fixture.restored([id]), [id]), true);
      if (id === 'hidden')
        await page.locator('#hidden-parent').evaluate((el) => {
          el.style.display = 'block';
        });
      if (id === 'visibility')
        await page.locator('#visibility-parent').evaluate((el) => {
          el.style.visibility = 'visible';
        });
      if (id === 'zero')
        await page.locator('#zero-parent').evaluate((el) => {
          el.style.width = '500px';
        });
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await split(page, id);
      await complete(page);
      await restored(page, [id]);
      await noReplay(page);
    });
  }

  await scenario('repeated script execution and init never duplicate or replay', async (page) => {
    await open(page);
    await start(page, ['balance']);
    await split(page, 'balance');
    await noReplay(page);
    assert.equal(await page.evaluate(() => fixture.tweens.length), 1);
    await complete(page);
    await restored(page, ['balance']);
    await noReplay(page);
    await page.evaluate(() => {
      const el = document.createElement('h2');
      el.id = 'dynamic';
      el.textContent = 'A newly inserted heading';
      document.querySelector('main').prepend(el);
      fixture.prepare(['dynamic']);
      window.stCathsTextReveal.init(el);
    });
    await split(page, 'dynamic');
    await complete(page);
    await restored(page, ['dynamic']);
  });

  await scenario('rich, interactive and accessible child markup stays untouched', async (page) => {
    await open(page);
    const ids = [
      'rich',
      'link',
      'accessible-child',
      'focusable',
      'nested-link',
      'editable',
      'button-role',
      'nonsemantic',
    ];
    const before = await page.locator('#link').ariaSnapshot();
    await start(page, ids);
    await restored(page, ids);
    assert.equal(await page.evaluate(() => fixture.tweens.length), 0);
    assert.equal(await page.locator('#link').ariaSnapshot(), before);
  });

  for (const failure of ['gsap', 'split', 'tween', 'observer']) {
    await scenario(`${failure} fallback leaves natural text`, async (page) => {
      await open(page);
      const expectedErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') expectedErrors.push(message.text());
      });
      await page.evaluate((failure) => {
        if (failure === 'gsap') window.gsap = undefined;
        if (failure === 'observer') window.IntersectionObserver = undefined;
        if (failure === 'split')
          Range.prototype.getClientRects = () => {
            throw new Error('Forced layout measurement failure');
          };
        if (failure === 'tween')
          window.gsap.fromTo = () => {
            throw new Error('Forced tween failure');
          };
      }, failure);
      await start(page, ['balance']);
      await page.waitForTimeout(150);
      await restored(page, ['balance']);
      assert.equal(await page.evaluate(() => fixture.tweens.length), 0);
      if (failure === 'split' || failure === 'tween')
        assert.ok(expectedErrors.some((text) => text.includes('Text reveal skipped:')));
    });
  }

  for (const width of [360, 1280]) {
    await scenario(
      `real-time GSAP completion restores heading and paragraph at ${width}px`,
      async (page) => {
        await open(page, '?live');
        await start(page, ['balance', 'pretty']);
        await split(page, 'balance');
        await split(page, 'pretty');
        await restored(page, ['balance', 'pretty']);
        assert.equal(
          await page.evaluate(() => fixture.tweens.every((tween) => tween.progress() === 1)),
          true
        );
      },
      { viewport: { width, height: 1600 } }
    );
  }
  result.status = 'passed';
  console.info(
    `PASS ${checks} browser scenarios using ${fileURLToPath(ROOT)}dist/prod/components/text-reveal.js`
  );
} catch (error) {
  result.status = 'failed';
  result.error = error.stack ?? String(error);
  console.error(error);
  if (
    /MachPort|bootstrap_check_in|Operation not permitted|Permission denied|EPERM/i.test(
      String(error)
    )
  ) {
    console.error(
      'Browser sandbox launch failure. Do not bypass it; Hermes must run this QA outside the coding sandbox.'
    );
  }
  process.exitCode = 1;
} finally {
  try {
    await browser?.close();
  } catch (error) {
    result.status = 'failed';
    result.error = error.stack ?? String(error);
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    if (EVIDENCE_DIR) {
      result.finishedAt = new Date().toISOString();
      result.passedScenarios = checks;
      await writeFile(
        join(EVIDENCE_DIR, 'run-result.json'),
        JSON.stringify(result, null, 2) + '\n'
      );
    }
  }
}
