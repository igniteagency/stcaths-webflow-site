import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('global selector stays shared and lightweight; only the component bundles Kugiri and none bundle GSAP', async () => {
  const globalSource = await readFile(new URL('../src/global.ts', import.meta.url), 'utf8');
  assert.match(
    globalSource,
    /querySelector\(TEXT_REVEAL_SELECTOR \+ ',\[data-menu-motion\],\[data-hero-intro\]'\)/
  );
  const settings = await readFile(
    new URL('../src/utils/text-motion-settings.ts', import.meta.url),
    'utf8'
  );
  assert.match(settings, /h1,h2,h3,h4,h5,h6,p,/);
  assert.match(settings, /text-style-eyebrow/);
  const { metafile } = await build({
    entryPoints: [
      'src/entry.ts',
      'src/global.ts',
      'src/components/text-reveal.ts',
      'src/components/nav-menu.ts',
      'src/components/hero-intro.ts',
    ],
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
