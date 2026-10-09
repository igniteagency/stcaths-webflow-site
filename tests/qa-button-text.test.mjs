import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

test('button QA records a setup failure honestly without launching a browser', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'button-text-qa-'));
  try {
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [fileURLToPath(new URL('../bin/qa-button-text.mjs', import.meta.url))],
        {
          env: {
            ...process.env,
            PLAYWRIGHT_MODULE: join(directory, 'missing.mjs'),
            BUTTON_TEXT_EVIDENCE_DIR: directory,
          },
        }
      )
    );
    const result = JSON.parse(await readFile(join(directory, 'run-result.json'), 'utf8'));
    assert.equal(result.status, 'failed');
    assert.equal(result.passedScenarios, 0);
    assert.match(result.bundleSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(result.scenarios, []);
    assert.deepEqual(result.evidence, []);
    assert.equal(result.browser, undefined);
    assert.match(result.error, /missing.mjs/);
    assert.ok(Date.parse(result.finishedAt) >= Date.parse(result.startedAt));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
