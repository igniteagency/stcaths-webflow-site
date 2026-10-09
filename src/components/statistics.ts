export {};

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const counters = Array.from(document.querySelectorAll('[data-statistics] [data-statistic-value]'))
  .filter((element) => /^\d+(?:\.\d+)?%?$/.test(element.textContent?.trim() ?? ''))
  .map((element) => ({
    element,
    started: false,
    done: false,
    original: Array.from(element.childNodes),
    animations: [] as Animation[],
  }));
type Counter = (typeof counters)[number];

if (
  !reduced.matches &&
  typeof IntersectionObserver === 'function' &&
  typeof Element.prototype.animate === 'function'
) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5) return;
        const counter = counters.find(({ element }) => element === entry.target);
        if (!counter || counter.started) return;
        counter.started = true;
        observer.unobserve(counter.element);
        void roll(counter);
      });
    },
    { threshold: 0.5 }
  );

  function finish(counter: Counter) {
    counter.done = true;
    counter.animations.forEach((animation) => animation.cancel());
    counter.animations = [];
    if (counter.element.hasAttribute('data-statistic-running')) {
      counter.element.replaceChildren(...counter.original);
      counter.element.removeAttribute('data-statistic-running');
    }
  }

  async function roll(counter: Counter) {
    const { element } = counter;
    try {
      await document.fonts.ready;
      if (
        counter.done ||
        reduced.matches ||
        !element.isConnected ||
        getComputedStyle(element).getPropertyValue('--statistic-motion').trim() !== '1'
      )
        return;
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const pieces: {
        text: string;
        x: number;
        y: number;
        width: number;
        height: number;
        font: string;
        spacing: string;
      }[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const style = getComputedStyle(node.parentElement!);
        for (let i = 0; i < node.length; i++) {
          if (/\s/.test(node.data[i])) continue;
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = range.getBoundingClientRect();
          pieces.push({
            text: node.data[i],
            x: rect.left - bounds.left,
            y: rect.top,
            width: rect.width,
            height: parseFloat(style.lineHeight) || rect.height,
            font: style.font,
            spacing: style.letterSpacing,
          });
        }
      }
      const source = document.createElement('span');
      source.setAttribute('data-statistic-source', '');
      source.append(...counter.original);
      const reels = document.createElement('span');
      reels.setAttribute('data-statistic-reels', '');
      reels.setAttribute('aria-hidden', 'true');
      const slots = pieces.map((piece) => {
        const slot = document.createElement('span');
        slot.setAttribute('data-statistic-slot', '');
        slot.style.setProperty('--statistic-x', `${piece.x}px`);
        slot.style.setProperty('--statistic-width', `${piece.width}px`);
        slot.style.setProperty('--statistic-height', `${piece.height}px`);
        slot.style.setProperty('--statistic-font', piece.font);
        slot.style.setProperty('--statistic-spacing', piece.spacing);
        const strip = document.createElement('span');
        strip.setAttribute('data-statistic-strip', '');
        const digit = /^\d$/.test(piece.text);
        if (digit) slot.setAttribute('data-statistic-digit', '');
        const steps = digit ? 10 + Number(piece.text) : 0;
        for (let i = 0; i <= steps; i++) {
          const cell = document.createElement('span');
          cell.setAttribute('data-statistic-cell', '');
          cell.textContent = digit ? String(i % 10) : piece.text;
          strip.append(cell);
        }
        slot.append(strip);
        reels.append(slot);
        return { slot, strip, steps, piece };
      });
      element.setAttribute('data-statistic-running', '');
      element.replaceChildren(source, reels);
      // Align to the authored glyphs, including the smaller percentage unit.
      slots.forEach(({ slot, strip, piece }) => {
        const range = document.createRange();
        range.selectNodeContents(strip.firstChild!);
        slot.style.setProperty('--statistic-y', `${piece.y - range.getBoundingClientRect().top}px`);
      });
      counter.animations = slots
        .filter(({ steps }) => steps)
        .map(({ strip, steps, piece }, index) =>
          strip.animate(
            [
              { transform: 'translateY(0)' },
              { transform: `translateY(-${steps * piece.height}px)` },
            ],
            {
              duration: 1800 + index * 90,
              delay: index * 70,
              easing: 'cubic-bezier(.22,.68,0,1)',
              fill: 'both',
            }
          )
        );
      await Promise.all(counter.animations.map((animation) => animation.finished));
      finish(counter);
    } catch (error) {
      if (!counter.done) {
        finish(counter);
        console.error('Statistic motion skipped:', error);
      }
    }
  }

  counters.forEach(({ element }) => observer.observe(element));
  const settle = () => counters.filter((counter) => counter.started).forEach(finish);
  window.addEventListener('resize', settle);
  document.fonts.addEventListener('loadingdone', settle);
  reduced.addEventListener('change', () => {
    if (!reduced.matches) return;
    observer.disconnect();
    counters.forEach(finish);
  });
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    counters.forEach(finish);
  });
}
