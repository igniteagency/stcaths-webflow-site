import { buildSync } from 'esbuild';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const path = 'src/components/conditional-fields.ts';
const code = existsSync(path)
  ? buildSync({ entryPoints: [path], bundle: true, write: false, format: 'iife' }).outputFiles[0]
      .text
  : '';

class Element {
  constructor(tag, attrs = {}, props = {}, children = []) {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
    Object.assign(
      this,
      {
        value: '',
        type: '',
        name: '',
        checked: false,
        required: false,
        disabled: false,
        hidden: false,
      },
      props
    );
    const classes = new Set((attrs.class || '').split(' ').filter(Boolean));
    this.classList = {
      contains: (name) => classes.has(name),
      toggle: (name, force = !classes.has(name)) => {
        if (force) classes.add(name);
        else classes.delete(name);
        return force;
      },
    };
    this.children = children;
    children.forEach((child) => {
      child.parentElement = this;
    });
    this.listeners = new Map();
    const styles = new Map();
    this.style = {
      getPropertyValue: (key) => styles.get(key)?.[0] || '',
      getPropertyPriority: (key) => styles.get(key)?.[1] || '',
      setProperty: (key, value, priority = '') => styles.set(key, [value, priority]),
      removeProperty: (key) => styles.delete(key),
    };
  }
  getAttribute(key) {
    return this.attrs.get(key) ?? null;
  }
  matches(selector) {
    return selector.split(',').some((part) => {
      part = part.trim();
      if (part === ':disabled')
        return (
          this.disabled ||
          (this.parentElement?.tagName === 'FIELDSET' && this.parentElement.disabled)
        );
      if (part.startsWith('.')) return this.classList.contains(part.slice(1));
      if (part === '[hidden]') return this.hidden;
      if (part.startsWith('[')) return this.attrs.has(part.slice(1, -1));
      return this.tagName.toLowerCase() === part;
    });
  }
  closest(selector) {
    return this.matches(selector) ? this : (this.parentElement?.closest(selector) ?? null);
  }
  contains(element) {
    return element === this || this.children.some((child) => child.contains(element));
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  addEventListener(name, listener) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), listener]);
  }
  dispatch(name, target = this) {
    for (const listener of this.listeners.get(name) || []) listener({ target });
    this.parentElement?.dispatch(name, target);
  }
}
const control = (key, value, props = {}) =>
  new Element('input', { 'data-conditional-field': key }, { value, ...props });
const branch = (key, value, children = []) =>
  new Element('div', { 'data-conditional-when': key, 'data-conditional-is': value }, {}, children);
function boot(...children) {
  const document = new Element('document', {}, {}, children);
  const window = new Element('window');
  const diagnostics = [];
  const timers = [];
  const context = vm.createContext({
    document,
    window,
    console: { debug: (...args) => diagnostics.push(args) },
    setTimeout: (fn) => timers.push(fn),
    getComputedStyle: (el) => ({
      display: el.style.getPropertyValue('display') || 'block',
      visibility: el.visibility || 'visible',
    }),
  });
  vm.runInContext(code, context);
  return {
    diagnostics,
    document,
    window,
    again: () => vm.runInContext(code, context),
    flush: () => timers.splice(0).forEach((fn) => fn()),
  };
}

test('initial selection is scoped to the nearest form, retaining active prefilled answers', () => {
  const answer = new Element('input', {}, { value: 'prefilled' });
  const active = branch('kind', 'other', [answer]);
  const inactive = branch('kind', 'other');
  const orphan = branch('kind', 'other');
  boot(
    new Element('form', {}, {}, [control('kind', 'other'), active]),
    new Element('form', {}, {}, [control('kind', 'fees'), inactive]),
    orphan
  );
  assert.equal(active.hidden, false);
  assert.equal(answer.value, 'prefilled');
  assert.equal(inactive.hidden, true);
  assert.equal(inactive.style.getPropertyValue('display'), 'none');
  assert.equal(inactive.style.getPropertyPriority('display'), 'important');
  assert.equal(orphan.hidden, false);
});

for (const hiddenScope of ['form', 'modal']) {
  test(`an initially hidden ${hiddenScope} retains active prefilled answers before it opens`, () => {
    const answer = new Element('input', {}, { value: 'prefilled modal answer', required: true });
    const wrapper = branch('kind', 'other', [answer]);
    const form = new Element('form', {}, { hidden: hiddenScope === 'form' }, [
      control('kind', 'other'),
      wrapper,
    ]);
    const modal = new Element('div', {}, { hidden: hiddenScope === 'modal' }, [form]);
    boot(modal);
    form.hidden = false;
    modal.hidden = false;
    assert.deepEqual(
      [wrapper.hidden, answer.value, answer.required, answer.disabled],
      [false, 'prefilled modal answer', true, false]
    );
  });
}

test('select option values, radio values and checkbox booleans update with exact pipe OR matching', () => {
  const select = new Element('select', { 'data-conditional-field': 'kind' }, { value: 'fees' });
  const radioA = control('radio', 'a', { type: 'radio', name: 'choice' });
  const radioB = control('radio', 'b', { type: 'radio', name: 'choice', checked: true });
  const checkbox = control('check', 'irrelevant', { type: 'checkbox' });
  const dropdown = branch('kind', ' admissions | fees ');
  dropdown.style.setProperty('display', 'grid', 'important');
  const radio = branch('radio', 'b');
  const checked = branch('check', 'true');
  const unchecked = branch('check', 'false');
  const form = new Element('form', {}, {}, [
    select,
    radioA,
    radioB,
    checkbox,
    dropdown,
    radio,
    checked,
    unchecked,
  ]);
  boot(form);
  assert.deepEqual(
    [dropdown.hidden, radio.hidden, checked.hidden, unchecked.hidden],
    [false, false, true, false]
  );
  select.value = 'Fees';
  checkbox.checked = true;
  radioB.checked = false;
  radioA.checked = true;
  form.dispatch('change');
  assert.deepEqual(
    [dropdown.hidden, radio.hidden, checked.hidden, unchecked.hidden],
    [true, true, false, true]
  );
  select.value = ' fees ';
  form.dispatch('input');
  assert.equal(dropdown.hidden, true);
  select.value = 'admissions';
  form.dispatch('input');
  assert.equal(dropdown.hidden, false);
  assert.equal(dropdown.style.getPropertyValue('display'), 'grid');
  assert.equal(dropdown.style.getPropertyPriority('display'), 'important');
});

test('inactive answers are cleared and exact required/disabled intent returns without wiping button labels or unrelated fields', () => {
  const trigger = control('kind', 'yes');
  const text = new Element('input', {}, { value: 'answer', required: true });
  const disabled = new Element('textarea', {}, { value: 'old', disabled: true });
  const check = new Element('input', {}, { type: 'checkbox', checked: true });
  const radio = new Element('input', {}, { type: 'radio', checked: true });
  const select = new Element('select', {}, { value: 'old', selectedIndex: 1 });
  const file = new Element('input', {}, { type: 'file', value: 'fakepath' });
  const buttons = ['submit', 'reset', 'button'].map(
    (type) => new Element('input', {}, { type, value: 'Label' })
  );
  const nativeButton = new Element('button', {}, { value: 'Label' });
  const tracking = new Element('input', {}, { type: 'hidden', value: 'tracking' });
  const wrapper = branch('kind', 'yes', [
    text,
    disabled,
    check,
    radio,
    select,
    file,
    ...buttons,
    nativeButton,
  ]);
  const form = new Element('form', {}, {}, [trigger, wrapper, tracking]);
  boot(form);
  assert.equal(text.value, 'answer');
  trigger.value = 'no';
  form.dispatch('change');
  assert.equal(text.required, false);
  assert.equal(text.disabled, true);
  assert.deepEqual(
    [text.value, disabled.value, check.checked, radio.checked, select.selectedIndex, file.value],
    ['', '', false, false, -1, '']
  );
  assert.equal(tracking.value, 'tracking');
  assert.ok([...buttons, nativeButton].every((button) => button.value === 'Label'));
  trigger.value = 'yes';
  form.dispatch('input');
  assert.deepEqual(
    [text.required, text.disabled, disabled.required, disabled.disabled],
    [true, false, false, true]
  );
  assert.equal(text.value, '');
});

test('nested and reverse-order cascading branches cannot activate through unavailable controllers', () => {
  const trigger = control('root', 'no');
  const childTrigger = control('child', 'yes', { type: 'checkbox', checked: true });
  const nestedAnswer = new Element('input', {}, { required: true, value: 'nested' });
  const nested = branch('child', 'true', [nestedAnswer]);
  const parent = branch('root', 'yes', [childTrigger, nested]);
  const downstreamTrigger = control('downstream', 'answer');
  const downstream = branch('child', 'true', [downstreamTrigger]);
  const final = branch('downstream', 'answer');
  const falseBranch = branch('child', 'false');
  const disabled = control('disabled', 'yes', { disabled: true });
  const invisible = control('invisible', 'yes');
  const hiddenParent = new Element('div', {}, { hidden: true }, [invisible]);
  const disabledBranch = branch('disabled', 'yes');
  const hiddenBranch = branch('invisible', 'yes');
  const form = new Element('form', {}, {}, [
    final,
    downstream,
    falseBranch,
    trigger,
    parent,
    disabled,
    hiddenParent,
    disabledBranch,
    hiddenBranch,
  ]);
  boot(form);
  assert.ok(
    [parent, nested, downstream, final, falseBranch, disabledBranch, hiddenBranch].every(
      (wrapper) => wrapper.hidden
    )
  );
  assert.deepEqual(
    [nestedAnswer.required, nestedAnswer.disabled, nestedAnswer.value],
    [false, true, '']
  );
  trigger.value = 'yes';
  form.dispatch('change');
  assert.equal(parent.hidden, false);
  assert.equal(falseBranch.hidden, false);
  assert.equal(nested.hidden, true);
  childTrigger.checked = true;
  form.dispatch('change');
  assert.equal(nested.hidden, false);
  assert.deepEqual([nestedAnswer.required, nestedAnswer.disabled], [true, false]);
  assert.equal(final.hidden, true);
});

test('missing, malformed and ambiguous rules preserve content and emit value-free diagnostics', () => {
  const wrappers = [
    branch('missing', 'yes'),
    branch('kind', ''),
    branch('kind', 'yes||no'),
    branch('', 'yes'),
    branch('duplicate', 'yes'),
    branch('bad-radio', 'a'),
  ];
  const missingValue = new Element('div', { 'data-conditional-when': 'kind' });
  wrappers.push(missingValue);
  for (const wrapper of wrappers) {
    const answer = new Element('input', {}, { required: true, value: 'private-answer' });
    answer.parentElement = wrapper;
    wrapper.children.push(answer);
  }
  const unusual = control('a"[]', 'yes');
  const valid = branch('a"[]', 'yes');
  const { diagnostics } = boot(
    new Element('form', {}, {}, [
      control('kind', 'no'),
      control('duplicate', 'yes'),
      control('duplicate', 'no'),
      control('bad-radio', 'a', { type: 'radio', name: 'a' }),
      control('bad-radio', 'b', { type: 'radio', name: 'b' }),
      unusual,
      valid,
      ...wrappers,
    ])
  );
  assert.ok(
    wrappers.every(
      (wrapper) =>
        !wrapper.hidden &&
        wrapper.children[0].value === 'private-answer' &&
        wrapper.children[0].required
    )
  );
  assert.equal(valid.hidden, false);
  assert.equal(diagnostics.length, wrappers.length);
  assert.equal(JSON.stringify(diagnostics).includes('private-answer'), false);
});

test('reset waits for native defaults, pageshow restores state, and loading twice attaches once', () => {
  const trigger = control('kind', 'yes');
  const answer = new Element('input', {}, { value: 'initial', required: true });
  const wrapper = branch('kind', 'yes', [answer]);
  const form = new Element('form', {}, {}, [trigger, wrapper]);
  const runtime = boot(form);
  trigger.value = 'no';
  form.dispatch('input');
  runtime.again();
  assert.equal(form.listeners.get('input').length, 1);
  form.dispatch('reset');
  trigger.value = 'yes';
  answer.value = 'default';
  runtime.flush();
  assert.deepEqual(
    [wrapper.hidden, answer.required, answer.disabled, answer.value],
    [false, true, false, 'default']
  );
  trigger.value = 'no';
  runtime.window.dispatch('pageshow');
  assert.equal(wrapper.hidden, true);
  assert.equal(answer.value, '');
});

test('hiding the only required radio keeps its still-active native group required', () => {
  const trigger = control('kind', 'yes');
  const requiredRadio = new Element('input', {}, { type: 'radio', name: 'choice', required: true });
  const remainingRadio = new Element('input', {}, { type: 'radio', name: 'choice' });
  const otherRadio = new Element('input', {}, { type: 'radio', name: 'other' });
  const wrapper = branch('kind', 'yes', [requiredRadio]);
  const form = new Element('form', {}, {}, [trigger, wrapper, remainingRadio, otherRadio]);
  boot(form);
  trigger.value = 'no';
  form.dispatch('change');
  assert.deepEqual(
    [requiredRadio.required, remainingRadio.required, otherRadio.required],
    [false, true, false]
  );
  trigger.value = 'yes';
  form.dispatch('change');
  assert.deepEqual([requiredRadio.required, remainingRadio.required], [true, false]);
});

test('global loader requests the component only for form markup and catches rejection', async () => {
  const source = readFileSync('src/global.ts', 'utf8');
  const ui = source.slice(
    source.indexOf('function UIFunctions()'),
    source.indexOf('function webflowOverrides()')
  );
  for (const hasMarkup of [false, true]) {
    const requests = [];
    const errors = [];
    vm.runInNewContext(ui + '\nUIFunctions();', {
      document: {
        querySelector: (selector) => selector === 'form [data-conditional-when]' && hasMarkup,
      },
      window: {
        conditionalLoadScript() {},
        loadScript: (url) => {
          requests.push(url);
          return Promise.reject(new Error('unavailable'));
        },
      },
      duplicateMarqueeList() {},
      initDetailsGroups() {},
      TEXT_REVEAL_SELECTOR: '[data-text-reveal]',
      console: { error: (...args) => errors.push(args) },
    });
    await Promise.resolve();
    assert.deepEqual(requests, hasMarkup ? ['components/conditional-fields.js'] : []);
    assert.equal(errors.length, hasMarkup ? 1 : 0);
  }
});

test('malformed-only forms do not change unrelated native radio validation', () => {
  const disabledRequired = new Element(
    'input',
    {},
    { type: 'radio', name: 'unrelated', required: true, disabled: true }
  );
  const optional = new Element('input', {}, { type: 'radio', name: 'unrelated' });
  boot(new Element('form', {}, {}, [disabledRequired, optional, branch('missing', 'yes')]));
  assert.equal(optional.required, false);
});

for (const event of ['reset', 'pageshow']) {
  test(`${event} synchronizes affected radio siblings outside the conditional wrapper`, () => {
    const trigger = control('kind', 'yes');
    const radioA = new Element(
      'input',
      {},
      { type: 'radio', name: 'choice', required: true, checked: true }
    );
    const radioB = new Element('input', {}, { type: 'radio', name: 'choice' });
    const visualA = new Element('div', { class: 'w-radio-input w--redirected-checked' });
    const visualB = new Element('div', { class: 'w-radio-input' });
    const unrelated = new Element('input', {}, { type: 'radio', name: 'other' });
    const unrelatedVisual = new Element('div', { class: 'w-radio-input w--redirected-checked' });
    const form = new Element('form', {}, {}, [
      trigger,
      branch('kind', 'yes', [new Element('label', {}, {}, [visualA, radioA])]),
      new Element('label', {}, {}, [visualB, radioB]),
      new Element('label', {}, {}, [unrelatedVisual, unrelated]),
    ]);
    const runtime = boot(form);
    trigger.value = 'no';
    form.dispatch('change');
    assert.equal(radioB.required, true);
    radioB.checked = true;
    radioB.dispatch('change');
    visualB.classList.toggle('w--redirected-checked', true);
    trigger.value = 'yes';
    form.dispatch('change');
    if (event === 'reset') form.dispatch('reset');
    // Simulate native default restoration before the deferred reset/pageshow handler.
    radioA.checked = true;
    radioB.checked = false;
    if (event === 'pageshow') runtime.window.dispatch('pageshow');
    runtime.flush();
    assert.deepEqual(
      [
        radioA.checked,
        visualA.classList.contains('w--redirected-checked'),
        radioB.checked,
        visualB.classList.contains('w--redirected-checked'),
      ],
      [true, true, false, false]
    );
    assert.equal(unrelatedVisual.classList.contains('w--redirected-checked'), true);
  });
}

for (const type of ['checkbox', 'radio']) {
  test(`clearing a conditional ${type} removes optional Webflow sibling checked visuals`, () => {
    const trigger = control('kind', 'yes');
    const input = new Element('input', {}, { type, checked: true, name: 'choice', required: true });
    const visual = new Element('span', { class: `w-${type}-input w--redirected-checked` });
    const unrelated = new Element('span', { class: 'w--redirected-checked' });
    const wrapper = branch('kind', 'yes', [
      new Element('label', {}, {}, [visual, input, unrelated]),
    ]);
    const form = new Element('form', {}, {}, [trigger, wrapper]);
    boot(form);
    trigger.value = 'no';
    form.dispatch('change');
    trigger.value = 'yes';
    form.dispatch('change');
    assert.deepEqual(
      [input.checked, visual.classList.contains('w--redirected-checked')],
      [false, false]
    );
    assert.equal(unrelated.classList.contains('w--redirected-checked'), true);
    assert.deepEqual([input.name, input.required, input.disabled], ['choice', true, false]);
  });
}

for (const type of ['checkbox', 'radio']) {
  for (const event of ['reset', 'pageshow']) {
    test(`${event} synchronizes restored active Webflow ${type} visuals`, () => {
      const input = new Element('input', {}, { type });
      const visual = new Element('div', { class: `w-${type}-input` });
      const form = new Element('form', {}, {}, [
        control('kind', 'yes'),
        branch('kind', 'yes', [visual, input]),
      ]);
      const runtime = boot(form);
      for (const checked of [true, false]) {
        if (event === 'reset') form.dispatch('reset');
        input.checked = checked;
        if (event === 'pageshow') runtime.window.dispatch('pageshow');
        runtime.flush();
        assert.equal(visual.classList.contains('w--redirected-checked'), checked);
      }
    });
  }
  test(`visible ${type} changes leave Webflow's later document handler in control`, () => {
    const inputs = [false, true].map(
      (checked) => new Element('input', {}, { type, checked, name: 'choice' })
    );
    const visuals = inputs.map(
      (input) =>
        new Element('div', {
          class: `w-${type}-input${input.checked ? ' w--redirected-checked' : ''}`,
        })
    );
    const labels = inputs.map((input, i) => new Element('label', {}, {}, [visuals[i], input]));
    const form = new Element('form', {}, {}, [
      control('kind', 'yes'),
      branch('kind', 'yes', labels),
    ]);
    const runtime = boot(form);
    let changes = 0;
    runtime.document.addEventListener('change', ({ target }) => {
      changes++;
      if (type === 'radio')
        visuals.forEach((visual) => visual.classList.toggle('w--redirected-checked', false));
      visuals[inputs.indexOf(target)].classList.toggle(
        'w--redirected-checked',
        type === 'radio' ? true : undefined
      );
    });
    for (const index of [0, 1, 0]) {
      if (type === 'radio')
        inputs.forEach((input) => {
          input.checked = false;
        });
      inputs[index].checked = type === 'radio' || !inputs[index].checked;
      inputs[index].dispatch('input');
      inputs[index].dispatch('change');
      assert.deepEqual(
        visuals.map((visual) => visual.classList.contains('w--redirected-checked')),
        inputs.map((input) => input.checked)
      );
    }
    assert.equal(changes, 3);
  });
}
