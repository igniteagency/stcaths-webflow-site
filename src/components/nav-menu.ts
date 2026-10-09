export {};

const MENU = '[data-menu-motion]';
const LABEL = '[data-menu-label]';
const HEADINGS = '[data-menu-heading],[data-menu-back]';
const REDUCED = '(prefers-reduced-motion: reduce)';

function initMenu(menu: HTMLElement) {
  const popover = menu.closest<HTMLElement>('[data-nav-menu-popover]');
  const list = menu.querySelector('[data-el="nav-group-list"]');
  const text = window.stCathsTextReveal;
  const gsap = window.gsap;
  if (!popover || !list || !text || !gsap?.timeline || menu.hasAttribute('data-menu-motion-ready'))
    return;

  const groups = Array.from(list.querySelectorAll<HTMLDetailsElement>(':scope > details'));
  const parts = Array.from(menu.querySelectorAll('[data-menu-surface]'));
  const ornament = menu.querySelector('[data-menu-ornament]');
  const reduced = matchMedia(REDUCED);
  let selected = groups.find((group) => group.open);
  let generation = 0;
  let handles: TextRevealHandle[] = [];
  let animation:
    | ReturnType<Window['gsap']['timeline']>
    | ReturnType<Window['gsap']['to']>
    | undefined;
  let pendingSwap: (() => void) | undefined;

  function cancel(settle = false) {
    generation++;
    const swap = pendingSwap;
    pendingSwap = undefined;
    animation?.revert();
    animation = undefined;
    handles.forEach((handle) => handle.revert());
    handles = [];
    text!.dispose(list!);
    if (settle) swap?.();
  }

  function visible(selector: string) {
    return Array.from(list!.querySelectorAll(selector)).filter((element) => {
      const group = element.closest('details');
      if (group && !group.open && !element.closest('summary')) return false;
      return (
        element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible'
      );
    });
  }

  async function reveal(opening = false) {
    cancel();
    if (reduced.matches || !popover!.matches(':popover-open')) return;
    const current = generation;
    try {
      await document.fonts.ready;
      // Let native details visibility and scrollbar layout settle before measuring its labels.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      if (current !== generation || reduced.matches || !popover!.matches(':popover-open')) return;
      const labels = visible(LABEL);
      const created = await Promise.all(
        labels.map((label) => text!.create(label, { preset: 'menu', paused: true }))
      );
      if (current !== generation || reduced.matches || !popover!.matches(':popover-open')) {
        created.forEach((handle) => handle?.revert());
        return;
      }
      handles = created.filter((handle): handle is TextRevealHandle => !!handle);
      const timeline = gsap.timeline({ paused: true, onComplete: () => cancel() });
      animation = timeline;
      if (opening) {
        timeline.fromTo(
          parts,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.55, stagger: 0.035, ease: 'power3.out' },
          0.08
        );
        if (ornament)
          timeline.fromTo(
            ornament,
            { rotation: -7 },
            { rotation: 0, duration: 1.4, ease: 'power2.out' },
            0.08
          );
      } else {
        timeline.fromTo(visible(HEADINGS), { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0);
      }
      created.forEach((handle, index) => {
        const at = (opening ? 0.25 : 0) + index * 0.055;
        if (handle) {
          timeline.add(handle.animation, at);
          handle.animation.paused(false);
        }
        const icons = labels[index].parentElement?.querySelectorAll('[data-menu-icon]');
        if (icons?.length)
          timeline.fromTo(
            icons,
            { opacity: 0, y: 28, rotation: 3, filter: 'blur(8px)' },
            {
              opacity: 1,
              y: 0,
              rotation: 0,
              filter: 'blur(0px)',
              duration: 0.55,
              ease: 'power3.out',
            },
            at
          );
      });
      timeline.play();
    } catch (error) {
      if (current === generation) cancel(true);
      console.error('Menu text reveal skipped:', error);
    }
  }

  // Only these menu summaries delay their native state change; ordinary accordions stay native.
  list.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const summary = target?.closest('summary');
    const group = summary?.parentElement as HTMLDetailsElement | undefined;
    if (
      !summary ||
      !group ||
      !groups.includes(group) ||
      event.defaultPrevented ||
      reduced.matches ||
      !popover.matches(':popover-open')
    )
      return;
    event.preventDefault();
    if (pendingSwap) return;
    cancel();
    const opening = !group.open;
    pendingSwap = () => {
      group.open = opening;
      selected = groups.find((item) => item.open);
      if (document.activeElement === summary) summary.focus({ preventScroll: true });
    };
    const outgoing = [...visible(LABEL).map((label) => label.parentElement!), ...visible(HEADINGS)];
    try {
      animation = gsap.to(outgoing, {
        opacity: 0,
        y: -12,
        filter: 'blur(5px)',
        duration: 0.18,
        stagger: 0.025,
        ease: 'power2.in',
        onComplete: () => {
          cancel(true);
          void reveal();
        },
      });
    } catch (error) {
      cancel(true);
      console.error('Menu panel transition skipped:', error);
    }
  });

  groups.forEach((group) => {
    group.addEventListener('toggle', () => {
      const active = groups.find((item) => item.open);
      if (active === selected) return;
      selected = active;
      void reveal();
    });
  });
  popover.addEventListener('beforetoggle', (event) => {
    if (event.target !== popover) return;
    cancel();
    if ((event as ToggleEvent).newState === 'open') {
      groups.forEach((group) => (group.open = false));
      selected = undefined;
    }
  });
  popover.addEventListener('toggle', (event) => {
    if (event.target === popover && (event as ToggleEvent).newState === 'open') void reveal(true);
  });
  list.addEventListener('focusin', (event) => {
    if (event.target instanceof Element && event.target.matches(':focus-visible')) cancel(true);
  });
  reduced.addEventListener('change', () => cancel(true));
  window.addEventListener('resize', () => cancel(true));
  window.addEventListener('pagehide', () => cancel());
  document.fonts.addEventListener('loadingdone', () => cancel(true));
  menu.setAttribute('data-menu-motion-ready', '');
  if (popover.matches(':popover-open')) void reveal();
}

document.querySelectorAll(MENU).forEach(initMenu);
