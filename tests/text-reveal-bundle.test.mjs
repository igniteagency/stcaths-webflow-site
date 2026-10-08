import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the opt-in loader keeps Kugiri in the standalone component and never bundles GSAP', async () => {
  const globalSource = await readFile(new URL('../src/global.ts', import.meta.url), 'utf8');
  assert.match(
    globalSource,
    /conditionalLoadScript\('\[data-text-reveal="chars"\]', 'components\/text-reveal\.js'\)/
  );
  const { metafile } = await build({
    entryPoints: ['src/entry.ts', 'src/global.ts', 'src/components/text-reveal.ts'],
    bundle: true,
    write: false,
    outdir: 'dist/prod',
    metafile: true,
  });
  for (const [path, output] of Object.entries(metafile.outputs)) {
    const inputs = Object.keys(output.inputs);
    assert.equal(
      inputs.some((input) => input.includes('node_modules/kugiri/')),
      path.endsWith('/text-reveal.js')
    );
    assert.equal(
      inputs.some((input) => input.includes('node_modules/gsap/')),
      false,
      `${path} must use global GSAP`
    );
  }
});
