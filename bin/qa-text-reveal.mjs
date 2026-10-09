#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
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
let browser;
let server;
let checks = 0;
try {
  if (EVIDENCE_DIR) await mkdir(EVIDENCE_DIR, { recursive: true });
  result.bundleSha256 = createHash('sha256')
    .update(await readFile(new URL('dist/prod/components/text-reveal.js', ROOT)))
    .digest('hex');
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
      ].map(async ([url, path, type]) => [url, { body: await readFile(path), type }])
    )
  );
  for (const [url, env, filename] of [
    ['/gsap.js', 'TEXT_REVEAL_GSAP_PATH', 'gsap.min.js'],
    ['/ScrollTrigger.js', 'TEXT_REVEAL_SCROLLTRIGGER_PATH', 'ScrollTrigger.min.js'],
  ]) {
    const body = process.env[env]
      ? await readFile(process.env[env])
      : await fetch(`https://cdn.prod.website-files.com/gsap/3.15.0/${filename}`).then(
          async (response) => {
            assert.ok(response.ok, `${filename} fetch: ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
          }
        );
    files.set(url, { body, type: 'text/javascript' });
    result[`${filename}Sha256`] = createHash('sha256').update(body).digest('hex');
  }
  const font = process.env.TEXT_REVEAL_FONT_PATH
    ? await readFile(process.env.TEXT_REVEAL_FONT_PATH)
    : await fetch(FONT_URL).then(async (response) => {
        assert.equal(response.ok, true, `webfont fetch failed: ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
      });
  files.set('/qa-font.woff2', { body: font, type: 'font/woff2' });
  result.fontSha256 = createHash('sha256').update(font).digest('hex');
  result.fontSource = process.env.TEXT_REVEAL_FONT_PATH ?? FONT_URL;
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
    chromiumSandbox: true,
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
        triggers: window.ScrollTrigger?.getAll().map((t) => ({
          id: t.trigger?.id,
          start: t.start,
        })),
        componentClean: window.fixture?.clean(),
        geometry: window.fixture?.geometry,
        tweens:
          window.fixture?.tweens.map((tween) => ({
            progress: tween.progress(),
            paused: tween.paused(),
            targetCount: tween.targets().length,
          })) ?? [],
        targets: [...(window.fixture?.native ?? [])].map(([id, before]) => {
          const element = document.getElementById(id);
          const chars = [...element.querySelectorAll('[data-char],[data-word],[data-line]')];
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
  async function assertAXName(page, role, name) {
    const cdp = await page.context().newCDPSession(page);
    try {
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      assert.equal(
        nodes.filter(
          (node) => !node.ignored && node.role?.value === role && node.name?.value === name
        ).length,
        1,
        `${role} AX name: ${name}`
      );
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
      page.setDefaultTimeout(8000);
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
    assert.deepEqual(await page.evaluate(() => [gsap.version, ScrollTrigger.version]), [
      '3.15.0',
      '3.15.0',
    ]);
  }
  async function start(page, ids) {
    await page.evaluate((ids) => fixture.prepare(ids), ids);
    await page.evaluate(() => fixture.load());
  }
  async function split(page, id) {
    await page.waitForFunction(
      (id) => document.getElementById(id).querySelector('[data-line]'),
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
    assert.equal(await page.locator('#balance [data-line]').count(), 0);
    release();
    await split(page, 'balance');
    await complete(page);
    await restored(page, ['balance']);
  });

  await scenario(
    'global H1 outside main immediately reveals and below-fold text uses ScrollTrigger once',
    async (page) => {
      await open(page);
      await start(page, ['balance', 'eyebrow', 'offscreen', 'footer-copy']);
      await split(page, 'balance');
      await split(page, 'eyebrow');
      assert.equal(await page.locator('#balance').getAttribute('data-text-reveal'), null);
      assert.equal(await page.locator('#balance').evaluate((el) => !!el.closest('main')), false);
      assert.equal(await page.evaluate(() => scrollY), 0);
      assert.equal(await page.locator('#offscreen [data-line]').count(), 0);
      assert.deepEqual(
        await page.evaluate(() =>
          ScrollTrigger.getAll()
            .map((t) => t.trigger.id)
            .sort()
        ),
        ['footer-copy', 'offscreen']
      );
      await page.evaluate(() => {
        fixture.tweens.forEach((t) => t.progress(0.35));
      });
      await capture(page, 'global', 'split');
      await complete(page);
      const footerStart = await page.evaluate(() => ({
        start: ScrollTrigger.getAll().find((t) => t.trigger.id === 'footer-copy').start,
        max: ScrollTrigger.maxScroll(window),
      }));
      assert.ok(
        footerStart.start >= footerStart.max - 2 && footerStart.start < footerStart.max,
        'footer start stays inside the reachable scroll range'
      );
      await page.evaluate(() => {
        scrollTo(0, ScrollTrigger.maxScroll(window));
      });
      await split(page, 'offscreen');
      await split(page, 'footer-copy');
      assert.equal(
        await page.evaluate(
          () =>
            document.querySelector('#footer-copy').getBoundingClientRect().top > innerHeight * 0.92
        ),
        true,
        'footer reveals even when 92% is unreachable'
      );
      await complete(page);
      await restored(page, ['balance', 'eyebrow', 'offscreen', 'footer-copy']);
      await noReplay(page);
      assert.equal(await page.evaluate(() => fixture.sameGSAP()), true);
    }
  );

  for (const width of [360, 768, 1280]) {
    await scenario(
      `rich text painted geometry and AX at ${width}px`,
      async (page) => {
        await open(page);
        const ids = [
          'balance',
          'pretty',
          'rich',
          'linked-paragraph',
          'quote-direct',
          'list-direct',
        ];
        await page.evaluate((ids) => {
          // Keep every geometry target visible without changing its typography or inline markup.
          const column = document.querySelector('.column');
          column.classList.add('w-richtext');
          ids.forEach((id) => column.append(document.getElementById(id)));
        }, ids);
        await assertAXName(
          page,
          'heading',
          'Keep authored emphasis and natural line breaks intact'
        );
        await start(page, ids);
        for (const id of ids) await split(page, id);
        await page.evaluate(() => {
          fixture.tweens.forEach((t) => t.progress(1, true));
        });
        const geometry = await page.evaluate(
          (ids) =>
            (fixture.geometry = ids.map((id) => {
              const el = document.getElementById(id);
              const before = fixture.native.get(id);
              return {
                id,
                before: before.lines,
                after: fixture.paintedLines(el),
                heightBefore: before.height,
                heightAfter: el.getBoundingClientRect().height,
              };
            })),
          ids
        );
        for (const item of geometry) {
          assert.deepEqual(
            // Kugiri's spacer boxes can paint a gap while their whitespace Range has zero width.
            item.after.map((row) => row.text.replace(/\s+/g, '')),
            item.before.map((row) => row.text.replace(/\s+/g, '')),
            `${item.id} painted line breaks`
          );
          assert.ok(Math.abs(item.heightBefore - item.heightAfter) <= 2, `${item.id} height drift`);
          item.before.forEach((row, index) => {
            const after = item.after[index];
            assert.equal(after.glyphs.length, row.glyphs.length, `${item.id} glyph count`);
            row.glyphs.forEach((glyph, glyphIndex) => {
              const actual = after.glyphs[glyphIndex];
              assert.equal(actual.char, glyph.char, `${item.id} glyph order`);
              for (const edge of ['top', 'left', 'right'])
                assert.ok(
                  Math.abs(glyph[edge] - actual[edge]) <= 2,
                  `${item.id} glyph ${glyphIndex} ${edge} drift: ${glyph[edge]} vs ${actual[edge]}`
                );
            });
            for (const edge of ['top', 'left', 'right'])
              assert.ok(
                Math.abs(row[edge] - item.after[index][edge]) <= 2,
                `${item.id} ${edge} drift: ${row[edge]} vs ${item.after[index][edge]}`
              );
          });
        }
        await assertAXName(
          page,
          'heading',
          'Keep authored emphasis and natural line breaks intact'
        );
        assert.equal(await page.locator('#linked-paragraph a[aria-hidden="true"]').count(), 0);
        assert.match(await page.locator('#linked-paragraph').ariaSnapshot(), /link/);
        assert.equal(await page.locator('#pretty').getAttribute('aria-label'), null);
        assert.equal(await page.locator('#pretty [aria-hidden="true"]').count(), 0);
        assert.match(
          await page.locator('#balance').ariaSnapshot(),
          /heading "St Catherine’s School inspires girls to shape their future"/
        );
        await page.evaluate(() => {
          fixture.tweens.forEach((t) => t.progress(0.35));
        });
        await capture(page, `geometry-${width}`, 'split');
        await complete(page);
        await restored(page, ids);
        await assertAXName(
          page,
          'heading',
          'Keep authored emphasis and natural line breaks intact'
        );
        await capture(page, `geometry-${width}`, 'complete');
        await noReplay(page);
      },
      { viewport: { width, height: 2600 } }
    );
  }

  await scenario(
    'rich list/quote leaves, media and controls, inherited and element optouts',
    async (page) => {
      await open(page);
      const ids = [
        'quote-container',
        'quote-leaf',
        'list-container',
        'list-leaf',
        'list-direct',
        'media',
        'table',
        'table-text',
        'focusable',
        'nested-link',
        'editable',
        'button-role',
        'button-eyebrow',
        'inherited-off',
        'element-off',
        'legacy-off',
        'nonsemantic',
      ];
      await start(page, ids);
      for (const id of ['quote-leaf', 'list-leaf', 'list-direct']) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded();
        await split(page, id);
      }
      assert.equal(await page.evaluate(() => fixture.tweens.length), 3);
      assert.equal(
        await page.locator('#quote-container > [data-line],#list-container > [data-line]').count(),
        0
      );
      for (const id of ids.filter(
        (id) =>
          !['quote-container', 'quote-leaf', 'list-container', 'list-leaf', 'list-direct'].includes(
            id
          )
      ))
        assert.equal(await page.locator(`#${id} [data-line]`).count(), 0);
      await complete(page);
      await restored(page, ids);
    }
  );

  await scenario(
    'whole-element safeguards preserve IDs, names, tabindex, heading links and listener identity',
    async (page) => {
      await open(page);
      await page.evaluate(() => {
        fixture.clicks = 0;
        fixture.child = document.querySelector('#identity-strong');
        fixture.child.addEventListener('click', () => fixture.clicks++);
        fixture.em = document.querySelector('#rich em');
        fixture.em.addEventListener('click', () => fixture.clicks++);
      });
      await start(page, ['link', 'identity-paragraph', 'rich', 'authored']);
      for (const id of ['link', 'identity-paragraph', 'rich', 'authored']) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded();
        await page.waitForFunction(
          (id) =>
            fixture.tweens.some((t) =>
              t
                .targets()
                .some(
                  (el) =>
                    el === document.getElementById(id) || document.getElementById(id).contains(el)
                )
            ),
          id
        );
      }
      assert.equal(
        await page.locator('#link [data-line],#identity-paragraph [data-line]').count(),
        0
      );
      assert.equal(await page.locator('#identity-strong').count(), 1);
      assert.match(await page.locator('#link').ariaSnapshot(), /link "school link"/);
      assert.match(
        await page.locator('#authored').ariaSnapshot(),
        /heading "The authored accessible name"/
      );
      await page.evaluate(() => {
        fixture.child.focus();
      });
      await complete(page);
      await restored(page, ['link', 'identity-paragraph', 'rich', 'authored']);
      assert.equal(await page.evaluate(() => document.activeElement === fixture.child), true);
      assert.equal(
        await page.evaluate(() => {
          fixture.child.click();
          fixture.em.click();
          return (
            fixture.clicks === 2 &&
            fixture.child === document.querySelector('#identity-strong') &&
            fixture.em === document.querySelector('#rich em')
          );
        }),
        true
      );
    }
  );

  await scenario(
    'manual paused menu label keeps link AX name, plays, replays and composes in a timeline without triggers',
    async (page) => {
      await open(page);
      await start(page, ['menu-label', 'manual']);
      const before = await page.locator('#menu-anchor').ariaSnapshot();
      await assertAXName(page, 'link', 'Discover our school');
      await page.evaluate(async () => {
        fixture.handle = await stCathsTextReveal.create(document.querySelector('#menu-label'), {
          preset: 'menu',
          paused: true,
        });
      });
      assert.equal(await page.evaluate(() => ScrollTrigger.getAll().length), 0);
      assert.equal(await page.evaluate(() => fixture.handle.animation.paused()), true);
      await assertAXName(page, 'link', 'Discover our school');
      await capture(page, 'manual-menu', 'split');
      await page.evaluate(() => {
        fixture.handle.play();
        fixture.handle.animation.pause().progress(1);
      });
      await restored(page, ['menu-label', 'manual']);
      await page.evaluate(async () => {
        fixture.handle = await stCathsTextReveal.create(document.querySelector('#menu-label'), {
          preset: 'menu',
        });
        fixture.timeline = gsap.timeline({ paused: true });
        fixture.timeline.add(fixture.handle.animation, 0);
        fixture.handle.animation.paused(false);
        fixture.timeline.progress(0.4);
      });
      assert.ok(await page.evaluate(() => fixture.handle.animation.progress() > 0));
      assert.equal(await page.evaluate(() => ScrollTrigger.getAll().length), 0);
      await page.evaluate(() => {
        fixture.timeline.progress(1);
        fixture.timeline.kill();
      });
      await restored(page, ['menu-label', 'manual']);
      assert.equal(await page.locator('#menu-anchor').ariaSnapshot(), before);
    }
  );

  await scenario(
    'main tabindex=-1 permits automatic text and preserves control exclusions',
    async (page) => {
      await open(page);
      await start(page, ['pretty', 'plain', 'nested-link', 'focusable', 'editable', 'button-role']);
      await split(page, 'pretty');
      await page.locator('#plain').scrollIntoViewIfNeeded();
      await split(page, 'plain');
      assert.equal(await page.locator('main').getAttribute('tabindex'), '-1');
      assert.equal(
        await page
          .locator(
            '#nested-link [data-line],#focusable [data-line],#editable [data-line],#button-role [data-line]'
          )
          .count(),
        0
      );
      assert.equal(await page.evaluate(() => fixture.tweens.length), 2);
      await complete(page);
      await restored(page, [
        'pretty',
        'plain',
        'nested-link',
        'focusable',
        'editable',
        'button-role',
      ]);
    }
  );

  await scenario(
    'keyboard focus restores original paragraph link and native activation',
    async (page) => {
      await open(page);
      await page.evaluate(() => {
        const paragraph = document.querySelector('#linked-paragraph');
        document.querySelector('header').prepend(paragraph);
        fixture.originalLink = paragraph.querySelector('a');
        fixture.clicks = 0;
        fixture.originalLink.addEventListener('click', () => fixture.clicks++);
      });
      await start(page, ['linked-paragraph']);
      await split(page, 'linked-paragraph');
      await page.evaluate(() => {
        fixture.tweens.forEach((t) => t.progress(0.35));
        fixture.splitLinks = [...document.querySelectorAll('#linked-paragraph a')];
      });
      const linkName =
        'our school and its extraordinary learning community with many opportunities';
      assert.ok(
        (await page.locator('#linked-paragraph a').count()) > 1,
        'fixture link wraps into cloned fragments'
      );
      assert.equal(await page.locator('#linked-paragraph a[aria-hidden="true"]').count(), 0);
      // The paragraph is first in document order, so Tab reaches its first link fragment.
      await page.keyboard.press('Tab');
      await restored(page, ['linked-paragraph']);
      assert.equal(
        await page.evaluate(() => document.activeElement === fixture.originalLink),
        true
      );
      assert.equal(
        await page.locator('#linked-paragraph a').evaluate((el) => getComputedStyle(el).opacity),
        '1'
      );
      await assertAXName(page, 'link', linkName);
      await capture(page, 'focused-paragraph-link', 'complete');
      await complete(page);
      assert.equal(
        await page.evaluate(() => document.activeElement === fixture.originalLink),
        true,
        'later tween completion cannot remove restored focus'
      );
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => location.hash === '#plain');
      assert.equal(
        await page.evaluate(() => fixture.clicks),
        1,
        'original direct listener and native navigation both survive'
      );
      assert.equal(
        await page.locator('[data-text-reveal-link]').count(),
        0,
        'no correlation attributes leak'
      );
    },
    { viewport: { width: 360, height: 1200 } }
  );

  await scenario(
    'pointer activation keeps the live split link default action',
    async (page) => {
      await open(page);
      await page.evaluate(() => {
        document.querySelector('header').prepend(document.querySelector('#linked-paragraph'));
      });
      await start(page, ['linked-paragraph']);
      await split(page, 'linked-paragraph');
      await page.evaluate(() => {
        fixture.tweens.forEach((t) => t.progress(0.8));
      });
      await page.locator('#linked-paragraph a').first().click();
      await page.waitForFunction(() => location.hash === '#plain');
      await complete(page);
      await restored(page, ['linked-paragraph']);
    },
    { viewport: { width: 360, height: 1200 } }
  );

  await scenario('inline manual menu label restores on wrapping container resize', async (page) => {
    await open(page);
    await start(page, ['menu-label']);
    await page.evaluate(async () => {
      fixture.handle = await stCathsTextReveal.create(document.querySelector('#menu-label'), {
        preset: 'menu',
      });
    });
    await split(page, 'menu-label');
    await page.locator('nav').evaluate((el) => {
      el.style.width = '240px';
    });
    await restored(page, ['menu-label']);
  });

  await scenario(
    'manual create overrides registered auto and active auto animation',
    async (page) => {
      await open(page);
      await start(page, ['balance', 'offscreen']);
      await split(page, 'balance');
      assert.equal(await page.evaluate(() => ScrollTrigger.getAll().length), 1);
      await page.evaluate(async () => {
        fixture.firstAuto = fixture.tweens[0];
        fixture.active = await stCathsTextReveal.create(document.querySelector('#balance'));
        fixture.pending = await stCathsTextReveal.create(document.querySelector('#offscreen'));
      });
      assert.equal(await page.evaluate(() => ScrollTrigger.getAll().length), 0);
      assert.equal(await page.evaluate(() => fixture.firstAuto.parent), null);
      await page.evaluate(() => {
        fixture.active.revert();
        fixture.pending.revert();
      });
      await restored(page, ['balance', 'offscreen']);
      await noReplay(page);
    }
  );

  for (const kind of [
    'viewport',
    'container',
    'reduced',
    'late fonts',
    'disposal',
    'interruption',
    'pagehide',
  ]) {
    await scenario(`${kind} cancels prepared paused state`, async (page) => {
      await open(page);
      await start(page, ['balance']);
      await split(page, 'balance');
      await page.evaluate(async () => {
        fixture.handle = await stCathsTextReveal.create(document.querySelector('#balance'));
      });
      if (kind === 'viewport') await page.setViewportSize({ width: 600, height: 1200 });
      if (kind === 'container')
        await page.locator('header.column').evaluate((el) => {
          el.style.width = '370px';
        });
      if (kind === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
      if (kind === 'late fonts')
        await page.evaluate(() => {
          document.fonts.dispatchEvent(new Event('loadingdone'));
        });
      if (kind === 'disposal')
        await page.evaluate(() => {
          stCathsTextReveal.dispose();
        });
      if (kind === 'interruption')
        await page.evaluate(() => {
          fixture.handle.play();
          fixture.handle.animation.progress(0.3).kill();
        });
      if (kind === 'pagehide')
        await page.evaluate(() => {
          dispatchEvent(new Event('pagehide'));
        });
      await restored(page, ['balance']);
      await noReplay(page);
    });
  }

  await scenario(
    'initial reduced motion skips and duplicate initialization does not replay',
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

  for (const id of ['hidden', 'visibility', 'zero']) {
    await scenario(`${id} automatic activation and manual hidden timing`, async (page) => {
      await open(page);
      await start(page, [id]);
      await page.waitForTimeout(100);
      assert.equal(await page.locator(`#${id} [data-line]`).count(), 0);
      if (id === 'hidden') {
        assert.equal(
          await page.evaluate(
            async () => (await stCathsTextReveal.create(document.querySelector('#hidden'))) === null
          ),
          true
        );
      }
      await page.evaluate((id) => {
        const parent = document.getElementById(`${id}-parent`);
        if (id === 'hidden') parent.style.display = 'block';
        if (id === 'visibility') parent.style.visibility = 'visible';
        if (id === 'zero') parent.style.width = '500px';
      }, id);
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      if (id === 'hidden')
        await page.evaluate(async () => {
          fixture.handle = await stCathsTextReveal.create(document.querySelector('#hidden'));
        });
      await split(page, id);
      await complete(page);
      // Parent style changes are outside the saved child.
      await restored(page, [id]);
      await noReplay(page);
    });
  }

  await scenario(
    'page optout blocks automatic and manual; scoped init discovers newly inserted content',
    async (page) => {
      await open(page);
      await page.evaluate(() => {
        document.body.setAttribute('data-text-reveal', 'off');
      });
      await start(page, ['balance']);
      assert.equal(
        await page.evaluate(
          async () => (await stCathsTextReveal.create(document.querySelector('#balance'))) === null
        ),
        true
      );
      await restored(page, ['balance']);
      await page.evaluate(() => {
        document.body.removeAttribute('data-text-reveal');
        const el = document.createElement('h2');
        el.id = 'dynamic';
        el.textContent = 'A newly inserted heading';
        document.querySelector('header').prepend(el);
        fixture.remember(['dynamic']);
        stCathsTextReveal.init(el);
        stCathsTextReveal.init(el);
      });
      await split(page, 'dynamic');
      assert.equal(await page.evaluate(() => fixture.tweens.length), 1);
      await complete(page);
      await restored(page, ['dynamic']);
    }
  );

  for (const failure of ['gsap', 'ScrollTrigger', 'split', 'tween', 'observer', 'trigger']) {
    await scenario(`${failure} fallback leaves natural text`, async (page) => {
      await open(page);
      const expectedErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') expectedErrors.push(message.text());
      });
      await page.evaluate((failure) => {
        if (failure === 'gsap') window.gsap = undefined;
        if (failure === 'ScrollTrigger') window.ScrollTrigger = undefined;
        if (failure === 'observer') window.ResizeObserver = undefined;
        if (failure === 'split')
          Range.prototype.getClientRects = () => {
            throw new Error('Forced layout measurement failure');
          };
        if (failure === 'tween')
          window.gsap.fromTo = () => {
            throw new Error('Forced tween failure');
          };
        if (failure === 'trigger')
          window.ScrollTrigger.create = () => {
            throw new Error('Forced trigger failure');
          };
      }, failure);
      await start(page, ['balance']);
      await page.waitForTimeout(150);
      await restored(page, ['balance']);
      if (['split', 'tween', 'trigger'].includes(failure))
        assert.ok(expectedErrors.some((text) => text.includes('Text reveal skipped:')));
      if (failure === 'ScrollTrigger') {
        await page.evaluate(async () => {
          fixture.handle = await stCathsTextReveal.create(document.querySelector('#balance'));
        });
        await split(page, 'balance');
        await page.evaluate(() => {
          fixture.handle.revert();
        });
        await restored(page, ['balance']);
      }
    });
  }

  for (const style of [null, '', 'color: rgb(24, 40, 60); --lines: 77']) {
    await scenario(
      `lazy CSSOM restores exact paragraph style ${JSON.stringify(style)}`,
      async (page) => {
        await open(page);
        await page.locator('#pretty').evaluate((el, style) => {
          if (style !== null) el.setAttribute('style', style);
        }, style);
        await start(page, ['pretty']);
        await split(page, 'pretty');
        // Do not inspect any host attributes between split and restoration.
        await complete(page);
        await restored(page, ['pretty']);
      }
    );
  }

  await scenario('real-time completion with production GSAP and ScrollTrigger', async (page) => {
    await open(page, '?live');
    await start(page, ['balance', 'pretty']);
    await split(page, 'balance');
    await split(page, 'pretty');
    await restored(page, ['balance', 'pretty']);
    await noReplay(page);
  });
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
