import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const { outputFiles } = await build({
  entryPoints: ['src/components/text-reveal.ts'],
  bundle: true,
  format: 'iife',
  write: false,
  plugins: [
    {
      name: 'controlled-split',
      setup(builder) {
        builder.onResolve({ filter: /^kugiri$/ }, () => ({ path: 'kugiri', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: 'export const splitText = (...args) => globalThis.splitMock(...args);',
        }));
      },
    },
  ],
});
const source = outputFiles[0].text;

function harness({
  reduced = false,
  missingGSAP = false,
  splitError = false,
  tweenError = false,
  emptySplit = false,
  initializationInterrupt = false,
} = {}) {
  const listeners = new Map();
  const motionListeners = new Set();
  const observers = [];
  const tweens = [];
  const errors = [];
  let reverts = 0;
  let releaseFonts;
  const fonts = {
    ready: new Promise((resolve) => {
      releaseFonts = resolve;
    }),
  };
  const textNode = { nodeType: 3, textContent: 'St Catherine’s School' };
  class Element {
    constructor(tagName = 'H2', nodes = [textNode]) {
      this.tagName = tagName;
      this.childNodes = nodes;
      this.attrs = new Map([['data-text-reveal', 'chars']]);
      this.isConnected = true;
      this.clientWidth = 400;
      this.clientHeight = 60;
      this.parentElement = null;
      this.visible = true;
      this.pendingStyle = null;
      const element = this;
      this.style = {
        set cssText(value) {
          // Blink defers reflecting CSSOM writes into the attribute collection.
          element.pendingStyle = value;
        },
      };
    }
    get textContent() {
      return this.childNodes.map((node) => node.textContent).join('');
    }
    set textContent(value) {
      this.childNodes = [{ nodeType: 3, textContent: value }];
    }
    get attributes() {
      return [...this.attrs].map(([name, value]) => ({ name, value }));
    }
    get children() {
      return this.childNodes.filter((node) => node.nodeType === 1);
    }
    getAttribute(name) {
      if (name === 'style' && this.pendingStyle !== null) {
        this.attrs.set(name, this.pendingStyle);
        this.pendingStyle = null;
      }
      return this.attrs.get(name) ?? null;
    }
    hasAttribute(name) {
      return this.getAttribute(name) !== null;
    }
    setAttribute(name, value) {
      if (name === 'style') this.pendingStyle = null;
      this.attrs.set(name, String(value));
    }
    removeAttribute(name) {
      if (name === 'style') {
        // Blink's absent-attribute path clears inline declarations but leaves them dirty.
        if (!this.attrs.has(name) && this.pendingStyle !== null) {
          this.pendingStyle = '';
          return;
        }
        this.pendingStyle = null;
      }
      this.attrs.delete(name);
    }
    matches(selector) {
      if (selector.includes('data-text-reveal'))
        return this.attrs.get('data-text-reveal') === 'chars';
      return selector.split(',').includes(this.tagName.toLowerCase());
    }
    closest() {
      return this.unsafe ? this : null;
    }
    checkVisibility() {
      return this.visible;
    }
    getClientRects() {
      return this.visible ? [this.getBoundingClientRect()] : [];
    }
    getBoundingClientRect() {
      return { width: this.clientWidth, height: this.clientHeight };
    }
    replaceChildren(...nodes) {
      this.childNodes = nodes;
    }
    appendChild(node) {
      this.childNodes.push(node);
    }
    querySelectorAll() {
      return [];
    }
  }
  const element = new Element();
  const targets = [element];
  const media = {
    matches: reduced,
    addEventListener: (_, fn) => motionListeners.add(fn),
    removeEventListener: (_, fn) => motionListeners.delete(fn),
  };
  function observerClass(type) {
    return class {
      constructor(callback) {
        this.type = type;
        this.callback = callback;
        this.targets = new Set();
        observers.push(this);
      }
      observe(target) {
        this.targets.add(target);
      }
      unobserve(target) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    };
  }
  const context = vm.createContext({
    console: { error: (...args) => errors.push(args) },
    queueMicrotask,
    HTMLElement: Element,
    Element,
    Node: { TEXT_NODE: 3 },
    document: {
      fonts,
      querySelectorAll: () => targets,
      createElement: (tag) => new Element(tag.toUpperCase(), []),
    },
    matchMedia: () => media,
    getComputedStyle: (target) => ({
      visibility: target.visible ? 'visible' : 'hidden',
      opacity: '1',
      display: 'block',
    }),
    IntersectionObserver: observerClass('intersection'),
    ResizeObserver: observerClass('resize'),
    MutationObserver: observerClass('mutation'),
    addEventListener: (name, fn) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
    splitMock(target) {
      const original = [...target.childNodes];
      original[0].textContent = 'partially consumed text node';
      target.setAttribute('data-split', 'chars');
      target.style.cssText = '--chars: 3';
      const line = new Element('SPAN', [{ nodeType: 3, textContent: 'split' }]);
      line.nodeType = 1;
      target.replaceChildren(line);
      if (splitError) throw new Error('partial split failure');
      return {
        chars: emptySplit ? [] : [line],
        lines: [line],
        revert: () => {
          reverts++;
          target.replaceChildren(...original);
          target.style.cssText = '';
        },
      };
    },
    gsap: missingGSAP
      ? undefined
      : {
          fromTo(targets, from, to) {
            if (tweenError) throw new Error('GSAP failure');
            if (initializationInterrupt) to.onInterrupt?.call({ data: 'isStart' });
            const tween = {
              targets,
              from,
              to,
              killed: false,
              kill() {
                this.killed = true;
                to.onInterrupt?.call(this);
              },
            };
            tweens.push(tween);
            return tween;
          },
        },
  });
  context.window = context;
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  return {
    element,
    targets,
    Element,
    textNode,
    tweens,
    errors,
    observers,
    media,
    motionListeners,
    listeners,
    get reverts() {
      return reverts;
    },
    context,
    flush,
    run: () => vm.runInContext(source, context),
    init: () => context.stCathsTextReveal.init(),
    async fontsReady() {
      releaseFonts();
      await flush();
    },
    async intersect(target = element, isIntersecting = true) {
      observers
        .filter((o) => o.type === 'intersection' && o.targets.has(target))
        .forEach((o) =>
          o.callback([{ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }])
        );
      await flush();
    },
    async resize() {
      observers
        .filter((o) => o.type === 'resize' && o.targets.size)
        .forEach((o) =>
          o.callback([{ target: element, contentRect: element.getBoundingClientRect() }])
        );
      await flush();
    },
    async mutate() {
      observers
        .filter((o) => o.type === 'mutation' && o.targets.size)
        .forEach((o) => o.callback([]));
      await flush();
    },
    motion(value) {
      media.matches = value;
      [...motionListeners].forEach((fn) => fn(media));
    },
    event(name) {
      [...(listeners.get(name) ?? [])].forEach((fn) => fn());
    },
    assertClean() {
      assert.equal(
        observers.every((o) => o.targets.size === 0),
        true,
        'all observers disconnected'
      );
      assert.equal(motionListeners.size, 0, 'motion listeners removed');
      assert.equal(
        [...listeners.values()].every((set) => set.size === 0),
        true,
        'window listeners removed'
      );
    },
  };
}

test('waits for fonts and intersection, survives duplicate execution, then restores native text once', async () => {
  const h = harness();
  const original = h.element.childNodes[0];
  h.run();
  h.run();
  h.init();
  await h.intersect();
  assert.equal(h.tweens.length, 0);
  assert.equal(h.element.childNodes[0], original);
  assert.equal(h.element.textContent, 'St Catherine’s School');
  await h.fontsReady();
  assert.equal(h.tweens.length, 1);
  assert.equal(h.element.getAttribute('aria-label'), 'St Catherine’s School');
  assert.equal(h.tweens[0].targets[0].getAttribute('aria-hidden'), 'true');
  h.run();
  h.tweens[0].to.onComplete();
  assert.equal(h.element.childNodes[0], original);
  assert.deepEqual([...h.element.attrs], [['data-text-reveal', 'chars']]);
  h.run();
  await h.intersect();
  assert.equal(h.tweens.length, 1);
  h.assertClean();
});

test('ignores an internal interrupt before fromTo returns and after the main tween is assigned', async () => {
  const h = harness({ initializationInterrupt: true });
  h.run();
  await h.fontsReady();
  await h.intersect();
  const tween = h.tweens[0];
  tween.to.onInterrupt?.call({ data: 'isStart' });
  await h.flush();
  assert.equal(h.reverts, 0);
  assert.equal(tween.killed, false);
  assert.notEqual(h.element.childNodes[0], h.textNode);
  assert.equal(h.element.getAttribute('aria-label'), 'St Catherine’s School');
  assert.equal(h.listeners.get('resize').size, 1);
  tween.to.onComplete();
  assert.equal(h.reverts, 1);
  assert.equal(h.element.childNodes[0], h.textNode);
  h.assertClean();
});

test('a parent interruption restores text only after the GSAP callback returns', async () => {
  const h = harness();
  h.run();
  await h.fontsReady();
  await h.intersect();
  h.tweens[0].kill();
  assert.equal(h.reverts, 0, 'cleanup must not run inside kill/render');
  await h.flush();
  assert.equal(h.reverts, 1);
  assert.equal(h.element.childNodes[0], h.textNode);
  h.assertClean();
});

for (const end of ['completion', 'viewport resize', 'interruption']) {
  test(`installed GSAP renders partial stagger progress before ${end}`, async () => {
    const engine = vm.createContext({
      exports: {},
      module: {},
      // Drive the actual GSAP renderer explicitly, without a background ticker.
      setTimeout: () => 0,
      clearTimeout() {},
    });
    const require = createRequire(import.meta.url);
    vm.runInContext(await readFile(require.resolve('gsap/dist/gsap.js'), 'utf8'), engine);
    const { gsap } = engine.exports;
    const h = harness();
    // Plain properties exercise GSAP's real stagger/startAt lifecycle; browser QA covers CSS.
    const targets = Array.from({ length: 50 }, () => ({ opacity: 1, y: 0 }));
    h.context.gsap.fromTo = (_, from, to) => {
      engine.tween = gsap.fromTo(targets, from, to).pause();
      return engine.tween;
    };
    try {
      h.run();
      await h.fontsReady();
      await h.intersect();
      assert.deepEqual(h.errors, []);
      for (const progress of [0.3, 0.35, 0.6]) {
        vm.runInContext(`tween.progress(${progress})`, engine, { timeout: 1000 });
        await h.flush();
        assert.equal(engine.tween.progress(), progress);
        assert.equal(h.reverts, 0);
        assert.notEqual(h.element.childNodes[0], h.textNode);
        assert.ok(targets.some(({ opacity }) => opacity > 0 && opacity < 1));
        assert.ok(targets[0].opacity > targets.at(-1).opacity, 'stagger advances in order');
        assert.ok(targets.some(({ y }) => parseFloat(y) > 0 && parseFloat(y) < 0.35));
      }
      if (end === 'completion') {
        vm.runInContext('tween.progress(1)', engine, { timeout: 1000 });
        assert.ok(targets.every(({ opacity, y }) => opacity === 1 && parseFloat(y) === 0));
      } else if (end === 'viewport resize') h.event('resize');
      else {
        vm.runInContext('tween.kill()', engine, { timeout: 1000 });
        assert.equal(h.reverts, 0, 'real GSAP interrupt cleanup is deferred');
      }
      await h.flush();
      assert.equal(h.reverts, 1);
      assert.equal(h.element.childNodes[0], h.textNode);
      assert.equal(h.element.getAttribute('style'), null);
      h.assertClean();
      h.run();
      await h.intersect();
      assert.equal(h.reverts, 1);
    } finally {
      gsap.globalTimeline.clear();
      gsap.ticker.sleep();
    }
  });
}

test('releases Kugiri and restores every authored attribute and original text node', async () => {
  const h = harness();
  for (const [name, value] of Object.entries({
    'aria-label': 'School name',
    'aria-labelledby': 'other-title',
    'aria-hidden': 'false',
    role: 'heading',
    'data-split': 'authored',
    'data-author': 'keep',
    style: 'color: red; --chars: 17; --lines: 2; text-decoration: underline',
  }))
    h.element.setAttribute(name, value);
  const attributes = [...h.element.attrs];
  h.run();
  await h.fontsReady();
  await h.intersect();
  assert.equal(h.element.getAttribute('aria-label'), 'School name');
  assert.equal(h.element.getAttribute('aria-labelledby'), 'other-title');
  h.tweens[0].to.onComplete();
  assert.equal(h.reverts, 1);
  assert.deepEqual([...h.element.attrs], attributes);
  assert.equal(h.element.childNodes[0], h.textNode);
  h.assertClean();
});

test('paragraph retains a single native accessible text alternative', async () => {
  const h = harness();
  h.element.tagName = 'P';
  h.run();
  await h.fontsReady();
  await h.intersect();
  assert.equal(h.element.getAttribute('aria-label'), null);
  assert.equal(h.element.childNodes[1].textContent, 'St Catherine’s School');
  assert.equal(h.element.childNodes[1].getAttribute('aria-hidden'), null);
  h.tweens[0].to.onComplete();
  assert.equal(h.element.childNodes.length, 1);
  h.assertClean();
});

for (const style of [null, '', 'color: blue; --chars: 17']) {
  test(`paragraph restores exact style after unmaterialized CSSOM cleanup: ${JSON.stringify(style)}`, async () => {
    const h = harness();
    h.element.tagName = 'P';
    if (style !== null) h.element.setAttribute('style', style);
    h.run();
    await h.fontsReady();
    await h.intersect();
    // Do not read style while split: that would materialize it and mask the bug.
    h.tweens[0].to.onComplete();
    assert.equal(h.element.getAttribute('style'), style);
    assert.equal(h.element.childNodes[0], h.textNode);
    assert.equal(h.reverts, 1);
    h.assertClean();
  });
}

test('hidden and zero-width text stays native until it becomes measurable', async () => {
  const h = harness();
  h.element.visible = false;
  h.run();
  await h.fontsReady();
  await h.intersect();
  assert.equal(h.tweens.length, 0);
  h.element.visible = true;
  h.element.clientWidth = 0;
  await h.mutate();
  assert.equal(h.tweens.length, 0);
  h.element.clientWidth = 400;
  await h.resize();
  assert.equal(h.tweens.length, 1);
  h.tweens[0].to.onComplete();
  h.assertClean();
});

test('offscreen text remains native after fonts load', async () => {
  const h = harness();
  h.run();
  await h.fontsReady();
  await h.resize();
  assert.equal(h.tweens.length, 0);
  await h.intersect();
  assert.equal(h.tweens.length, 1);
});

for (const cancel of [
  'container resize',
  'viewport resize',
  'reduced motion',
  'interruption',
  'pagehide',
]) {
  test(`${cancel} restores active text and never replays`, async () => {
    const h = harness();
    h.run();
    await h.fontsReady();
    await h.intersect();
    await h.resize();
    assert.equal(h.tweens[0].killed, false, 'initial ResizeObserver delivery is harmless');
    if (cancel === 'container resize') {
      h.element.clientWidth = 200;
      await h.resize();
    }
    if (cancel === 'viewport resize') h.event('resize');
    if (cancel === 'reduced motion') h.motion(true);
    if (cancel === 'interruption') {
      h.tweens[0].kill();
      await h.flush();
    }
    if (cancel === 'pagehide') h.event('pagehide');
    assert.equal(h.tweens[0].killed, true);
    assert.equal(h.element.childNodes[0], h.textNode);
    assert.equal(h.element.getAttribute('style'), null);
    h.motion(false);
    h.run();
    await h.intersect();
    assert.equal(h.tweens.length, 1);
    h.assertClean();
  });
}

for (const options of [{ reduced: true }, { missingGSAP: true }]) {
  test(`natural text and no watchers for ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    h.run();
    await h.fontsReady();
    await h.intersect();
    assert.equal(h.tweens.length, 0);
    assert.equal(h.element.childNodes[0], h.textNode);
    h.assertClean();
  });
}

test('motion change while fonts are pending cancels preparation permanently', async () => {
  const h = harness();
  h.run();
  await h.intersect();
  h.motion(true);
  await h.fontsReady();
  h.motion(false);
  h.run();
  assert.equal(h.tweens.length, 0);
  h.assertClean();
});

for (const options of [{ splitError: true }, { tweenError: true }, { emptySplit: true }]) {
  test(`failure restores native markup: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    h.element.setAttribute('style', 'color: blue');
    const attributes = [...h.element.attrs];
    h.run();
    await h.fontsReady();
    await h.intersect();
    assert.equal(h.element.childNodes[0], h.textNode);
    assert.deepEqual([...h.element.attrs], attributes);
    assert.equal(h.errors.length, options.emptySplit ? 0 : 1);
    h.assertClean();
  });
}

test('refuses rich markup, accessible descendants, nonsemantic and interactive targets', () => {
  const h = harness();
  for (const tag of ['SPAN', 'A', 'BUTTON']) h.targets.push(new h.Element(tag));
  for (const tag of ['A', 'SPAN', 'IMG']) {
    h.targets.push(
      new h.Element('H2', [{ nodeType: 1, tagName: tag, textContent: 'Accessible child' }])
    );
  }
  h.element.unsafe = true;
  h.run();
  assert.equal(h.observers.length, 0);
});

test('skips semantic tags with an authored non-text role', () => {
  const h = harness();
  h.element.setAttribute('role', 'button');
  h.run();
  assert.equal(h.observers.length, 0);
});

test('missing observer support leaves native text without watching', () => {
  const h = harness();
  h.context.IntersectionObserver = undefined;
  h.run();
  assert.equal(h.element.childNodes[0], h.textNode);
  h.assertClean();
});

test('rechecks safety after fonts load, before touching newly inserted child content', async () => {
  const h = harness();
  h.run();
  await h.intersect();
  const child = { nodeType: 1, textContent: 'New link' };
  h.element.replaceChildren(child);
  await h.fontsReady();
  assert.equal(h.tweens.length, 0);
  assert.equal(h.element.childNodes[0], child);
  h.assertClean();
});
