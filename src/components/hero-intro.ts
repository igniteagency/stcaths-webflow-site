export {};

const loader = document.querySelector('[data-hero-intro].is-active');
const hero = document.querySelector('[data-hero-intro-content]');

if (loader && hero && !loader.hasAttribute('data-hero-intro-ready')) {
  loader.setAttribute('data-hero-intro-ready', '');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  const text = window.stCathsTextReveal;
  const targets = Array.from(hero.querySelectorAll('h1,p'));
  let handles: TextRevealHandle[] = [];
  let timeline: ReturnType<Window['gsap']['timeline']> | undefined;
  let finished = false;
  let preparation = 0;
  const fallback = window.setTimeout(finish, 6000);

  function finish() {
    if (finished) return;
    finished = true;
    preparation++;
    clearTimeout(fallback);
    events.abort();
    timeline?.revert();
    handles.forEach((handle) => handle.revert());
    text?.dispose(hero!);
    loader!.classList.remove('is-active');
    loader!.setAttribute('data-hero-intro-state', 'complete');
  }

  const options = { signal: events.signal };
  for (const name of ['pointerdown', 'keydown', 'pagehide', 'resize']) {
    window.addEventListener(name, finish, options);
  }
  window.addEventListener(
    'scroll',
    () => {
      if (scrollY >= 40) finish();
    },
    { ...options, passive: true }
  );
  reduced.addEventListener('change', finish, options);

  const clock = loader
    .getAnimations()
    .find((animation) => (animation as CSSAnimation).animationName === 'intro-loader-hide');
  const elapsed = () =>
    clock?.startTime == null
      ? Infinity
      : (Number(document.timeline.currentTime) - Number(clock.startTime)) / 1000;
  const restored = performance
    .getEntriesByType('navigation')
    .some((entry) => (entry as PerformanceNavigationTiming).type === 'back_forward');
  document.fonts.addEventListener(
    'loadingdone',
    () => {
      if (elapsed() < 1.55) void prepare();
    },
    options
  );

  if (reduced.matches || location.hash || scrollY >= 40 || restored) finish();
  else if (text && typeof window.gsap?.timeline === 'function') void prepare();

  async function prepare() {
    const current = ++preparation;
    try {
      await document.fonts.ready;
      // Join the loader's existing clock; never replay the intro after a slow dependency load.
      if (finished || current !== preparation || elapsed() >= 1.55) return;
      timeline?.revert();
      handles.forEach((handle) => handle.revert());
      handles = [];
      const created = await Promise.all(
        targets.map((target) =>
          text!.create(target, {
            preset: target.matches('h1') ? 'heading' : 'eyebrow',
            paused: true,
          })
        )
      );
      if (finished || current !== preparation || elapsed() >= 1.65) {
        created.forEach((handle) => handle?.revert());
        return;
      }
      handles = created.filter((handle): handle is TextRevealHandle => !!handle);
      if (!handles.length) return;
      timeline = window.gsap.timeline({ paused: true });
      const now = elapsed();
      created.forEach((handle, index) => {
        if (!handle) return;
        timeline!.add(
          handle.animation,
          Math.max(0, (targets[index].matches('h1') ? 1.65 : 1.85) - now)
        );
        handle.animation.paused(false);
      });
      // Text handles can end early on a font event; the aperture and navbar still finish.
      timeline.call(finish, [], Math.max(2.6 - now, timeline.duration()));
      loader!.setAttribute('data-hero-intro-state', 'playing');
      timeline.play();
    } catch (error) {
      finish();
      console.error('Hero intro skipped:', error);
    }
  }
}
