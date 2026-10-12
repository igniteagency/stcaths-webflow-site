import { TegakiEngine, type TegakiBundle } from 'tegaki/core';
import { createHarfbuzzShaper } from 'tegaki/shaper-harfbuzz';

import { handwritingStep, handwritingTarget } from '$utils/handwriting-progress';

const SELECTOR = '[data-handwritten-note]';
const CAN_PIN = '(prefers-reduced-motion: no-preference) and (min-height: 500px)';
const BUNDLE_URL = new URL('../assets/handwriting/homemade-apple/tegaki.json', import.meta.url);
const instances = new Map<HTMLElement, () => void>();
let prepared: Promise<TegakiBundle> | undefined;

function prepareFont(): Promise<TegakiBundle> {
  return (prepared ??= (async () => {
    const response = await fetch(BUNDLE_URL, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Handwriting data: ${response.status}`);
    const bundle: TegakiBundle = await response.json();
    if (bundle.family !== 'Homemade Apple' || !bundle.glyphData)
      throw new Error('Invalid Homemade Apple handwriting data');
    bundle.fontUrl = new URL(bundle.fontUrl, BUNDLE_URL).href;
    const font = await fetch(bundle.fontUrl, { signal: AbortSignal.timeout(20000) });
    if (!font.ok) throw new Error(`Handwriting font: ${font.status}`);
    const bytes = await font.arrayBuffer();
    const face = await new FontFace(bundle.family, bytes).load();
    document.fonts.add(face);
    const shaper = await createHarfbuzzShaper(bundle, [bytes]);
    TegakiEngine.registerShaper((candidate) =>
      candidate === bundle ? Promise.resolve(shaper) : null
    );
    await TegakiEngine.preload(bundle);
    return bundle;
  })());
}

function mount(section: HTMLElement): (() => void) | undefined {
  const stage = section.querySelector('[data-handwritten-note-stage]');
  const note = section.querySelector('[data-handwritten-note-paper]');
  const source = section.querySelector('[data-handwritten-note-text]');
  if (
    !stage ||
    !note ||
    !source ||
    getComputedStyle(section).getPropertyValue('--handwritten-note-motion').trim() !== '1'
  )
    return;

  const renderer = document.createElement('div');
  renderer.setAttribute('data-handwritten-note-renderer', '');
  renderer.setAttribute('aria-hidden', 'true');
  source.after(renderer);
  const media = matchMedia(CAN_PIN);
  const cleanup = new AbortController();
  let engine: TegakiEngine | undefined;
  let generation = 0;
  let active = false;
  let frame = 0;
  let progress = 0;
  let target = 0;
  let lastTime = 0;
  let measure = true;
  let offscreen = false;

  function update(now: number) {
    frame = 0;
    if (!active || !engine) return;
    if (!section.isConnected) return dispose();
    if (measure) {
      measure = false;
      const bounds = section.getBoundingClientRect();
      target = handwritingTarget(bounds.top, stage!.offsetHeight);
      offscreen = bounds.top >= innerHeight || bounds.bottom <= 0;
    }
    // Preserve actual ink when a fling skips the section; never finish it offscreen.
    if (offscreen) {
      lastTime = 0;
      return;
    }
    progress = handwritingStep(progress, target, lastTime ? (now - lastTime) / 1000 : 1 / 60);
    lastTime = now;
    engine.update({ time: { mode: 'controlled', unit: 'progress', value: progress } });
    if (progress !== target) frame = requestAnimationFrame(update);
    else lastTime = 0;
  }

  function schedule() {
    measure = true;
    if (active && !frame && !document.hidden) frame = requestAnimationFrame(update);
  }

  function fit() {
    if (!active) return;
    const style = getComputedStyle(stage!);
    const available =
      stage!.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    note!.style.setProperty(
      '--handwritten-note-scale',
      String(Math.min(1, available / Math.max(1, note!.offsetHeight)))
    );
    schedule();
  }

  function enable() {
    const next = Boolean(engine?.duration) && media.matches;
    if (next === active) return;
    active = next;
    progress = 0;
    lastTime = 0;
    cancelAnimationFrame(frame);
    frame = 0;
    engine?.update({ time: { mode: 'controlled', unit: 'progress', value: 0 } });
    section.toggleAttribute('data-handwriting-ready', active);
    if (active) fit();
    else note!.style.removeProperty('--handwritten-note-scale');
    window.ScrollTrigger?.refresh();
  }

  async function initialize() {
    const run = ++generation;
    const text = source!.textContent?.normalize('NFC').trim() ?? '';
    if (!media.matches || !text) return;
    section.dataset.handwritingState = 'loading';
    try {
      const bundle = await prepareFont();
      if (cleanup.signal.aborted || run !== generation || !section.isConnected) return;
      if ([...text].some((char) => !/\s/u.test(char) && !bundle.glyphData[char])) {
        section.dataset.handwritingState = 'unsupported';
        return;
      }
      engine = new TegakiEngine(renderer, {
        text,
        font: bundle,
        time: { mode: 'controlled', unit: 'progress', value: 0 },
        reducedMotion: 'user',
        // The font outline supplies ink weight; a uniform reveal brush keeps long notes fast.
        pressure: 0,
        quality: { clipText: 2, smoothing: true, segmentSize: 1 },
        timing: { glyphGap: 0.025, wordGap: 0.12, lineGap: 0.2, strokeEasing: (t) => t },
        onChangeTimeline: () => {
          queueMicrotask(() => {
            if (cleanup.signal.aborted || run !== generation) return;
            enable();
            fit();
          });
        },
      });
      section.dataset.handwritingState = 'ready';
      enable();
    } catch (error) {
      if (cleanup.signal.aborted || run !== generation) return;
      engine?.destroy();
      engine = undefined;
      enable();
      section.dataset.handwritingState = 'error';
      console.error('Handwritten note unavailable; showing the original text:', error);
    }
  }

  function reset() {
    generation++;
    engine?.destroy();
    engine = undefined;
    enable();
    renderer.replaceChildren();
    section.dataset.handwritingState = 'static';
  }

  function dispose() {
    reset();
    cleanup.abort();
    resize.disconnect();
    edits.disconnect();
    renderer.remove();
    delete section.dataset.handwritingState;
    instances.delete(section);
  }

  const options = { signal: cleanup.signal };
  media.addEventListener(
    'change',
    () => {
      reset();
      void initialize();
    },
    options
  );
  addEventListener('scroll', schedule, { ...options, passive: true });
  addEventListener('resize', fit, options);
  addEventListener('pageshow', schedule, options);
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        lastTime = 0;
      } else schedule();
    },
    options
  );
  const resize = new ResizeObserver(fit);
  resize.observe(stage);
  resize.observe(note);
  const edits = new MutationObserver(() => {
    reset();
    void initialize();
  });
  edits.observe(source, { childList: true, characterData: true, subtree: true });
  section.dataset.handwritingState = 'static';
  void initialize();
  return dispose;
}

window.stCathsHandwriting = {
  init(root: ParentNode = document) {
    const sections = [...root.querySelectorAll(SELECTOR)];
    if (root instanceof HTMLElement && root.matches(SELECTOR)) sections.unshift(root);
    for (const section of sections) {
      if (instances.has(section)) continue;
      const dispose = mount(section);
      if (dispose) instances.set(section, dispose);
    }
  },
  dispose(root: ParentNode = document) {
    for (const [section, dispose] of instances)
      if (section === root || root.contains(section)) dispose();
  },
};
window.stCathsHandwriting.init();
