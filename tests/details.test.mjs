import assert from 'node:assert/strict';
import test from 'node:test';

import { initDetailsGroup, initDetailsGroups } from '../src/components/details.ts';

function createDetail() {
  const attributes = new Map();
  const listeners = new Map();

  return {
    attributes,
    listeners,
    open: false,
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    dispatchToggle() {
      listeners.get('toggle')?.();
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
}

function createGroup(itemCount = 3, defaultOpen = null, ownerDocument = null, classNames = []) {
  const items = Array.from({ length: itemCount }, createDetail);
  const attributes = new Map();
  const group = {
    classList: {
      contains: (className) => classNames.includes(className),
    },
    ownerDocument,
    getAttribute: (name) => {
      if (name === 'data-accordion-open') return defaultOpen;
      return attributes.get(name) ?? null;
    },
    querySelectorAll: (selector) => {
      assert.equal(selector, ':scope > details');
      return items;
    },
    setAttribute: (name, value) => attributes.set(name, value),
  };

  items.forEach((item) => {
    item.parentElement = group;
  });

  return { group, items };
}

test('assigns one unique native name to each details group', () => {
  const first = createGroup();
  const second = createGroup();

  initDetailsGroup(first.group, true);
  initDetailsGroup(second.group, true);

  const firstNames = first.items.map((item) => item.attributes.get('name'));
  const secondNames = second.items.map((item) => item.attributes.get('name'));

  assert.equal(new Set(firstNames).size, 1);
  assert.equal(new Set(secondNames).size, 1);
  assert.notEqual(firstNames[0], secondNames[0]);
  assert.equal(
    first.items.every((item) => item.attributes.get('data-accordion') === 'false'),
    true
  );
  assert.equal(
    second.items.every((item) => item.attributes.get('data-accordion') === 'false'),
    true
  );
  assert.equal(
    first.items.every((item) => item.listeners.size === 0),
    true
  );
  assert.equal(
    second.items.every((item) => item.listeners.size === 0),
    true
  );
});

test('skips names already used in the owning document', () => {
  const checkedNames = [];
  const ownerDocument = {
    getElementsByName: (name) => {
      checkedNames.push(name);
      return checkedNames.length === 1 ? [{}] : [];
    },
  };
  const { group, items } = createGroup(3, null, ownerDocument);

  initDetailsGroup(group, true);

  assert.equal(checkedNames.length, 2);
  assert.equal(
    items.every((item) => item.attributes.get('name') === checkedNames[1]),
    true
  );
});

test('ignores the Designer-only default index and preserves authored open state', () => {
  const { group, items } = createGroup(3, '3');
  items[1].open = true;

  initDetailsGroup(group, true);

  assert.deepEqual(
    items.map(({ open }) => open),
    [false, true, false]
  );
});

test('opens the first tab when no tabbed-content sibling is authored open', () => {
  const { group, items } = createGroup(3, null, null, ['tabbed-content_tabs']);

  initDetailsGroup(group, true);

  assert.deepEqual(
    items.map(({ open }) => open),
    [true, false, false]
  );
});

test('polyfills exclusive opening within an unsupported details group', () => {
  const { group, items } = createGroup();

  initDetailsGroup(group, false);
  items[0].open = true;
  items[1].open = true;
  items[1].dispatchToggle();

  assert.deepEqual(
    items.map(({ open }) => open),
    [false, true, false]
  );
});

test('skips a sibling group with the explicit opt-out', () => {
  const skipped = createGroup();
  skipped.group.setAttribute('data-details-group', 'false');
  const root = {
    querySelectorAll: () => skipped.items,
  };

  initDetailsGroups(root, true);

  assert.equal(
    skipped.items.every((item) => !item.attributes.has('name')),
    true
  );
});

test('initialises every parent containing direct sibling details', () => {
  const first = createGroup();
  const second = createGroup();
  const root = {
    querySelectorAll: (selector) => {
      assert.equal(selector, 'details');
      return [...first.items, ...second.items];
    },
  };

  initDetailsGroups(root, true);

  assert.equal(
    first.items.every((item) => item.attributes.has('name')),
    true
  );
  assert.equal(
    second.items.every((item) => item.attributes.has('name')),
    true
  );
});
