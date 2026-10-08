import { splitText } from 'kugiri';

const SELECTOR = '[data-text-reveal="chars"]';
const TEXT_TAGS = 'h1,h2,h3,h4,h5,h6,p';
const INTERACTIVE =
  'a,button,summary,label,input,select,textarea,[tabindex],[inert],[onclick],[onkeydown],' +
  '[contenteditable]:not([contenteditable="false"]),' +
  '[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],' +
  '[role="tab"],[role^="menuitem"],[role="option"],[role="combobox"],[role="listbox"],' +
  '[role="slider"],[role="spinbutton"],[role="textbox"],[role="searchbox"],[role="treeitem"]';
const CHANGED_ATTRIBUTES = ['aria-label', 'data-split', 'style'];

function isSafe(element: HTMLElement) {
  const role = element.getAttribute('role');
  return (
    element.matches(TEXT_TAGS) &&
    (!role || role === (element.tagName === 'P' ? 'paragraph' : 'heading')) &&
    !element.closest(INTERACTIVE) &&
    !!element.textContent?.trim() &&
    Array.from(element.childNodes).every((node) => node.nodeType === Node.TEXT_NODE)
  );
}

function isMeasurable(element: HTMLElement) {
  if (!element.isConnected || !element.getClientRects().length) return false;
  if (
    element.checkVisibility &&
    !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  ) {
    return false;
  }
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.visibility !== 'visible' || style.opacity === '0') return false;
  }
  const { width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0;
}

function reveal(element: HTMLElement) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (
    motion.matches ||
    typeof window.gsap?.fromTo !== 'function' ||
    !window.IntersectionObserver ||
    !window.ResizeObserver
  ) {
    return;
  }

  let done = false;
  let preparing = false;
  let inView = false;
  let restore: (() => void) | undefined;
  let revertSplit: (() => void) | undefined;
  let tween: ReturnType<typeof window.gsap.fromTo> | undefined;
  let width = 0;

  function finish() {
    if (done) return;
    done = true;
    intersection.disconnect();
    resize.disconnect();
    visibility.disconnect();
    motion.removeEventListener('change', onMotion);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', finish);
    try {
      tween?.kill();
      revertSplit?.();
    } catch (error) {
      console.error('Text reveal cleanup:', error);
    } finally {
      restore?.();
    }
  }

  function onMotion() {
    if (motion.matches) finish();
  }

  function onResize() {
    if (restore) finish();
  }

  async function start() {
    if (done || preparing || restore || !inView) return;
    if (!element.isConnected) return finish();
    if (!isMeasurable(element)) return;
    preparing = true;
    try {
      await document.fonts?.ready;
      if (done || !inView || !isMeasurable(element)) return;
      if (motion.matches || !isSafe(element) || typeof window.gsap?.fromTo !== 'function') {
        return finish();
      }

      const text = element.textContent ?? '';
      const nodes = Array.from(element.childNodes, (node) => ({ node, text: node.textContent }));
      const attributes = CHANGED_ATTRIBUTES.map(
        (name) => [name, element.getAttribute(name)] as const
      );
      // Keep our own snapshot: a splitter can throw after partially changing the DOM.
      restore = () => {
        nodes.forEach(({ node, text }) => {
          node.textContent = text;
        });
        element.replaceChildren(...nodes.map(({ node }) => node));
        attributes.forEach(([name, value]) => {
          // Synchronize lazy CSSOM style writes before removing an absent authored attribute.
          if (element.getAttribute(name) === value) return;
          if (value === null) element.removeAttribute(name);
          else element.setAttribute(name, value);
        });
      };

      const split = splitText(element, { type: ['chars'] });
      revertSplit = split.revert;
      if (!split.chars.length) return finish();
      split.lines.forEach((line) => line.setAttribute('aria-hidden', 'true'));
      split.chars.forEach((char) => char.setAttribute('aria-hidden', 'true'));
      if (element.tagName === 'P') {
        // Paragraphs cannot take an accessible name; retain one native text alternative.
        const accessibleText = document.createElement('span');
        accessibleText.textContent = text;
        accessibleText.style.cssText =
          'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;' +
          'clip-path:inset(50%);white-space:nowrap;border:0';
        element.appendChild(accessibleText);
      } else if (!element.getAttribute('aria-label')?.trim()) {
        element.setAttribute('aria-label', text);
      }

      width = element.clientWidth;
      intersection.disconnect();
      visibility.disconnect();
      window.addEventListener('resize', onResize);
      tween = window.gsap.fromTo(
        split.chars,
        { opacity: 0, y: '0.35em' },
        {
          opacity: 1,
          y: 0,
          duration: 0.55,
          stagger: { amount: 0.45 },
          ease: 'power2.out',
          onComplete: finish,
          onInterrupt(this: ReturnType<typeof window.gsap.fromTo>) {
            // Ignore internal initialization tweens and let GSAP finish rendering before cleanup.
            if (tween && this === tween) queueMicrotask(finish);
          },
        }
      );
    } catch (error) {
      console.error('Text reveal skipped:', error);
      finish();
    } finally {
      preparing = false;
    }
  }

  const intersection = new IntersectionObserver((entries) => {
    inView = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0);
    void start();
  });
  const resize = new ResizeObserver(() => {
    if (!element.isConnected || (restore && element.clientWidth !== width)) finish();
    else void start();
  });
  const visibility = new MutationObserver(() => {
    void start();
  });
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    visibility.observe(parent, {
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open'],
    });
  }
  motion.addEventListener('change', onMotion);
  window.addEventListener('pagehide', finish);
  intersection.observe(element);
  resize.observe(element);
}

function createTextReveal() {
  const seen = new WeakSet<HTMLElement>();
  return {
    init(root: ParentNode = document) {
      const targets = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR));
      if (root instanceof HTMLElement && root.matches(SELECTOR)) targets.unshift(root);
      targets.forEach((element) => {
        if (seen.has(element) || !isSafe(element)) return;
        seen.add(element);
        reveal(element);
      });
    },
  };
}

window.stCathsTextReveal ??= createTextReveal();
window.stCathsTextReveal.init();
