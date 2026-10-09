const LINK = '.button_link';
const LABEL = '.button_text';
const COMPONENT = '.button_component';
const OFF =
  '[data-button-text="off"],[data-text-reveal="off"],[data-no-text-motion],[data-no-heading-motion]';
const DISABLED = ':disabled,[disabled],[aria-disabled="true"],[inert]';
const UNSAFE = '[contenteditable]:not([contenteditable="false"]),[data-split]';
const ACCESSIBLE_TEXT_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;' +
  'clip-path:inset(50%);white-space:nowrap;border:0';

function labelsFor(link: HTMLElement) {
  const component = link.closest(COMPONENT);
  return Array.from((component ?? link).querySelectorAll<HTMLElement>(LABEL)).filter(
    (label) =>
      label.closest(COMPONENT) === component &&
      (!label.closest(LINK) || label.closest(LINK) === link)
  );
}

function enabled(element: HTMLElement) {
  return element.isConnected && !element.closest(OFF + ',' + DISABLED + ',' + UNSAFE);
}

function safeLabel(label: HTMLElement) {
  return (
    enabled(label) &&
    !label.matches('a,button,input,select,textarea,[tabindex],[role],[aria-live]') &&
    !!label.textContent?.trim() &&
    Array.from(label.childNodes).every(
      (node) => node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE
    )
  );
}

function rollLabel(label: HTMLElement) {
  const nodes = Array.from(label.childNodes);
  const text = label.textContent ?? '';
  const style = getComputedStyle(label);
  if (
    !label.getClientRects().length ||
    label.getClientRects().length > 1 ||
    style.direction !== 'ltr' ||
    style.writingMode !== 'horizontal-tb' ||
    style.visibility !== 'visible' ||
    !['block', 'inline', 'inline-block'].includes(style.display)
  )
    return null;
  const bounds = label.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const glyphs =
    typeof Intl.Segmenter === 'function'
      ? Array.from(
          new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
          (part) => part.segment
        )
      : Array.from(text);
  const textNodes = nodes.filter((node) => node.nodeType === Node.TEXT_NODE);
  const point = (offset: number, end = false): [Node, number] => {
    for (const node of textNodes) {
      const length = node.textContent?.length ?? 0;
      if (offset < length || (end && offset === length)) return [node, offset];
      offset -= length;
    }
    return [textNodes[textNodes.length - 1], offset];
  };
  let offset = 0;
  const range = document.createRange();
  const boxes = glyphs.map((glyph) => {
    range.setStart(...point(offset));
    offset += glyph.length;
    range.setEnd(...point(offset, true));
    return range.getBoundingClientRect();
  });
  const originalStyle = label.getAttribute('style');
  const restore = () => {
    label.replaceChildren(...nodes);
    // Read before restoring: Blink may not have reflected the CSSOM write yet.
    if (label.getAttribute('style') === originalStyle) return;
    if (originalStyle === null) label.removeAttribute('style');
    else label.setAttribute('style', originalStyle);
  };
  try {
    const native = document.createElement('span');
    native.setAttribute('aria-hidden', 'true');
    native.style.cssText = 'opacity:0';
    native.append(...nodes);
    const accessible = document.createElement('span');
    accessible.textContent = text;
    accessible.style.cssText = ACCESSIBLE_TEXT_STYLE;
    const visual = document.createElement('span');
    visual.setAttribute('aria-hidden', 'true');
    const padding = parseFloat(style.fontSize) * 0.2;
    const letters = glyphs.map((glyph, index) => {
      const box = boxes[index];
      const viewport = document.createElement('span');
      viewport.style.cssText =
        `position:absolute;pointer-events:none;overflow:hidden;` +
        `left:${box.left - bounds.left - label.clientLeft + label.scrollLeft - padding}px;` +
        `top:${box.top - bounds.top - label.clientTop + label.scrollTop - padding}px;` +
        `width:${box.width + padding * 2}px;height:${box.height + padding * 2}px`;
      const outgoing = document.createElement('span');
      const incoming = document.createElement('span');
      for (const copy of [outgoing, incoming]) {
        copy.textContent = glyph;
        copy.style.cssText =
          `position:absolute;display:block;white-space:pre;left:${padding}px;top:${padding}px;` +
          `height:${box.height}px;line-height:${box.height}px`;
      }
      viewport.append(outgoing, incoming);
      visual.append(viewport);
      return [outgoing, incoming];
    });
    if (style.position === 'static') label.style.position = 'relative';
    label.replaceChildren(native, accessible, visual);
    const after = label.getBoundingClientRect();
    if (
      Math.abs(after.width - bounds.width) > 0.5 ||
      Math.abs(after.height - bounds.height) > 0.5
    ) {
      restore();
      return null;
    }
    return { restore, letters };
  } catch (error) {
    restore();
    throw error;
  }
}

function createButtonText(): ButtonTextAPI {
  const bindings = new Map<
    HTMLElement,
    { labels: HTMLElement[]; cancel: () => void; dispose: () => void }
  >();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hover = window.matchMedia('(hover: hover) and (pointer: fine)');

  function cancelAll() {
    if (reduced.matches) bindings.forEach((binding) => binding.cancel());
  }
  function onPageHide() {
    bindings.forEach((binding) => binding.dispose());
  }

  function bind(link: HTMLElement, labels: HTMLElement[]) {
    let playing = false;
    let queued = false;
    let waiting = false;
    let generation = 0;
    let resize: ResizeObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    let animations: Animation[] = [];
    let restores: Array<() => void> = [];

    function cancel() {
      generation++;
      waiting = false;
      resize?.disconnect();
      resize = undefined;
      window.removeEventListener('resize', cancel);
      document.fonts?.removeEventListener('loading', cancel);
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      animations.forEach((animation) => animation.cancel());
      animations = [];
      restores.forEach((restore) => restore());
      restores = [];
      playing = queued = false;
    }
    function play() {
      if (reduced.matches || !enabled(link)) return;
      if (playing || frame !== undefined) {
        queued = true;
        return;
      }
      if (waiting) return;
      waiting = true;
      window.addEventListener('resize', cancel);
      const current = generation;
      void Promise.resolve(document.fonts?.ready)
        .then(() => {
          if (current !== generation) return;
          waiting = false;
          if (!reduced.matches && enabled(link)) start();
          else cancel();
        })
        .catch((error) => {
          if (current !== generation) return;
          console.error('Button text roll skipped:', error);
          cancel();
        });
    }
    function start() {
      const current = generation;
      let elapsed = false;
      let remaining = 0;
      function finish() {
        if (current !== generation || !elapsed || remaining) return;
        const replay = queued;
        cancel();
        if (replay)
          frame = requestAnimationFrame(() => {
            frame = undefined;
            play();
          });
      }
      function track(animation: Animation) {
        animations.push(animation);
        const finished = animation.finished;
        if (typeof finished?.then !== 'function') throw new Error('Animation.finished unavailable');
        remaining++;
        void Promise.resolve(finished)
          .then(() => {
            remaining--;
            finish();
          })
          .catch(() => {
            if (current === generation) cancel();
          });
      }
      try {
        if (
          typeof HTMLElement.prototype.animate !== 'function' ||
          typeof window.ResizeObserver !== 'function'
        )
          return cancel();
        playing = true;
        let letterCount = 0;
        const owned = labelsFor(link);
        for (const label of labels) {
          if (!owned.includes(label) || !safeLabel(label)) continue;
          const roll = rollLabel(label);
          if (!roll) continue;
          restores.push(roll.restore);
          letterCount = Math.max(letterCount, roll.letters.length);
          roll.letters.forEach(([outgoing, incoming], index) => {
            const options: KeyframeAnimationOptions = {
              duration: 500,
              delay: index * 25,
              easing: 'cubic-bezier(.16,1,.3,1)',
              fill: 'both',
            };
            track(
              outgoing.animate(
                [{ transform: 'translateY(0)' }, { transform: 'translateY(-150%)' }],
                options
              )
            );
            track(
              incoming.animate(
                [{ transform: 'translateY(150%)' }, { transform: 'translateY(0)' }],
                options
              )
            );
          });
        }
        if (!restores.length) return cancel();
        const sizes = new Map<HTMLElement, { width: number; height: number }>();
        for (const label of labels) {
          for (const target of [label, label.parentElement]) {
            if (target) sizes.set(target, target.getBoundingClientRect());
          }
        }
        if (window.ResizeObserver) {
          resize = new ResizeObserver(() => {
            for (const [target, size] of sizes) {
              const next = target.getBoundingClientRect();
              if (!target.isConnected || next.width !== size.width || next.height !== size.height)
                return cancel();
            }
          });
          sizes.forEach((_, target) => resize?.observe(target));
        }
        window.addEventListener('resize', cancel);
        document.fonts?.addEventListener('loading', cancel);
        timer = setTimeout(
          () => {
            elapsed = true;
            finish();
          },
          560 + letterCount * 25
        );
      } catch (error) {
        console.error('Button text roll skipped:', error);
        cancel();
      }
    }
    function pointerPlay(event: PointerEvent) {
      if (hover.matches && event.pointerType !== 'touch') play();
    }
    link.addEventListener('pointerenter', pointerPlay);
    link.addEventListener('pointerleave', pointerPlay);
    link.addEventListener('focus', play);
    link.addEventListener('blur', play);
    if (!bindings.size) {
      reduced.addEventListener('change', cancelAll);
      window.addEventListener('pagehide', onPageHide);
    }
    bindings.set(link, {
      labels,
      cancel,
      dispose() {
        cancel();
        link.removeEventListener('pointerenter', pointerPlay);
        link.removeEventListener('pointerleave', pointerPlay);
        link.removeEventListener('focus', play);
        link.removeEventListener('blur', play);
        bindings.delete(link);
        if (!bindings.size) {
          reduced.removeEventListener('change', cancelAll);
          window.removeEventListener('pagehide', onPageHide);
        }
      },
    });
  }
  return {
    init(root: ParentNode = document) {
      const links = Array.from(root.querySelectorAll<HTMLElement>(LINK));
      if (root instanceof HTMLElement && root.matches(LINK)) links.unshift(root);
      for (const link of links) {
        if (bindings.has(link) || !enabled(link)) continue;
        const labels = labelsFor(link).filter(safeLabel);
        if (labels.length) bind(link, labels);
      }
    },
    dispose(root: ParentNode = document) {
      for (const [link, binding] of bindings) {
        if (
          root === document ||
          root === link ||
          root.contains(link) ||
          binding.labels.some((label) => root === label || root.contains(label))
        )
          binding.dispose();
      }
    },
  };
}

window.stCathsButtonText ??= createButtonText();
window.stCathsButtonText.init();
