import { splitText } from 'kugiri';

import {
  TEXT_REVEAL_EYEBROWS,
  TEXT_REVEAL_PRESETS,
  TEXT_REVEAL_SELECTOR,
} from '$utils/text-motion-settings';

const OFF = '[data-text-reveal="off"],[data-no-text-motion],[data-no-heading-motion]';
const MANUAL = '[data-text-trigger="manual"]';
const INTERACTIVE =
  'a,button,summary,label,input,select,textarea,[inert],[onclick],[onkeydown],' +
  '[contenteditable]:not([contenteditable="false"]),' +
  '[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],' +
  '[role="tab"],[role^="menuitem"],[role="option"],[role="combobox"],[role="listbox"],' +
  '[role="slider"],[role="spinbutton"],[role="textbox"],[role="searchbox"],[role="treeitem"]';
const NON_TEXT = 'img,picture,svg,video,audio,canvas,iframe,table,script,style,object,embed';
const UNSAFE_INLINE = '[id],[name],[tabindex],[role]';
const CHANGED_ATTRIBUTES = ['aria-label', 'data-split', 'style'];
const LINK_KEY = 'data-text-reveal-link';
const ACCESSIBLE_TEXT_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;' +
  'clip-path:inset(50%);white-space:nowrap;border:0';

function isSafe(element: HTMLElement, automatic: boolean) {
  const role = element.getAttribute('role');
  return (
    !!element.textContent?.trim() &&
    (!role || role === 'heading' || role === 'paragraph') &&
    !element.closest(OFF) &&
    !element.closest(NON_TEXT) &&
    !element.matches(INTERACTIVE + ',[tabindex],' + NON_TEXT) &&
    !element.closest('[inert],[contenteditable]:not([contenteditable="false"])') &&
    !(automatic && element.closest(INTERACTIVE + ',[tabindex]:not([tabindex="-1"]),' + MANUAL)) &&
    !element.querySelector(OFF + ',' + NON_TEXT + ',input,select,textarea,button,summary') &&
    !element.querySelector(TEXT_REVEAL_SELECTOR + ',ul,ol,li,blockquote')
  );
}

function isMeasurable(element: HTMLElement) {
  if (!element.isConnected || !element.getClientRects().length) return false;
  if (
    element.checkVisibility &&
    !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  )
    return false;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.visibility !== 'visible' || style.opacity === '0') return false;
  }
  const { width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0;
}

function snapshot(element: HTMLElement, split: boolean) {
  // Range.extractContents mutates original descendants as well as the host's children.
  function save(node: Node): () => void {
    const children = Array.from(node.childNodes);
    const restores = children.map(save);
    const value = node.nodeValue;
    const attributes =
      node instanceof Element && node !== element
        ? new Map(Array.from(node.attributes, ({ name, value }) => [name, value]))
        : undefined;
    return () => {
      restores.forEach((restore) => restore());
      if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) {
        node.nodeValue = value;
      } else if (node instanceof Element) {
        node.replaceChildren(...children);
        if (attributes) {
          node.getAttribute('style');
          for (const { name } of Array.from(node.attributes)) {
            if (!attributes.has(name)) node.removeAttribute(name);
          }
          attributes.forEach((value, name) => {
            if (node.getAttribute(name) !== value) node.setAttribute(name, value);
          });
        }
      }
    };
  }
  const restoreNodes = split ? save(element) : undefined;
  const attributes = CHANGED_ATTRIBUTES.map((name) => [name, element.getAttribute(name)] as const);
  return () => {
    restoreNodes?.();
    attributes.forEach(([name, value]) => {
      // Read first: Blink may not have reflected a lazy CSSOM write into attributes yet.
      if (element.getAttribute(name) === value) return;
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    });
  };
}

function presetFor(element: HTMLElement): TextRevealPreset {
  const preset = element.getAttribute('data-text-reveal');
  if (preset && Object.hasOwn(TEXT_REVEAL_PRESETS, preset)) return preset as TextRevealPreset;
  if (preset === 'chars') return 'heading';
  if (element.matches(TEXT_REVEAL_EYEBROWS)) return 'eyebrow';
  return /^H[1-6]$/.test(element.tagName) ? 'heading' : 'paragraph';
}

function createTextReveal(): TextRevealAPI {
  const seen = new WeakSet<HTMLElement>();
  const active = new Map<HTMLElement, () => void>();

  function track(element: HTMLElement, automatic: boolean, options: TextRevealOptions = {}) {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let container = element.parentElement;
    while (container && !container.clientWidth) container = container.parentElement;
    let done = false;
    let preparing = false;
    let restore: (() => void) | undefined;
    let revertSplit: (() => void) | undefined;
    let animation: TextRevealHandle['animation'] | undefined;
    let trigger: ReturnType<Window['ScrollTrigger']['create']> | undefined;
    let width = 0;
    let parentWidth = 0;
    const originalLinks = new Map<HTMLElement, HTMLElement>();

    function finish() {
      if (done) return;
      done = true;
      const focused = document.activeElement?.closest<HTMLElement>('a');
      const restoreFocus = focused && originalLinks.get(focused);
      active.delete(element);
      resize.disconnect();
      visibility.disconnect();
      motion.removeEventListener('change', onMotion);
      document.fonts?.removeEventListener('loadingdone', onFonts);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pagehide', finish);
      element.removeEventListener('focusin', onFocus);
      try {
        trigger?.kill();
        animation?.kill();
        revertSplit?.();
      } catch (error) {
        console.error('Text reveal cleanup:', error);
      } finally {
        restore?.();
        restoreFocus?.focus({ preventScroll: true });
        originalLinks.clear();
      }
    }
    function onMotion() {
      if (motion.matches) finish();
    }
    function onFocus() {
      // Leave pointer activation on its live anchor; Tab focus needs readable text now.
      if (document.activeElement?.matches(':focus-visible')) finish();
    }
    function onResize() {
      if (restore) finish();
    }
    function onFonts() {
      if (restore) finish();
      else refresh();
    }
    function pastStart() {
      return !!trigger && trigger.scroll() >= trigger.start;
    }
    async function prepare(): Promise<TextRevealHandle | null> {
      if (done || preparing || restore || !isMeasurable(element)) return null;
      if (automatic && !pastStart()) return null;
      preparing = true;
      try {
        await document.fonts?.ready;
        if (done) return null;
        if (
          !isSafe(element, automatic) ||
          motion.matches ||
          !isMeasurable(element) ||
          element.contains(document.activeElement)
        ) {
          finish();
          return null;
        }
        if (automatic && !pastStart()) return null;
        trigger?.kill();
        visibility.disconnect();
        const settings = { ...TEXT_REVEAL_PRESETS[options.preset ?? presetFor(element)] };
        for (const key of [
          'duration',
          'stagger',
          'delay',
          'blur',
          'rotation',
          'rotationX',
          'y',
          'x',
          'opacity',
          'scale',
        ] as const) {
          const value = options[key];
          if (typeof value === 'number' && Number.isFinite(value)) {
            Object.assign(settings, {
              [key]: ['duration', 'stagger', 'delay', 'blur'].includes(key)
                ? Math.max(0, value)
                : value,
            });
          }
        }
        const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        // Preserve IDs/state, named descendants, and link semantics in character/word reveals.
        const whole =
          !!element.querySelector(UNSAFE_INLINE) ||
          Array.from(element.querySelectorAll('*')).some((child) =>
            Array.from(child.attributes).some(({ name }) => name.startsWith('aria-'))
          ) ||
          !!element.querySelector(INTERACTIVE.replace(/^a,/, '')) ||
          (settings.type !== 'lines' && !!element.querySelector('a'));
        restore = snapshot(element, !whole);
        let parts: HTMLElement[] = [element];
        if (!whole) {
          const links = Array.from(element.querySelectorAll('a'));
          const keys = links.map((link) => link.getAttribute(LINK_KEY));
          links.forEach((link, index) => link.setAttribute(LINK_KEY, String(index)));
          const split = splitText(element, { type: [settings.type] });
          revertSplit = split.revert;
          element.querySelectorAll('a').forEach((link) => {
            const index = Number(link.getAttribute(LINK_KEY));
            const original = links[index];
            if (!original) return;
            originalLinks.set(link, original);
            const key = keys[index];
            if (key == null) link.removeAttribute(LINK_KEY);
            else link.setAttribute(LINK_KEY, key);
          });
          // Restore readable native links as soon as keyboard focus enters the split.
          if (originalLinks.size) element.addEventListener('focusin', onFocus);
          parts = split[settings.type];
          if (!parts.length) {
            finish();
            return null;
          }
          if (settings.type !== 'lines') {
            split.lines.forEach((line) => line.setAttribute('aria-hidden', 'true'));
            if (/^H[1-6]$/.test(element.tagName)) {
              if (
                !element.getAttribute('aria-label')?.trim() &&
                !element.hasAttribute('aria-labelledby')
              )
                element.setAttribute('aria-label', text);
            } else {
              const accessibleText = document.createElement('span');
              accessibleText.textContent = text;
              accessibleText.style.cssText = ACCESSIBLE_TEXT_STYLE;
              element.appendChild(accessibleText);
            }
          }
        }
        width = element.clientWidth;
        parentWidth = container?.clientWidth ?? 0;
        animation = window.gsap.fromTo(
          parts,
          {
            x: settings.x,
            y: settings.y,
            rotation: settings.rotation,
            rotationX: settings.rotationX,
            scale: settings.scale,
            opacity: settings.opacity,
            filter: `blur(${settings.blur}px)`,
            transformOrigin: settings.transformOrigin,
            transformPerspective: settings.transformPerspective,
            willChange: 'transform,filter,opacity',
          },
          {
            x: 0,
            y: 0,
            rotation: 0,
            rotationX: 0,
            scale: 1,
            opacity: 1,
            filter: 'blur(0px)',
            duration: settings.duration,
            delay: settings.delay,
            ease: settings.ease,
            stagger: { each: settings.stagger, from: settings.from },
            paused: options.paused ?? !automatic,
            immediateRender: true,
            onComplete: finish,
            onInterrupt(this: TextRevealHandle['animation']) {
              if (animation && this === animation) queueMicrotask(finish);
            },
          }
        );
        return {
          animation,
          play() {
            if (!done) animation?.play();
          },
          revert: finish,
        };
      } catch (error) {
        console.error('Text reveal skipped:', error);
        finish();
        return null;
      } finally {
        preparing = false;
      }
    }
    function refresh() {
      if (done) return;
      if (!element.isConnected || !isSafe(element, automatic)) return finish();
      if (restore || !automatic || !isMeasurable(element)) return;
      try {
        if (!trigger) {
          trigger = window.ScrollTrigger.create({
            trigger: element,
            // Equivalent to clamp(top 92%), including per-target refreshes. Leave one
            // scrollable pixel for onEnter at the page end, as GSAP's global clamp does.
            start: () =>
              Math.max(
                0,
                Math.min(
                  element.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.92,
                  window.ScrollTrigger.maxScroll(window) - 1
                )
              ),
            once: true,
            onEnter: () => {
              void prepare();
            },
            onRefresh: () => {
              void prepare();
            },
          });
        } else trigger.refresh();
        // ScrollTrigger may suppress initial callbacks for targets already beyond its end.
        void prepare();
      } catch (error) {
        console.error('Text reveal skipped:', error);
        finish();
      }
    }
    const resize = new ResizeObserver(() => {
      if (
        !element.isConnected ||
        (restore &&
          (element.clientWidth !== width || (container?.clientWidth ?? 0) !== parentWidth))
      )
        finish();
      else if (!restore) refresh();
    });
    const visibility = new MutationObserver(refresh);
    if (automatic) {
      for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
        visibility.observe(parent, {
          attributes: true,
          attributeFilter: [
            'class',
            'style',
            'hidden',
            'open',
            'data-text-reveal',
            'data-text-trigger',
          ],
          childList: true,
        });
      }
    }
    active.set(element, finish);
    motion.addEventListener('change', onMotion);
    document.fonts?.addEventListener('loadingdone', onFonts);
    window.addEventListener('resize', onResize);
    window.addEventListener('pagehide', finish);
    resize.observe(element);
    if (container) resize.observe(container);
    return { prepare, refresh };
  }

  function available() {
    return (
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      typeof window.gsap?.fromTo === 'function' &&
      !!window.ResizeObserver &&
      !!window.MutationObserver
    );
  }
  return {
    init(root: ParentNode = document) {
      const targets = Array.from(root.querySelectorAll<HTMLElement>(TEXT_REVEAL_SELECTOR));
      if (root instanceof HTMLElement && root.matches(TEXT_REVEAL_SELECTOR)) targets.unshift(root);
      targets.forEach((element) => {
        if (seen.has(element) || !isSafe(element, true)) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          seen.add(element);
          return;
        }
        if (!available() || typeof window.ScrollTrigger?.create !== 'function') return;
        window.gsap.registerPlugin?.(window.ScrollTrigger);
        seen.add(element);
        track(element, true).refresh();
      });
    },
    async create(element, options = {}) {
      active.get(element)?.();
      seen.add(element);
      if (!available() || !isSafe(element, false) || !isMeasurable(element)) return null;
      return track(element, false, options).prepare();
    },
    dispose(root: ParentNode = document) {
      for (const [element, finish] of active) {
        if (root === element || root.contains(element)) finish();
      }
    },
  };
}

window.stCathsTextReveal ??= createTextReveal();
window.stCathsTextReveal.init();
