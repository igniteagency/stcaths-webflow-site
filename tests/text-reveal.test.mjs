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

test('global H1 already past the start reveals without opt-in or another scroll', async () => {
  const h = harness();
  h.element.tagName = 'H1';
  h.element.removeAttribute('data-text-reveal');
  h.element.top = 0;
  h.run();
  await h.fontsReady();
  assert.equal(h.tweens.length, 1);
  assert.equal(h.tweens[0].to.duration, 1.5);
  assert.equal(h.tweens[0].to.stagger.each, 0.025);
  h.tweens[0].to.onComplete();
  assert.equal(h.element.childNodes[0], h.textNode);
  h.assertClean();
});

function harness({
  reduced = false,
  missingGSAP = false,
  splitError = false,
  tweenError = false,
  emptySplit = false,
  initializationInterrupt = false,
  mutateOriginalAttributes = false,
  cloneLinks = false,
} = {}) {
  const listeners = new Map();
  const motionListeners = new Set();
  const observers = [];
  const tweens = [];
  const triggers = [];
  const splitOptions = [];
  const fontListeners = new Set();
  const errors = [];
  let reverts = 0;
  let releaseFonts;
  const fonts = {
    addEventListener: (_, fn) => fontListeners.add(fn),
    removeEventListener: (_, fn) => fontListeners.delete(fn),
    ready: new Promise((resolve) => {
      releaseFonts = resolve;
    }),
  };
  function text(value) {
    return {
      nodeType: 3,
      childNodes: [],
      nodeValue: value,
      get textContent() {
        return this.nodeValue;
      },
      set textContent(value) {
        this.nodeValue = value;
      },
    };
  }
  const textNode = text('St Catherine’s School');
  class Element {
    constructor(tagName = 'H2', nodes = [textNode]) {
      this.nodeType = 1;
      this.tagName = tagName;
      this.top = 1500;
      this.childNodes = nodes;
      this.attrs = new Map();
      this.isConnected = true;
      this.clientWidth = 400;
      this.clientHeight = 60;
      this.parentElement = null;
      this.visible = true;
      this.pendingStyle = null;
      this.listeners = new Map();
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
      this.childNodes = [text(value)];
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
      return selector.split(',').some((part) => {
        part = part.trim();
        if (part === ':focus-visible') return !!this.focusVisible;
        const not = part.match(/:not\((.*?)\)/);
        if (not) {
          if (this.matches(not[1])) return false;
          part = part.replace(not[0], '');
        }
        const space = part.lastIndexOf(' ');
        if (space >= 0)
          return (
            this.matches(part.slice(space + 1)) &&
            !!this.parentElement?.closest(part.slice(0, space))
          );
        if (part.startsWith('.'))
          return (this.getAttribute('class') ?? '').split(' ').includes(part.slice(1));
        const attr = part.match(/^\[([^=^\]]+)(\^?=)?"?([^"\]]*)"?\]$/);
        if (attr) {
          const value = this.getAttribute(attr[1]);
          return attr[2] === '^='
            ? value?.startsWith(attr[3])
            : attr[2]
              ? value === attr[3]
              : value !== null;
        }
        return part === '*' || part.toUpperCase() === this.tagName;
      });
    }
    closest(selector) {
      return this.matches(selector) ? this : (this.parentElement?.closest(selector) ?? null);
    }
    contains(target) {
      return this === target || this.children.some((node) => node.contains(target));
    }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(fn);
    }
    removeEventListener(name, fn) {
      this.listeners.get(name)?.delete(fn);
    }
    focus(options) {
      context.document.activeElement = this;
      this.focusVisible ??= true;
      this.focusOptions = options;
      for (let node = this; node; node = node.parentElement) {
        [...(node.listeners.get('focusin') ?? [])].forEach((fn) => fn({ target: this }));
      }
    }
    checkVisibility() {
      return this.visible;
    }
    getClientRects() {
      return this.visible ? [this.getBoundingClientRect()] : [];
    }
    getBoundingClientRect() {
      return {
        width: this.clientWidth,
        height: this.clientHeight,
        top: this.top - context.scrollY,
      };
    }
    replaceChildren(...nodes) {
      if (this.contains(context.document.activeElement)) context.document.activeElement = null;
      this.childNodes = nodes;
      nodes.forEach((node) => {
        node.parentElement = this;
      });
    }
    appendChild(node) {
      this.childNodes.push(node);
      node.parentElement = this;
    }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(child.matches(selector) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
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
    Node: { TEXT_NODE: 3, COMMENT_NODE: 8 },
    innerHeight: 1000,
    scrollY: 0,
    scrollMax: 4000,
    document: {
      fonts,
      activeElement: null,
      querySelectorAll: (selector) => targets.filter((target) => target.matches(selector)),
      contains: () => true,
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
    splitMock(target, options) {
      splitOptions.push(options);
      const original = [...target.childNodes];
      const clones = cloneLinks
        ? target.querySelectorAll('a').map((link) => {
            const clone = new Element('A', [text(link.textContent)]);
            clone.attrs = new Map(link.attrs);
            return clone;
          })
        : [];
      let leaf = original[0];
      while (leaf.childNodes?.length) leaf = leaf.childNodes[0];
      leaf.textContent = 'partially consumed text node';
      if (mutateOriginalAttributes && original[0].nodeType === 1) {
        original[0].setAttribute('data-word', '0');
        original[0].style.cssText = '--word: 0; transform: translateY(28px)';
      }
      target.setAttribute('data-split', 'chars');
      target.style.cssText = '--chars: 3';
      const line = new Element('SPAN', [text('split')]);
      line.nodeType = 1;
      if (clones.length) line.replaceChildren(...clones);
      target.replaceChildren(line);
      if (splitError) throw new Error('partial split failure');
      return {
        chars: emptySplit ? [] : [line],
        lines: emptySplit ? [] : [line],
        words: emptySplit ? [] : [line],
        options,
        revert: () => {
          reverts++;
          target.replaceChildren(...original);
          target.style.cssText = '';
        },
      };
    },
    ScrollTrigger: {
      maxScroll: () => context.scrollMax,
      create(options) {
        const trigger = {
          options,
          killed: false,
          scroll: () => context.scrollY,
          kill() {
            this.killed = true;
          },
          refresh() {
            this.start =
              typeof options.start === 'function'
                ? options.start()
                : options.trigger.getBoundingClientRect().top +
                  context.scrollY -
                  context.innerHeight * 0.92;
            options.onRefresh?.(this);
          },
        };
        triggers.push(trigger);
        trigger.refresh();
        return trigger;
      },
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
              paused: to.paused,
              play() {
                this.paused = false;
              },
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
    triggers,
    splitOptions,
    text,
    fontListeners,
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
    async intersect(target = element) {
      context.scrollY = Math.max(0, target.top);
      triggers
        .filter((trigger) => !trigger.killed && trigger.options.trigger === target)
        .forEach((trigger) => trigger.options.onEnter());
      await flush();
    },
    async scrollTo(value) {
      context.scrollY = value;
      triggers
        .filter((trigger) => !trigger.killed && value > trigger.start)
        .forEach((trigger) => trigger.options.onEnter(trigger));
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
      assert.ok(
        [...element.listeners.values()].every((set) => set.size === 0),
        'target listeners removed'
      );
      assert.equal(fontListeners.size, 0, 'font listeners removed');
      assert.ok(
        triggers.every((trigger) => trigger.killed),
        'triggers killed'
      );
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
  assert.deepEqual([...h.element.attrs], []);
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
        assert.ok(targets.some(({ y }) => parseFloat(y) > 0 && parseFloat(y) < 100));
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

test('paragraph lines retain native accessible text without aria-label or aria-hidden', async () => {
  const h = harness();
  h.element.tagName = 'P';
  h.run();
  await h.fontsReady();
  await h.intersect();
  assert.equal(h.element.getAttribute('aria-label'), null);
  assert.equal(h.tweens[0].targets[0].getAttribute('aria-hidden'), null);
  assert.equal(h.tweens[0].to.stagger.each, 0.1);
  assert.equal(h.tweens[0].from.y, 30);
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
  await h.intersect();
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

test('interactive targets and nonsemantic unmarked targets are skipped', () => {
  const h = harness();
  for (const tag of ['SPAN', 'A', 'BUTTON']) h.targets.push(new h.Element(tag));
  h.element.setAttribute('tabindex', '0');
  h.run();
  assert.equal(h.observers.length, 0);
});

test('skips semantic tags with an authored interactive role', () => {
  const h = harness();
  h.element.setAttribute('role', 'button');
  h.run();
  assert.equal(h.observers.length, 0);
});

test('missing ScrollTrigger leaves native automatic text without watching', () => {
  const h = harness();
  h.context.ScrollTrigger = undefined;
  h.run();
  assert.equal(h.element.childNodes[0], h.textNode);
  h.assertClean();
});

test('rechecks safety after fonts load before touching newly inserted control content', async () => {
  const h = harness();
  h.run();
  await h.intersect();
  const child = new h.Element('BUTTON', [h.text('New button')]);
  h.element.replaceChildren(child);
  await h.fontsReady();
  assert.equal(h.tweens.length, 0);
  assert.equal(h.element.childNodes[0], child);
  h.assertClean();
});

test('initial reduced motion stays readable across duplicate load after preference changes', async () => {
  const h = harness({ reduced: true });
  h.element.top = 0;
  h.run();
  h.motion(false);
  h.run();
  await h.fontsReady();
  assert.equal(h.tweens.length, 0);
  h.assertClean();
});

test('manual create returns paused animation with numeric overrides and no ScrollTrigger', async () => {
  const h = harness();
  h.element.setAttribute('data-text-trigger', 'manual');
  h.run();
  const pending = h.context.stCathsTextReveal.create(h.element, {
    preset: 'menu',
    y: 42,
    duration: 0.8,
    paused: true,
  });
  assert.equal(h.tweens.length, 0);
  await h.fontsReady();
  const handle = await pending;
  assert.equal(h.triggers.length, 0);
  assert.equal(handle.animation, h.tweens[0]);
  assert.equal(handle.animation.paused, true);
  assert.equal(handle.animation.from.y, 42);
  assert.equal(handle.animation.from.filter, 'blur(8px)');
  assert.equal(handle.animation.to.duration, 0.8);
  handle.play();
  assert.equal(handle.animation.paused, false);
  handle.animation.to.onComplete();
  h.assertClean();
  const replay = await h.context.stCathsTextReveal.create(h.element);
  assert.ok(replay);
  replay.revert();
  assert.equal(h.element.childNodes[0], h.textNode);
  h.assertClean();
});

test('create takes over an automatic target, works without ScrollTrigger, and cancels pending creation', async () => {
  const h = harness();
  h.run();
  const pending = h.context.stCathsTextReveal.create(h.element);
  assert.equal(h.triggers[0].killed, true);
  h.context.ScrollTrigger = undefined;
  const newer = h.context.stCathsTextReveal.create(h.element, { preset: 'paragraph' });
  await h.fontsReady();
  assert.equal(await pending, null);
  const handle = await newer;
  assert.equal(h.tweens.length, 1);
  assert.equal(handle.animation.from.y, 30);
  h.context.stCathsTextReveal.dispose();
  h.assertClean();
});

for (const attribute of ['data-text-reveal', 'data-no-text-motion', 'data-no-heading-motion']) {
  test(`inherited ${attribute} opt-out also blocks manual creation`, async () => {
    const h = harness();
    const parent = new h.Element('DIV', []);
    parent.setAttribute(attribute, attribute === 'data-text-reveal' ? 'off' : '');
    parent.replaceChildren(h.element);
    h.run();
    await h.fontsReady();
    assert.equal(await h.context.stCathsTextReveal.create(h.element), null);
    h.assertClean();
  });
}

test('recursive rich text hierarchy and text node identity survive destructive Range splitting', async () => {
  const h = harness();
  const strong = new h.Element('STRONG', []);
  const em = new h.Element('EM', []);
  const originalText = h.text('authored emphasis');
  em.replaceChildren(originalText);
  strong.replaceChildren(em);
  h.element.replaceChildren(strong, h.text(' and more'), new h.Element('BR', []));
  h.run();
  await h.fontsReady();
  await h.intersect();
  assert.equal(h.tweens.length, 1);
  h.tweens[0].to.onComplete();
  assert.equal(h.element.childNodes[0], strong);
  assert.equal(strong.childNodes[0], em);
  assert.equal(em.childNodes[0], originalText);
  assert.equal(originalText.textContent, 'authored emphasis');
  h.assertClean();
});

for (const attribute of ['id', 'name', 'tabindex', 'aria-label', 'aria-description']) {
  test(`descendant ${attribute} uses whole-element fallback without cloning or hiding`, async () => {
    const h = harness();
    const child = new h.Element('SPAN', [h.text('authored')]);
    child.setAttribute(attribute, 'keep');
    h.element.replaceChildren(child);
    h.run();
    await h.fontsReady();
    await h.intersect();
    assert.equal(h.tweens[0].targets[0], h.element);
    assert.equal(h.element.childNodes[0], child);
    assert.equal(child.getAttribute(attribute), 'keep');
    assert.equal(child.getAttribute('aria-hidden'), null);
    h.tweens[0].to.onComplete();
    h.assertClean();
  });
}

test('heading with a link uses whole-element fallback; paragraph links remain native accessible lines', async () => {
  for (const tag of ['H2', 'P']) {
    const h = harness();
    h.element.tagName = tag;
    const link = new h.Element('A', [h.text('School link')]);
    h.element.replaceChildren(link);
    h.run();
    await h.fontsReady();
    await h.intersect();
    assert.equal(h.tweens[0].targets[0] === h.element, tag === 'H2');
    assert.equal(h.tweens[0].targets[0].getAttribute('aria-hidden'), null);
    h.tweens[0].to.onComplete();
    assert.equal(h.element.childNodes[0], link);
    assert.equal(link.textContent, 'School link');
    h.assertClean();
  }
});

test('manual menu span inside a link keeps a native accessible name and the control itself', async () => {
  const h = harness();
  h.element.tagName = 'SPAN';
  const anchor = new h.Element('A', []);
  anchor.setAttribute('href', '/school');
  anchor.replaceChildren(h.element);
  h.run();
  await h.fontsReady();
  const handle = await h.context.stCathsTextReveal.create(h.element, { preset: 'menu' });
  assert.ok(handle);
  assert.equal(h.triggers.length, 0);
  assert.equal(anchor.childNodes[0], h.element);
  assert.equal(h.element.childNodes[0].getAttribute('aria-hidden'), 'true');
  assert.equal(h.element.childNodes[1].textContent, 'St Catherine’s School');
  assert.equal(h.element.childNodes[1].getAttribute('aria-hidden'), null);
  assert.equal(h.element.getAttribute('aria-label'), null);
  assert.equal(await h.context.stCathsTextReveal.create(anchor), null);
  handle.revert();
  h.assertClean();
});

for (const cancel of ['reduced', 'resize', 'fonts', 'dispose']) {
  test(`prepared paused state restores on ${cancel}`, async () => {
    const h = harness();
    h.element.setAttribute('data-text-trigger', 'manual');
    h.run();
    await h.fontsReady();
    const handle = await h.context.stCathsTextReveal.create(h.element);
    if (cancel === 'reduced') h.motion(true);
    if (cancel === 'resize') h.event('resize');
    if (cancel === 'fonts') [...h.fontListeners].forEach((fn) => fn());
    if (cancel === 'dispose') h.context.stCathsTextReveal.dispose(h.element);
    assert.equal(handle.animation.killed, true);
    assert.equal(h.element.childNodes[0], h.textNode);
    h.assertClean();
  });
}

test('rich quote/list parents select text leaves once, media/table content stays untouched', () => {
  const h = harness();
  h.targets.length = 0;
  const rich = new h.Element('DIV', []);
  rich.setAttribute('class', 'w-richtext');
  for (const tag of ['LI', 'BLOCKQUOTE']) {
    const parent = new h.Element(tag, []);
    const child = new h.Element('P', [h.text('Leaf')]);
    parent.replaceChildren(child);
    rich.appendChild(parent);
    parent.parentElement = rich;
    h.targets.push(parent, child);
  }
  for (const tag of ['IMG', 'TABLE']) {
    const parent = new h.Element('P', [new h.Element(tag, [])]);
    h.targets.push(parent);
  }
  h.run();
  assert.equal(h.triggers.length, 2);
  assert.ok(h.triggers.every((trigger) => trigger.options.trigger.tagName === 'P'));
  h.context.stCathsTextReveal.dispose();
  h.assertClean();
});

test('text inside tables and non-text roles is excluded from global discovery', () => {
  const h = harness();
  const table = new h.Element('TABLE', []);
  table.replaceChildren(h.element);
  const imageRole = new h.Element('H2');
  imageRole.setAttribute('role', 'img');
  h.targets.push(imageRole);
  h.run();
  assert.equal(h.triggers.length, 0);
  h.assertClean();
});

test('whole-element fallback cleanup does not detach focused/stateful descendants', async () => {
  const h = harness();
  const child = new h.Element('SPAN', [h.text('Keep identity')]);
  child.setAttribute('id', 'keep');
  h.element.replaceChildren(child);
  let rewrites = 0;
  const replace = h.element.replaceChildren.bind(h.element);
  h.element.replaceChildren = (...nodes) => {
    rewrites++;
    replace(...nodes);
  };
  h.run();
  await h.fontsReady();
  await h.intersect();
  h.tweens[0].to.onComplete();
  assert.equal(rewrites, 0);
  h.assertClean();
});

test('prepared inline menu span observes the nearest wrapping container beyond an inline anchor', async () => {
  const h = harness();
  h.element.tagName = 'SPAN';
  h.element.clientWidth = 0;
  h.element.getBoundingClientRect = () => ({ width: 180, height: 30, top: 0 });
  const anchor = new h.Element('A', []);
  anchor.clientWidth = 0;
  const nav = new h.Element('NAV', []);
  anchor.replaceChildren(h.element);
  nav.replaceChildren(anchor);
  h.run();
  await h.fontsReady();
  const handle = await h.context.stCathsTextReveal.create(h.element, { preset: 'menu' });
  assert.ok(handle);
  nav.clientWidth = 200;
  await h.resize();
  assert.equal(handle.animation.killed, true);
  h.assertClean();
});

test('all preset numbers reproduce the current Astro profiles without retuning', async () => {
  const expected = {
    heading: {
      type: 'chars',
      duration: 1.5,
      stagger: 0.025,
      y: 100,
      filter: 'blur(22px)',
      rotation: 12,
      rotationX: -21,
      scale: 0.95,
      transformOrigin: '50% 100%',
      transformPerspective: 800,
    },
    paragraph: {
      type: 'lines',
      duration: 1.5,
      stagger: 0.1,
      y: 30,
      filter: 'blur(0px)',
      rotation: 0,
      rotationX: 0,
      scale: 1,
      transformOrigin: '0% 100%',
      transformPerspective: 800,
    },
    eyebrow: {
      type: 'lines',
      duration: 1.5,
      stagger: 0.1,
      y: 30,
      filter: 'blur(0px)',
      rotation: 0,
      rotationX: 0,
      scale: 1,
      transformOrigin: '0% 100%',
      transformPerspective: 800,
    },
    menu: {
      type: 'words',
      duration: 0.55,
      stagger: 0.025,
      y: 28,
      filter: 'blur(8px)',
      rotation: 3,
      rotationX: 0,
      scale: 1,
      transformOrigin: '50% 100%',
      transformPerspective: 0,
    },
  };
  for (const [preset, { type, duration, stagger, ...from }] of Object.entries(expected)) {
    const h = harness();
    h.element.setAttribute('data-text-trigger', 'manual');
    h.run();
    await h.fontsReady();
    const handle = await h.context.stCathsTextReveal.create(h.element, { preset });
    assert.equal(h.splitOptions[0].type[0], type);
    assert.deepEqual(
      { ...handle.animation.from },
      { ...from, x: 0, opacity: 0, willChange: 'transform,filter,opacity' }
    );
    const to = handle.animation.to;
    for (const [key, value] of Object.entries({
      duration,
      delay: 0,
      ease: 'power3.out',
      x: 0,
      y: 0,
      opacity: 1,
      rotation: 0,
      rotationX: 0,
      scale: 1,
      filter: 'blur(0px)',
    }))
      assert.equal(to[key], value, `${preset} ${key}`);
    assert.deepEqual({ ...to.stagger }, { each: stagger, from: 'start' });
    handle.revert();
    h.assertClean();
  }
});

test('retained inline pieces restore their original descendant attributes and lazy styles', async () => {
  for (const style of [null, '', 'display: inline-block; color: red']) {
    const h = harness({ mutateOriginalAttributes: true });
    const child = new h.Element('SPAN', [h.text('Inline piece')]);
    if (style !== null) child.setAttribute('style', style);
    const attrs = [...child.attrs];
    h.element.replaceChildren(child);
    h.run();
    await h.fontsReady();
    await h.intersect();
    h.tweens[0].to.onComplete();
    assert.equal(h.element.childNodes[0], child);
    assert.equal(child.getAttribute('style'), style);
    assert.deepEqual([...child.attrs], attrs);
    h.assertClean();
  }
});

test('end-of-document footer reveals at maximum scroll even below the ordinary 92% threshold', async () => {
  const h = harness();
  h.element.tagName = 'P';
  h.element.top = 1960;
  h.context.scrollMax = 1000;
  h.run();
  await h.fontsReady();
  const trigger = h.triggers[0];
  assert.ok(trigger.start < 1000, 'start must be reachable with positive trigger progress');
  await h.scrollTo(998);
  assert.equal(h.tweens.length, 0);
  await h.scrollTo(1000);
  assert.ok(h.element.getBoundingClientRect().top > h.context.innerHeight * 0.92);
  assert.equal(h.tweens.length, 1, 'preparation uses the actual reachable trigger start');
  h.tweens[0].to.onComplete();
  h.init();
  await h.scrollTo(1000);
  assert.equal(h.tweens.length, 1);
  h.assertClean();
});

for (const tag of ['MAIN', 'SECTION', 'DIV']) {
  test(`structural ${tag} tabindex=-1 ancestor still allows automatic text`, async () => {
    const h = harness();
    const parent = new h.Element(tag, []);
    parent.setAttribute('tabindex', '-1');
    parent.replaceChildren(h.element);
    h.run();
    await h.fontsReady();
    await h.intersect();
    assert.equal(h.tweens.length, 1);
    h.tweens[0].to.onComplete();
    assert.equal(parent.getAttribute('tabindex'), '-1');
    h.assertClean();
  });
}

for (const [tag, attributes] of [
  ['A', { tabindex: '-1', href: '/school' }],
  ['BUTTON', { tabindex: '-1' }],
  ['MAIN', { tabindex: '-1', contenteditable: 'true' }],
  ['SECTION', { tabindex: '-1', role: 'button' }],
  ['DIV', { tabindex: '0' }],
]) {
  test(`interactive ancestor remains excluded: ${tag} ${JSON.stringify(attributes)}`, () => {
    const h = harness();
    const parent = new h.Element(tag, []);
    Object.entries(attributes).forEach(([key, value]) => parent.setAttribute(key, value));
    parent.replaceChildren(h.element);
    h.run();
    assert.equal(h.triggers.length, 0);
    h.assertClean();
  });
}

for (const tag of ['H2', 'SPAN']) {
  test(`rendered ${tag} accessible text retains a word boundary across br`, async () => {
    const h = harness();
    h.element.tagName = tag;
    h.element.innerText = '  Keep authored emphasis\nand natural line breaks intact  ';
    h.element.replaceChildren(
      h.text('Keep authored emphasis'),
      new h.Element('BR', []),
      h.text('and natural line breaks intact')
    );
    h.element.setAttribute('data-text-trigger', 'manual');
    h.run();
    await h.fontsReady();
    const handle = await h.context.stCathsTextReveal.create(h.element, {
      preset: tag === 'H2' ? 'heading' : 'menu',
    });
    const name =
      tag === 'H2' ? h.element.getAttribute('aria-label') : h.element.childNodes.at(-1).textContent;
    assert.equal(name, 'Keep authored emphasis and natural line breaks intact');
    handle.revert();
    assert.equal(h.element.getAttribute('aria-label'), null);
    assert.equal(h.element.textContent, 'Keep authored emphasisand natural line breaks intact');
    h.assertClean();
  });
}

test('keyboard focus on a split paragraph link restores readable original link without stealing focus later', async () => {
  const h = harness({ cloneLinks: true });
  h.element.tagName = 'P';
  const original = new h.Element('A', [h.text('School')]);
  original.setAttribute('href', '/school');
  h.element.replaceChildren(original);
  h.run();
  await h.fontsReady();
  await h.intersect();
  const clone = h.element.querySelector('a');
  assert.notEqual(clone, original);
  clone.focus();
  assert.equal(h.context.document.activeElement, original);
  assert.equal(h.element.querySelector('a'), original);
  assert.equal(original.textContent, 'School');
  assert.equal(original.getAttribute('href'), '/school');
  assert.equal(original.getAttribute('aria-hidden'), null);
  assert.equal(original.focusOptions.preventScroll, true);
  assert.equal(h.tweens[0].killed, true);
  h.tweens[0].to.onComplete();
  assert.equal(h.context.document.activeElement, original);
  h.assertClean();
});

test('pointer focus does not replace the clicked clone before native link activation', async () => {
  const h = harness({ cloneLinks: true });
  h.element.tagName = 'P';
  const original = new h.Element('A', [h.text('School')]);
  original.setAttribute('href', '/school');
  h.element.replaceChildren(original);
  h.run();
  await h.fontsReady();
  await h.intersect();
  const clone = h.element.querySelector('a');
  clone.focusVisible = false;
  clone.focus();
  assert.equal(h.element.querySelector('a'), clone);
  assert.equal(h.tweens[0].killed, false);
  h.tweens[0].to.onComplete();
  assert.equal(h.context.document.activeElement, original);
  h.assertClean();
});

test('rendered text does not replace authored aria-label or aria-labelledby', async () => {
  for (const [name, value] of [
    ['aria-label', 'Authored name'],
    ['aria-labelledby', 'external-label'],
  ]) {
    const h = harness();
    h.element.innerText = 'Visual line\nbreak';
    h.element.setAttribute(name, value);
    h.run();
    await h.fontsReady();
    await h.intersect();
    assert.equal(h.element.getAttribute(name), value);
    if (name === 'aria-labelledby') assert.equal(h.element.getAttribute('aria-label'), null);
    h.tweens[0].to.onComplete();
    assert.deepEqual([...h.element.attrs], [[name, value]]);
    h.assertClean();
  }
});

test('link correlation preserves authored attributes and chooses the correct same-href original', async () => {
  const h = harness({ cloneLinks: true });
  h.element.tagName = 'P';
  const links = ['First', 'Second'].map((label) => {
    const link = new h.Element('A', [h.text(label)]);
    link.setAttribute('href', '/school');
    link.setAttribute('data-text-reveal-link', 'authored');
    return link;
  });
  h.element.replaceChildren(...links);
  h.run();
  await h.fontsReady();
  await h.intersect();
  const clones = h.element.querySelectorAll('a');
  assert.ok(clones.every((clone) => clone.getAttribute('data-text-reveal-link') === 'authored'));
  clones[1].focus();
  assert.equal(h.context.document.activeElement, links[1]);
  assert.ok(links.every((link) => link.getAttribute('data-text-reveal-link') === 'authored'));
  assert.equal(links[0].textContent, 'First');
  h.assertClean();
});

test('an already focused paragraph link stays native while create returns null', async () => {
  const h = harness();
  h.element.tagName = 'P';
  h.element.setAttribute('data-text-trigger', 'manual');
  const link = new h.Element('A', [h.text('School')]);
  h.element.replaceChildren(link);
  link.focus();
  h.run();
  await h.fontsReady();
  assert.equal(await h.context.stCathsTextReveal.create(h.element), null);
  assert.equal(h.context.document.activeElement, link);
  assert.equal(h.tweens.length, 0);
  h.assertClean();
});
