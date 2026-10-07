import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const entrySource = await readFile(new URL('../src/entry.ts', import.meta.url), 'utf8');

test('Starter production loads its default main-branch CDN bundle', () => {
  assert.doesNotMatch(entrySource, /\{\{repo\}\}/);
  assert.doesNotMatch(entrySource, /getProductionBase\(['"]dev['"]\)/);
  assert.match(
    entrySource,
    /https:\/\/cdn\.jsdelivr\.net\/gh\/igniteagency\/stcaths-webflow-site\/dist\/prod\//
  );
  assert.match(entrySource, /window\.PRODUCTION_BASE = getProductionBase\(\);/);
});
