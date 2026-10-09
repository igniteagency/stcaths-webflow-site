export {};

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

document.querySelectorAll('[data-footer-reveal]').forEach((footer) => {
  const heading = footer.querySelector('h1,h2,h3,h4,h5,h6');
  const main = footer.previousElementSibling;
  const text = window.stCathsTextReveal;
  if (!heading || footer.hasAttribute('data-footer-state')) return;

  const events = new AbortController();
  const options = { signal: events.signal };
  const rules = Array.from(footer.querySelectorAll('[data-divider-reveal]')).filter(
    (rule) => getComputedStyle(rule).getPropertyValue('--divider-motion').trim() === '1'
  );
  const triggers: ReturnType<Window['ScrollTrigger']['create']>[] = [];
  let handle: TextRevealHandle | null = null;
  let timeline: ReturnType<Window['gsap']['timeline']> | undefined;
  let started = false;
  let finished = false;
  let fallback = 0;

  // A footer taller than the screen needs normal flow so its top remains reachable.
  function fit() {
    footer.setAttribute(
      'data-footer-layout',
      footer.offsetHeight > innerHeight + 1 ? 'flow' : 'sticky'
    );
  }
  fit();
  const resize = new ResizeObserver(() => {
    fit();
    if (!finished) triggers.forEach((trigger) => trigger.refresh());
  });
  resize.observe(footer);
  if (main) resize.observe(main);

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(fallback);
    events.abort();
    triggers.forEach((trigger) => trigger.kill());
    timeline?.kill();
    handle?.revert();
    text?.dispose(footer);
    footer.setAttribute('data-footer-state', 'complete');
    rules.forEach((rule) => rule.setAttribute('data-divider-state', 'complete'));
  }
  function startFor(target: HTMLElement) {
    const bounds = target.getBoundingClientRect();
    const sticky = main && getComputedStyle(footer).position === 'sticky';
    // Intersection alone sees through the main section stacked above this footer.
    const start = sticky
      ? main.getBoundingClientRect().bottom +
        scrollY -
        Math.min(innerHeight * 0.35, Math.max(0, heading!.getBoundingClientRect().top - 12))
      : bounds.top + scrollY + Math.min(bounds.height, innerHeight * 0.7) - innerHeight * 0.85;
    return Math.max(0, Math.min(start, window.ScrollTrigger.maxScroll(window) - 1));
  }
  async function revealHeading() {
    if (started || finished) return;
    started = true;
    fallback = window.setTimeout(finish, 5000);
    try {
      handle = await text!.create(heading!, {
        preset: 'heading',
        duration: 1.8,
        stagger: 0.06,
        blur: 9,
        y: 44,
        rotation: 0,
        rotationX: 0,
        scale: 1,
        ease: 'power4.out',
        paused: true,
      });
      if (finished) return handle?.revert();
      // Release the preparation mask entirely before any glyph starts rising.
      footer.setAttribute('data-footer-state', 'playing');
      if (!handle) return footer.setAttribute('data-footer-state', 'complete');
      timeline = window.gsap.timeline({
        onComplete: () => {
          clearTimeout(fallback);
          footer.setAttribute('data-footer-state', 'complete');
        },
      });
      timeline.add(handle.animation);
      handle.animation.paused(false);
    } catch (error) {
      finish();
      console.error('Footer motion skipped:', error);
    }
  }
  function watch(target: HTMLElement, reveal: () => void) {
    const trigger = window.ScrollTrigger.create({
      trigger: target,
      start: () => startFor(target),
      once: true,
      onEnter: reveal,
      onRefresh: (self) => {
        if (self.scroll() >= self.start) reveal();
      },
    });
    triggers.push(trigger);
    if (scrollY >= trigger.start) reveal();
  }
  footer.addEventListener('focusin', finish, options);
  window.addEventListener('pagehide', () => {
    finish();
    resize.disconnect();
  });
  window.addEventListener('resize', fit);
  document.fonts.addEventListener(
    'loadingdone',
    () => {
      if (started) finish();
      else triggers.forEach((trigger) => trigger.refresh());
    },
    options
  );
  window.addEventListener(
    'resize',
    () => {
      fit();
      if (started) finish();
      else triggers.forEach((trigger) => trigger.refresh());
    },
    options
  );
  reduced.addEventListener(
    'change',
    () => {
      if (reduced.matches) finish();
    },
    options
  );

  if (
    reduced.matches ||
    !text ||
    !window.ScrollTrigger ||
    getComputedStyle(footer).getPropertyValue('--footer-motion').trim() !== '1'
  ) {
    finish();
    return;
  }
  footer.setAttribute('data-footer-state', 'pending');
  rules.forEach((rule) => {
    rule.setAttribute('data-divider-state', 'pending');
    let revealed = false;
    const settle = (event: AnimationEvent) => {
      if (event.target === rule && event.animationName.startsWith('divider-reveal-'))
        rule.setAttribute('data-divider-state', 'complete');
    };
    rule.addEventListener('animationend', settle, options);
    rule.addEventListener('animationcancel', settle, options);
    watch(rule, () => {
      if (finished || revealed) return;
      revealed = true;
      rule.setAttribute('data-divider-state', 'revealing');
    });
  });
  watch(heading, () => {
    void revealHeading();
  });
});
