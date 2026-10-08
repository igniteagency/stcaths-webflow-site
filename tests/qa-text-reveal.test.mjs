import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

test('returning a paused GSAP tween waits for completion; returning progress does not', async () => {
  const require = createRequire(import.meta.url);
  const { gsap } = require('gsap/dist/gsap.js');
  const targets = Array.from({ length: 50 }, () => ({ opacity: 1 }));
  const tween = gsap
    .fromTo(targets, { opacity: 0 }, { opacity: 1, duration: 0.55, stagger: { amount: 0.45 } })
    .pause();
  try {
    let resolved = false;
    const returned = tween.progress(0.3);
    assert.equal(returned, tween);
    const pending = Promise.resolve(returned).then(() => {
      resolved = true;
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(resolved, false, 'the returned tween is still awaiting completion');
    const progress = await (async () => {
      tween.progress(0.3);
      return tween.progress();
    })();
    assert.equal(progress, 0.3);
    assert.ok(targets.some(({ opacity }) => opacity > 0 && opacity < 1));
    assert.equal(resolved, false);
    tween.progress(1);
    await pending;
    assert.equal(resolved, true);
  } finally {
    tween.kill();
    gsap.ticker.sleep();
  }
});

test('QA saves a failed run result when setup fails, without launching a browser', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'text-reveal-qa-'));
  try {
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [fileURLToPath(new URL('../bin/qa-text-reveal.mjs', import.meta.url))],
        {
          env: {
            ...process.env,
            PLAYWRIGHT_MODULE: join(directory, 'missing-playwright.mjs'),
            TEXT_REVEAL_EVIDENCE_DIR: join(directory, 'evidence'),
          },
        }
      ),
      (error) => error.code === 1 && error.stderr.includes('missing-playwright.mjs')
    );
    const result = JSON.parse(await readFile(join(directory, 'evidence/run-result.json'), 'utf8'));
    assert.equal(result.status, 'failed');
    assert.equal(result.passedScenarios, 0);
    assert.deepEqual(result.scenarios, []);
    assert.deepEqual(result.evidence, []);
    assert.equal(result.browser, undefined);
    assert.match(result.error, /missing-playwright\.mjs/);
    assert.ok(Date.parse(result.finishedAt) >= Date.parse(result.startedAt));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
