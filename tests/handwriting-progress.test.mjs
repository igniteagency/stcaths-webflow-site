import { build } from 'esbuild';
import assert from 'node:assert/strict';
import test from 'node:test';

const { outputFiles } = await build({
  entryPoints: ['src/utils/handwriting-progress.ts'],
  bundle: true,
  format: 'esm',
  write: false,
});
const { handwritingStep, handwritingTarget } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64')
);

test('scroll destination uses the approved arrival and writing distance', () => {
  assert.equal(handwritingTarget(200, 1000), 0);
  assert.equal(handwritingTarget(-32, 1000), 0);
  assert.equal(handwritingTarget(-632, 1000), 0.5);
  assert.equal(handwritingTarget(-2000, 1000), 1);
});

test('a fling or delayed frame cannot reveal the note in one update', () => {
  for (const elapsed of [1 / 60, 1 / 30, 0.5, 3, 60]) {
    assert(handwritingStep(0, 1, elapsed) <= 0.0141);
    assert(handwritingStep(1, 0, elapsed) >= 0.9859);
  }
});

test('pen continues after scrolling stops and tapers to the target without overshoot', () => {
  let progress = 0;
  const steps = [];
  for (let i = 0; i < 400; i++) {
    const next = handwritingStep(progress, 0.5, 1 / 60);
    steps.push(next - progress);
    assert(next >= progress && next <= 0.5);
    progress = next;
  }
  assert.equal(progress, 0.5);
  assert(steps[90] < steps[30]);
});

test('reversing scroll smoothly erases from actual ink progress', () => {
  let progress = 0.8;
  for (let i = 0; i < 500; i++) {
    const next = handwritingStep(progress, 0, 1 / 60);
    assert(next <= progress && progress - next <= 0.0071 && next >= 0);
    progress = next;
  }
  assert.equal(progress, 0);
});
