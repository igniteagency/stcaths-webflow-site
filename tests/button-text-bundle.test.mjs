import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('button roll is conditionally loaded separately without animation dependencies', async () => {
  const source = await readFile(new URL('../src/global.ts', import.meta.url), 'utf8');
  assert.match(source, /conditionalLoadScript\('\.button_link', 'components\/button-text\.js'\)/);
  const { metafile } = await build({
    entryPoints: ['src/entry.ts', 'src/global.ts', 'src/components/button-text.ts'],
    bundle: true,
    write: false,
    outdir: 'dist/prod',
    metafile: true,
  });
  for (const [path, output] of Object.entries(metafile.outputs)) {
    const inputs = Object.keys(output.inputs);
    assert.equal(
      inputs.includes('src/components/button-text.ts'),
      path.endsWith('/button-text.js')
    );
    if (path.endsWith('/button-text.js')) assert.equal(inputs.length, 1);
  }
});
