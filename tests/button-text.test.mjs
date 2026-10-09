import { build } from 'esbuild';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

const { outputFiles } = await build({
  entryPoints: ['src/components/button-text.ts'],
  bundle: true,
  format: 'iife',
  write: false,
});
const source = outputFiles[0].text;

// Only DOM, layout, WAAPI and scheduling are simulated; motion is checked by browser QA.
function harness({
  reduced = false,
  hover = true,
  fontsLoading = false,
  segmenter = true,
  deferCompletion = false,
} = {}) {
  const animations = [],
    timers = new Map(),
    frames = new Map(),
    observers = [],
    errors = [];
  let clock = 0,
    serial = 0,
    releaseFonts;
  class Events {
    listeners = new Map();
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(fn);
    }
    removeEventListener(name, fn) {
      this.listeners.get(name)?.delete(fn);
    }
    emit(name, data = {}) {
      for (const fn of [...(this.listeners.get(name) ?? [])])
        fn({ type: name, pointerType: 'mouse', ...data });
    }
  }
  const text = (value) => ({
    nodeType: 3,
    nodeValue: value,
    get textContent() {
      return this.nodeValue;
    },
  });
  class Element extends Events {
    nodeType = 1;
    childNodes = [];
    attrs = new Map();
    parentElement = null;
    isConnected = true;
    style = new Proxy(
      {},
      {
        set: (target, key, value) => {
          target[key] = value;
          this.attrs.set('style', key === 'cssText' ? value : `${key}: ${value}`);
          return true;
        },
      }
    );
    clientLeft = 0;
    clientTop = 0;
    scrollLeft = 0;
    scrollTop = 0;
    clientWidth = 100;
    clientHeight = 24;
    offsetWidth = 100;
    offsetHeight = 24;
    constructor(tag = 'DIV') {
      super();
      this.tagName = tag;
    }
    get children() {
      return this.childNodes.filter((n) => n.nodeType === 1);
    }
    get textContent() {
      return this.childNodes.map((n) => n.textContent).join('');
    }
    set textContent(value) {
      this.replaceChildren(text(value));
    }
    getAttribute(name) {
      return this.attrs.get(name) ?? null;
    }
    hasAttribute(name) {
      return this.attrs.has(name);
    }
    setAttribute(name, value) {
      this.attrs.set(name, String(value));
    }
    removeAttribute(name) {
      this.attrs.delete(name);
    }
    matches(selector) {
      return selector.split(',').some((part) => {
        part = part.trim();
        if (part === ':disabled') return this.hasAttribute('disabled');
        const not = part.match(/:not\((.*?)\)/);
        if (not) {
          if (this.matches(not[1])) return false;
          part = part.replace(not[0], '');
        }
        if (part.startsWith('.'))
          return (this.getAttribute('class') ?? '').split(' ').includes(part.slice(1));
        const attr = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        if (attr)
          return attr[2] === undefined
            ? this.hasAttribute(attr[1])
            : this.getAttribute(attr[1]) === attr[2];
        return part === '*' || part.toUpperCase() === this.tagName;
      });
    }
    closest(selector) {
      return this.matches(selector) ? this : (this.parentElement?.closest(selector) ?? null);
    }
    contains(target) {
      return this === target || this.childNodes.some((n) => n === target || n.contains?.(target));
    }
    querySelectorAll(selector) {
      return this.children.flatMap((n) => [
        ...(n.matches(selector) ? [n] : []),
        ...n.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }
    replaceChildren(...nodes) {
      this.childNodes = [];
      for (const n of nodes) this.appendChild(n);
    }
    appendChild(node) {
      if (node.parentElement)
        node.parentElement.childNodes = node.parentElement.childNodes.filter((n) => n !== node);
      this.childNodes.push(node);
      node.parentElement = this;
      return node;
    }
    append(...nodes) {
      nodes.forEach((n) => this.appendChild(n));
    }
    getBoundingClientRect() {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: this.clientWidth,
        bottom: this.clientHeight,
        width: this.clientWidth,
        height: this.clientHeight,
      };
    }
    getClientRects() {
      return [this.getBoundingClientRect()];
    }
    animate(keyframes, options) {
      let resolve, reject;
      const finished = new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      });
      const a = {
        target: this,
        keyframes,
        options,
        cancelled: false,
        finished,
        complete() {
          resolve(this);
        },
        fail(error = new Error('Animation failed')) {
          reject(error);
        },
        cancel() {
          this.cancelled = true;
          reject(new DOMException('Animation cancelled', 'AbortError'));
        },
      };
      animations.push(a);
      if (!deferCompletion) a.complete();
      return a;
    }
  }
  const document = new Element('DOCUMENT');
  document.createElement = (tag) => new Element(tag.toUpperCase());
  document.createRange = () => ({
    setStart(node, offset) {
      this.start = offset;
    },
    setEnd(node, offset) {
      this.end = offset;
    },
    getClientRects() {
      return [this.getBoundingClientRect()];
    },
    getBoundingClientRect() {
      return { left: this.start * 8, top: 0, width: (this.end - this.start) * 8, height: 20 };
    },
  });
  const fonts = new Events();
  fonts.status = fontsLoading ? 'loading' : 'loaded';
  fonts.ready = fontsLoading
    ? new Promise((r) => {
        releaseFonts = r;
      })
    : Promise.resolve();
  document.fonts = fonts;
  const motion = new Events();
  motion.matches = reduced;
  const pointer = new Events();
  pointer.matches = hover;
  const window = new Events();
  Object.assign(window, {
    document,
    HTMLElement: Element,
    Element,
    Node: { TEXT_NODE: 3, COMMENT_NODE: 8 },
    Intl: segmenter ? Intl : { ...Intl, Segmenter: undefined },
    console: { error: (...args) => errors.push(args) },
    getComputedStyle: () => ({
      position: 'static',
      direction: 'ltr',
      writingMode: 'horizontal-tb',
      fontSize: '16px',
      visibility: 'visible',
      opacity: '1',
      display: 'block',
    }),
    matchMedia: (query) => (query.includes('reduced') ? motion : pointer),
    setTimeout(fn, ms) {
      const id = ++serial;
      timers.set(id, { fn, at: clock + ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame(fn) {
      const id = ++serial;
      frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    ResizeObserver: class {
      constructor(fn) {
        this.fn = fn;
        this.targets = new Set();
        observers.push(this);
      }
      observe(el) {
        this.targets.add(el);
      }
      disconnect() {
        this.targets.clear();
      }
    },
  });
  window.window = window;
  const context = vm.createContext(window);
  const create = (tag, className, content) => {
    const el = new Element(tag);
    if (className) el.setAttribute('class', className);
    if (content !== undefined) el.textContent = content;
    return el;
  };
  function button(content = 'Enquire', direct = false, parent = document, tag = 'A') {
    const component = create('DIV', 'button_component');
    const link = create(tag, 'button_link');
    link.setAttribute('aria-label', 'Authored name');
    link.setAttribute('href', '#destination');
    const label = create('P', 'button_text', content);
    parent.append(component);
    component.append(link);
    (direct ? link : component).append(label);
    return { component, link, label, nodes: [...label.childNodes], attrs: [...label.attrs] };
  }
  const first = button();
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  return {
    ...first,
    button,
    create,
    document,
    context,
    animations,
    timers,
    frames,
    observers,
    errors,
    motion,
    pointer,
    fonts,
    run: () => vm.runInContext(source, context),
    flush,
    async event(name, link = first.link, data) {
      link.emit(name, data);
      await flush();
    },
    async ready() {
      fonts.status = 'loaded';
      releaseFonts?.();
      await flush();
    },
    async tick(ms) {
      clock += ms;
      for (const [id, t] of [...timers])
        if (t.at <= clock) {
          timers.delete(id);
          t.fn();
        }
      await flush();
    },
    async frame() {
      for (const [id, fn] of [...frames]) {
        frames.delete(id);
        fn();
      }
      await flush();
    },
    clean(b = first) {
      assert.deepEqual(b.label.childNodes, b.nodes);
      assert.deepEqual([...b.label.attrs], b.attrs);
    },
  };
}

test('overlay owns sibling label, exact concept WAAPI and exact native restoration', async () => {
  const h = harness();
  h.run();
  h.clean();
  assert.deepEqual([...h.label.listeners.keys()], []);
  assert.deepEqual([...h.link.listeners.keys()].sort(), [
    'blur',
    'focus',
    'pointerenter',
    'pointerleave',
  ]);
  await h.event('pointerenter');
  assert.equal(h.animations.length, 14);
  const out = h.animations[0],
    incoming = h.animations[1];
  assert.deepEqual(JSON.parse(JSON.stringify(out.keyframes)), [
    { transform: 'translateY(0)' },
    { transform: 'translateY(-150%)' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(incoming.keyframes)), [
    { transform: 'translateY(150%)' },
    { transform: 'translateY(0)' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.animations[4].options)), {
    duration: 500,
    delay: 50,
    easing: 'cubic-bezier(.16,1,.3,1)',
    fill: 'both',
  });
  assert.equal(h.link.getAttribute('aria-label'), 'Authored name');
  assert.equal(h.link.getAttribute('href'), '#destination');
  assert.equal(
    h.label.children.filter((el) => el.getAttribute('aria-hidden') !== 'true').length,
    1
  );
  await h.tick(734);
  assert.equal(out.cancelled, false);
  await h.tick(1);
  h.clean();
  assert.ok(h.animations.every((a) => a.cancelled));
});

test('direct labels, independent siblings and nested components never cross-bind', async () => {
  const h = harness();
  const direct = h.button('Go', true, h.document, 'BUTTON');
  const nested = h.button('Nested', false, h.component);
  h.run();
  await h.event('pointerenter');
  assert.equal(h.animations.length, 14);
  h.clean(direct);
  h.clean(nested);
  await h.event('focus', direct.link);
  assert.equal(h.animations.length, 18);
  await h.event('pointerleave', nested.link);
  assert.equal(h.animations.length, 30);
  h.context.stCathsButtonText.dispose(h.component);
  h.clean();
  h.clean(nested);
  assert.ok(h.animations.slice(14, 18).every((a) => !a.cancelled));
  h.context.stCathsButtonText.dispose();
  h.clean(direct);
});

test('one queued replay at most; focus and blur work independently of pointer capabilities', async () => {
  const h = harness({ hover: false });
  h.run();
  await h.event('pointerenter');
  await h.event('pointerleave');
  assert.equal(h.animations.length, 0);
  await h.event('focus');
  await h.event('blur');
  await h.event('focus');
  await h.event('blur');
  assert.equal(h.animations.length, 14);
  await h.tick(735);
  h.clean();
  await h.frame();
  assert.equal(h.animations.length, 28);
  await h.tick(735);
  await h.frame();
  assert.equal(h.animations.length, 28);
  h.clean();
  h.pointer.matches = true;
  await h.event('pointerenter', h.link, { pointerType: 'touch' });
  assert.equal(h.animations.length, 28);
  await h.event('pointerleave');
  assert.equal(h.animations.length, 42);
});

test('waits for fonts without touching native text; disposal invalidates pending work', async () => {
  const h = harness({ fontsLoading: true });
  h.run();
  await h.event('pointerenter');
  h.clean();
  assert.equal(h.animations.length, 0);
  h.context.stCathsButtonText.dispose();
  await h.ready();
  h.clean();
  assert.equal(h.animations.length, 0);
  h.context.stCathsButtonText.init();
  await h.event('focus');
  assert.equal(h.animations.length, 14);
});

for (const reason of ['reduced', 'resize', 'container', 'fonts', 'pagehide', 'dispose']) {
  test(`${reason} cancels active roll and queued replay, releases cycle resources`, async () => {
    const h = harness();
    h.run();
    await h.event('pointerenter');
    await h.event('pointerleave');
    if (reason === 'reduced') {
      h.motion.matches = true;
      h.motion.emit('change');
    }
    if (reason === 'resize') h.context.emit('resize');
    if (reason === 'container') {
      h.component.clientWidth = 140;
      h.observers.forEach((o) => o.fn([]));
    }
    if (reason === 'fonts') h.fonts.emit('loading');
    if (reason === 'pagehide') h.context.emit('pagehide');
    if (reason === 'dispose') h.context.stCathsButtonText.dispose(h.label);
    h.clean();
    await h.tick(3000);
    await h.frame();
    assert.equal(h.animations.length, 14);
    assert.equal(h.timers.size, 0);
    assert.ok(h.observers.every((o) => o.targets.size === 0));
    assert.ok([...h.fonts.listeners.values()].every((s) => s.size === 0));
    assert.equal(h.context.listeners.get('resize')?.size ?? 0, 0);
    h.context.stCathsButtonText.dispose();
    assert.ok([...h.motion.listeners.values()].every((s) => s.size === 0));
    assert.ok([...h.context.listeners.values()].every((s) => s.size === 0));
  });
}

test('initial reduced motion stays native; preference change enables later interaction', async () => {
  const h = harness({ reduced: true });
  h.run();
  await h.event('focus');
  h.clean();
  assert.equal(h.animations.length, 0);
  h.motion.matches = false;
  h.motion.emit('change');
  await h.event('focus');
  assert.equal(h.animations.length, 14);
});

test('repeat init and script execution bind once; scoped dispose and init bind again', async () => {
  const h = harness();
  h.run();
  h.run();
  h.context.stCathsButtonText.init(h.link);
  await h.event('focus');
  assert.equal(h.animations.length, 14);
  h.context.stCathsButtonText.dispose(h.link);
  h.clean();
  await h.event('blur');
  assert.equal(h.animations.length, 14);
  h.context.stCathsButtonText.init(h.link);
  await h.event('focus');
  assert.equal(h.animations.length, 28);
});

for (const [attribute, value] of [
  ['data-button-text', 'off'],
  ['data-text-reveal', 'off'],
  ['data-no-text-motion', ''],
  ['data-no-heading-motion', ''],
  ['inert', ''],
  ['aria-disabled', 'true'],
  ['disabled', ''],
  ['contenteditable', 'true'],
]) {
  test(`inherited ${attribute} skips both overlay and labels`, async () => {
    const h = harness();
    h.component.setAttribute(attribute, value);
    h.run();
    await h.event('focus');
    h.clean();
    assert.equal(h.animations.length, 0);
    assert.equal(h.link.listeners.size, 0);
  });
}

test('missing, empty and rich/stateful labels stay native; scroll manual does not disable hover', async () => {
  const h = harness();
  const rich = h.button('Rich');
  const original = h.create('STRONG', '', 'stateful');
  rich.label.append(original);
  const empty = h.button('   ');
  const missing = h.button('Missing');
  missing.label.removeAttribute('class');
  h.label.setAttribute('data-text-trigger', 'manual');
  h.attrs = [...h.label.attrs];
  h.run();
  for (const b of [rich, empty, missing]) {
    await h.event('focus', b.link);
    assert.equal(b.link.listeners.size, 0);
  }
  assert.equal(rich.label.childNodes.at(-1), original);
  await h.event('focus');
  assert.equal(h.animations.length, 14);
});

for (const segmenter of [true, false]) {
  test(`space/emoji segmentation with Intl.Segmenter ${segmenter}`, async () => {
    const h = harness({ segmenter });
    h.label.textContent = 'A 👩‍🎓 e\u0301';
    h.run();
    await h.event('focus');
    const expected = segmenter ? 5 : Array.from(h.label.children[0].textContent).length;
    assert.equal(h.animations.length, expected * 2);
    assert.equal(h.animations[2].target.textContent, ' ');
  });
}

test('missing WAAPI and partial WAAPI errors restore exact nodes and authored label attributes', async () => {
  const h = harness();
  h.label.setAttribute('style', 'color: red; --authored: 1');
  const attrs = [...h.label.attrs];
  h.run();
  const prototype = h.context.HTMLElement.prototype,
    original = prototype.animate;
  prototype.animate = undefined;
  await h.event('focus');
  assert.equal(h.animations.length, 0);
  prototype.animate = function (...args) {
    if (h.animations.length === 1) throw new Error('WAAPI failed');
    return original.apply(this, args);
  };
  await h.event('focus');
  assert.deepEqual(h.label.childNodes, h.nodes);
  assert.deepEqual([...h.label.attrs], attrs);
  assert.equal(h.errors.length, 1);
  assert.ok(h.animations[0].cancelled);
  assert.equal(h.timers.size, 0);
});

test('resize cancels pending fonts', async () => {
  const h = harness({ fontsLoading: true });
  h.run();
  await h.event('focus');
  h.context.emit('resize');
  await h.ready();
  h.clean();
  assert.equal(h.animations.length, 0);
});

test('interactive or live labels are unsafe even with plain text', async () => {
  const h = harness();
  h.label.setAttribute('aria-live', 'polite');
  h.run();
  await h.event('focus');
  assert.equal(h.animations.length, 0);
});

test('two links in one component cannot simultaneously own the same sibling text', async () => {
  const h = harness();
  const second = h.create('A', 'button_link');
  h.component.append(second);
  h.run();
  await h.event('focus');
  await h.event('focus', second);
  assert.equal(h.animations.length, 14);
  h.context.stCathsButtonText.dispose();
  h.clean();
});

test('unexpected layout changes during preparation fall back before any animation', async () => {
  const h = harness();
  const bounds = h.label.getBoundingClientRect.bind(h.label);
  h.label.getBoundingClientRect = () => ({
    ...bounds(),
    height: h.label.children.length ? 48 : 24,
  });
  h.run();
  await h.event('focus');
  h.clean();
  assert.equal(h.animations.length, 0);
});

test('a grapheme starting at a text-node boundary measures from the new node', async () => {
  const h = harness();
  h.label.textContent = 'En';
  const second = h.create('SPAN', '', 'quire').childNodes[0];
  h.label.append(second);
  const starts = [];
  const createRange = h.document.createRange;
  h.document.createRange = () => {
    const range = createRange();
    const start = range.setStart;
    range.setStart = function (node, offset) {
      starts.push([node, offset]);
      start.call(this, node, offset);
    };
    return range;
  };
  h.run();
  await h.event('focus');
  assert.equal(starts[2][0], second);
  assert.equal(starts[2][1], 0);
});

test('the loadingdone event queued after initial fonts.ready does not cancel the new roll', async () => {
  const h = harness({ fontsLoading: true });
  h.run();
  await h.event('focus');
  await h.ready();
  assert.equal(h.animations.length, 14);
  h.fonts.emit('loadingdone');
  assert.ok(h.animations.every((a) => !a.cancelled));
  h.fonts.emit('loading');
  h.clean();
});

test('missing size observation leaves native labels instead of untracked overlays', async () => {
  const h = harness();
  h.context.ResizeObserver = undefined;
  h.run();
  await h.event('focus');
  h.clean();
  assert.equal(h.animations.length, 0);
});

test('default disposal releases detached controls and restores their label nodes', async () => {
  const h = harness();
  h.run();
  await h.event('focus');
  h.document.replaceChildren();
  h.context.stCathsButtonText.dispose();
  h.clean();
  assert.ok([...h.link.listeners.values()].every((s) => s.size === 0));
});

test('a label moved into another component is no longer owned by the old overlay', async () => {
  const h = harness();
  const other = h.button('Other');
  h.run();
  other.component.append(h.label);
  await h.event('focus');
  h.clean();
  assert.equal(h.animations.length, 0);
});

test('late compositor completion keeps all copies until the last finished promise, then replays once', async () => {
  const h = harness({ deferCompletion: true });
  h.run();
  await h.event('focus');
  await h.event('blur');
  await h.event('pointerenter');
  await h.tick(735);
  assert.ok(
    h.animations.every((a) => !a.cancelled),
    'nominal reset must wait for compositor'
  );
  assert.equal(h.frames.size, 0);
  h.animations.slice(0, -1).forEach((a) => a.complete());
  await h.flush();
  assert.ok(
    h.animations.every((a) => !a.cancelled),
    'all copies must finish'
  );
  h.animations.at(-1).complete();
  await h.flush();
  h.clean();
  assert.equal(h.frames.size, 1);
  await h.frame();
  assert.equal(h.animations.length, 28);
  h.animations.slice(14).forEach((a) => a.complete());
  await h.flush();
  await h.tick(734);
  assert.ok(
    h.animations.slice(14).every((a) => !a.cancelled),
    'nominal time remains the minimum'
  );
  await h.tick(1);
  h.clean();
  await h.frame();
  assert.equal(h.animations.length, 28);
});

for (const reason of ['dispose', 'reduced', 'resize']) {
  test(`${reason} invalidates finished callbacks already queued by the compositor`, async () => {
    const h = harness({ deferCompletion: true });
    h.run();
    await h.event('focus');
    await h.event('blur');
    const old = [...h.animations];
    // Queue fulfilled callbacks, then cancel synchronously before their microtasks run.
    old.forEach((a) => a.complete());
    if (reason === 'dispose') h.context.stCathsButtonText.dispose();
    if (reason === 'reduced') {
      h.motion.matches = true;
      h.motion.emit('change');
    }
    if (reason === 'resize') h.context.emit('resize');
    h.clean();
    h.motion.matches = false;
    h.context.stCathsButtonText.init();
    await h.event('focus');
    assert.equal(h.animations.length, 28);
    await h.tick(735);
    assert.ok(
      h.animations.slice(14).every((a) => !a.cancelled),
      'stale completion cannot restore new cycle'
    );
    assert.equal(h.frames.size, 0, 'stale completion cannot replay');
    h.animations.slice(14).forEach((a) => a.complete());
    await h.flush();
    h.clean();
    await h.frame();
    assert.equal(h.animations.length, 28);
  });
}

test('rejected native finished promises restore immediately and drop the queued replay', async () => {
  const h = harness({ deferCompletion: true });
  h.run();
  await h.event('focus');
  await h.event('blur');
  h.animations[0].fail();
  await h.flush();
  assert.ok(h.animations.every((a) => a.cancelled));
  h.clean();
  await h.tick(2000);
  await h.frame();
  assert.equal(h.animations.length, 14);
});

test('missing finished semantics falls back safely after partial WAAPI setup', async () => {
  const h = harness({ deferCompletion: true });
  const prototype = h.context.HTMLElement.prototype,
    animate = prototype.animate;
  prototype.animate = function (...args) {
    if (h.animations.length === 1) return { cancel() {} };
    return animate.apply(this, args);
  };
  h.run();
  await h.event('focus');
  h.clean();
  assert.ok(h.animations[0].cancelled);
  assert.equal(h.timers.size, 0);
  assert.equal(h.frames.size, 0);
  assert.ok(h.observers.every((o) => o.targets.size === 0));
});

test('partial animate failure handles rejection from every already-created native animation', async () => {
  const h = harness({ deferCompletion: true });
  const prototype = h.context.HTMLElement.prototype,
    animate = prototype.animate;
  prototype.animate = function (...args) {
    if (h.animations.length === 1) throw new Error('Partial WAAPI failure');
    return animate.apply(this, args);
  };
  h.run();
  await h.event('focus');
  await h.flush();
  h.clean();
  assert.ok(h.animations[0].cancelled);
  assert.equal(h.timers.size, 0);
});

test('delayed no-preference change delivery cannot cancel newly enabled focus or hover', async () => {
  const h = harness({ reduced: true });
  h.run();
  await h.event('focus');
  h.clean();
  assert.equal(h.animations.length, 0);
  h.motion.matches = false;
  await h.event('focus');
  h.motion.emit('change', { matches: false });
  await h.flush();
  assert.ok(
    h.animations.every((a) => !a.cancelled),
    'late enabling event must preserve new focus roll'
  );
  await h.tick(735);
  h.clean();
  await h.event('focus');
  await h.event('blur');
  h.motion.matches = true;
  h.motion.emit('change', { matches: true });
  h.clean();
  h.motion.matches = false;
  await h.event('pointerenter');
  h.motion.emit('change', { matches: false });
  await h.flush();
  assert.equal(h.animations.length, 42);
  assert.ok(
    h.animations.slice(28).every((a) => !a.cancelled),
    'late enabling event must preserve new hover roll'
  );
  await h.tick(735);
  h.clean();
  await h.frame();
  assert.equal(h.animations.length, 42);
});
