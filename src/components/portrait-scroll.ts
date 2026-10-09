export {};

const DESKTOP =
  '(min-width: 992px) and (min-height: 621px) and (prefers-reduced-motion: no-preference)';
const COPY = '.portrait-scroll_heading,.portrait-scroll_copy';
const TEXT =
  '.portrait-scroll_heading :is(h1,h2,h3,h4,h5,h6),.portrait-scroll_copy p:not(.button_text)';

document.querySelectorAll('[data-portrait-scroll]').forEach((section) => {
  const track = section.querySelector('.portrait-scroll_component');
  const stage = section.querySelector('.portrait-scroll_stage');
  const moments = Array.from(section.querySelectorAll('[data-portrait-moment]'));
  const images = moments.map((moment) => moment.querySelector('.portrait-scroll_visual > *'));
  const text = window.stCathsTextReveal!;
  const gsap = window.gsap;
  if (
    !track ||
    !stage ||
    !moments.length ||
    images.some((image) => !image) ||
    !text ||
    !gsap ||
    !window.ScrollTrigger ||
    getComputedStyle(section).getPropertyValue('--portrait-motion').trim() !== '1'
  )
    return;

  const texts = Array.from(section.querySelectorAll(TEXT));
  const copies = Array.from(section.querySelectorAll(COPY));
  const seen = new WeakSet<HTMLElement>();
  const revealed = new Set<number>();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const media = gsap.matchMedia();
  let active = 0;
  let requested = 0;
  let generation = 0;
  let playing = false;
  let timeline: ReturnType<typeof gsap.timeline> | undefined;
  let sync = () => {};

  function state(moment: HTMLElement, value: string) {
    moment.setAttribute('data-portrait-text-state', value);
  }
  function visible(element: HTMLElement) {
    const bounds = element.getBoundingClientRect();
    return bounds.top < innerHeight * 0.92 && bounds.bottom > 0;
  }
  function staticText() {
    if (track!.hasAttribute('data-portrait-ready') || reduced.matches) return;
    texts.forEach((target) => {
      if (seen.has(target) || !visible(target)) return;
      seen.add(target);
      void text
        .create(target)
        .then((handle) => handle?.play())
        .catch((error) => {
          console.error('Portrait text motion skipped:', error);
        });
    });
  }
  const observer = new IntersectionObserver(
    () => {
      staticText();
      sync();
    },
    { rootMargin: '0px 0px -8% 0px' }
  );
  texts.forEach((target) => observer.observe(target));

  function reset() {
    generation++;
    timeline?.kill();
    timeline = undefined;
    playing = false;
    text.dispose(section);
    gsap.set(images, { clearProps: 'transform' });
    gsap.set(copies, { clearProps: 'opacity' });
    moments.forEach((moment) => {
      moment.removeAttribute('data-leaving');
      moment.removeAttribute('data-portrait-text-state');
    });
  }
  function restore() {
    reset();
    track!.removeAttribute('data-portrait-ready');
    track!.style.removeProperty('min-height');
    moments.forEach((moment) => {
      moment.removeAttribute('data-active');
      moment.removeAttribute('aria-hidden');
      moment.inert = false;
    });
  }
  function expose(index: number) {
    moments.forEach((moment, i) => {
      moment.toggleAttribute('data-active', i === index);
      moment.setAttribute('aria-hidden', String(i !== index));
      moment.inert = i !== index;
    });
  }
  async function prepare(moment: HTMLElement, run: number) {
    const handles = await Promise.all(
      Array.from(moment.querySelectorAll(TEXT), (target) => text.create(target, { paused: true }))
    );
    if (run === generation) return handles;
    handles.forEach((handle) => handle?.revert());
    return null;
  }
  function reveal(moment: HTMLElement, handles: (TextRevealHandle | null)[]) {
    state(moment, 'visible');
    revealed.add(active);
    handles.forEach((handle) => handle?.play());
  }
  function initialText() {
    const moment = moments[active];
    if (
      playing ||
      moment.getAttribute('data-portrait-text-state') !== 'pending' ||
      !visible(stage!)
    )
      return;
    state(moment, 'preparing');
    const run = generation;
    void prepare(moment, run)
      .then((handles) => {
        if (handles) reveal(moment, handles);
      })
      .catch(fail);
  }
  function fail(error: unknown) {
    restore();
    staticText();
    console.error('Portrait panel motion skipped:', error);
  }

  function show(index: number, immediate = false) {
    requested = index;
    if (immediate) {
      reset();
      active = index;
      expose(active);
      state(moments[active], revealed.has(active) ? 'visible' : 'pending');
      initialText();
      return;
    }
    if (playing) return;
    if (index === active) return initialText();
    const previous = moments[active];
    const incoming = moments[index];
    const direction = index > active ? 1 : -1;
    const run = ++generation;
    playing = true;
    state(incoming, 'preparing');
    // Position the incoming image before exposing its panel to avoid a one-frame flash.
    gsap.set(images[index], { xPercent: direction * 100 });
    previous.setAttribute('data-leaving', '');
    active = index;
    expose(active);
    void prepare(incoming, run)
      .then((handles) => {
        if (!handles) return;
        timeline = gsap.timeline({
          onComplete: () => {
            previous.removeAttribute('data-leaving');
            gsap.set(images, { clearProps: 'transform' });
            gsap.set(previous.querySelectorAll(COPY), { clearProps: 'opacity' });
            playing = false;
            timeline = undefined;
            show(requested);
          },
        });
        timeline.to(
          previous.querySelectorAll(COPY),
          { opacity: 0, duration: 0.2, ease: 'power1.out' },
          0
        );
        timeline.call(
          () => {
            state(previous, 'hidden');
            text.dispose(previous);
          },
          [],
          0.2
        );
        timeline.call(() => reveal(incoming, handles), [], 0.22);
        timeline.to(images[index], { xPercent: 0, duration: 0.95, ease: 'power3.out' }, 0.3);
      })
      .catch(fail);
  }

  function start() {
    media.add(DESKTOP, () => {
      if (moments.length < 2 || moments.length > 5) return;
      function update(immediate = false) {
        if (!track!.hasAttribute('data-portrait-ready')) return;
        const bounds = track!.getBoundingClientRect();
        const top = parseFloat(getComputedStyle(stage!).top) || 0;
        const index = Math.min(
          moments.length - 1,
          Math.floor(Math.max(0, top - bounds.top) / (innerHeight * 0.8))
        );
        show(index, immediate || bounds.bottom < 0 || bounds.top > innerHeight);
      }
      sync = () => update();
      function measure() {
        reset();
        track!.setAttribute('data-portrait-ready', '');
        track!.style.minHeight = `${moments.length * 100}svh`;
        if (copies.some((copy) => copy.scrollHeight > stage!.clientHeight + 1)) {
          restore();
          staticText();
        } else update(true);
      }
      measure();
      const trigger = window.ScrollTrigger.create({
        trigger: track,
        start: 'top bottom',
        end: 'bottom top',
        onUpdate: () => update(),
        onRefreshInit: measure,
        onRefresh: () => update(true),
      });
      return () => {
        trigger.kill();
        sync = () => {};
        restore();
        staticText();
      };
    });
    staticText();
  }
  section.addEventListener('focusin', () => {
    if (!track.hasAttribute('data-portrait-ready')) return;
    // Keyboard focus must never land on temporarily masked copy or actions.
    show(active, true);
    state(moments[active], 'visible');
    text.dispose(moments[active]);
  });
  document.fonts?.addEventListener('loadingdone', () => window.ScrollTrigger.refresh());
  window.addEventListener('pagehide', () => {
    media.revert();
    restore();
    observer.disconnect();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      texts.forEach((target) => observer.observe(target));
      start();
    }
  });
  start();
});
