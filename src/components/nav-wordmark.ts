export {};

const SVG_NS = 'http://www.w3.org/2000/svg';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// Keep the authored contours, including each letter's counters and the dotted i.
function splitWordmark(svg: SVGSVGElement): SVGPathElement[] {
  const source = svg.querySelector<SVGPathElement>(':scope > path');
  const d = source?.getAttribute('d');
  if (!source || !d || /m/.test(d) || svg.children.length !== 1) return [];
  const probe = document.createElementNS(SVG_NS, 'g');
  probe.setAttribute('visibility', 'hidden');
  svg.append(probe);
  try {
    const contours = (d.match(/M[^M]*/g) ?? []).map((data, index) => {
      const path = source.cloneNode(false) as SVGPathElement;
      path.removeAttribute('id');
      path.setAttribute('d', data);
      probe.append(path);
      return { data, index, box: path.getBBox() };
    });
    const mid = svg.viewBox.baseVal.y + svg.viewBox.baseVal.height / 2;
    const letters = contours.filter(({ box }) => box.y < mid).sort((a, b) => a.box.x - b.box.x);
    const groups: { right: number; contours: typeof contours }[] = [];
    letters.forEach((contour) => {
      const last = groups.at(-1);
      if (last && contour.box.x < last.right) {
        last.contours.push(contour);
        last.right = Math.max(last.right, contour.box.x + contour.box.width);
      } else groups.push({ right: contour.box.x + contour.box.width, contours: [contour] });
    });
    const establishment = contours.filter(({ box }) => box.y >= mid);
    // This artwork has nineteen letters/punctuation marks and one establishment line.
    if (groups.length !== 19 || !establishment.length) return [];
    groups.push({ right: 0, contours: establishment });
    return groups.map((group) => {
      const path = source.cloneNode(false) as SVGPathElement;
      path.removeAttribute('id');
      path.setAttribute('data-nav-wordmark-part', '');
      path.setAttribute(
        'd',
        group.contours
          .sort((a, b) => a.index - b.index)
          .map((c) => c.data)
          .join(' ')
      );
      return path;
    });
  } finally {
    probe.remove();
  }
}

document.querySelectorAll('[data-nav-wordmark]').forEach((brand) => {
  const svg = brand.querySelector<SVGSVGElement>('.logo_wordmark');
  if (
    !svg ||
    typeof window.gsap?.to !== 'function' ||
    brand.hasAttribute('data-nav-wordmark-ready') ||
    getComputedStyle(brand).getPropertyValue('--nav-wordmark-motion').trim() !== '1'
  )
    return;
  const original = Array.from(svg.childNodes);
  const originalAria = brand.getAttribute('aria-hidden');
  const originalInert = brand.inert;
  const navbar = brand.closest('.navbar-wrapper');
  const menu = navbar?.querySelector('[data-nav-menu-popover]');
  const search = navbar?.querySelector<HTMLDialogElement>('dialog');
  let parts: SVGPathElement[] = [];
  let tween: ReturnType<Window['gsap']['to']> | undefined;
  let hidden = false;
  let queued = false;
  let travel = 0;
  const position = () =>
    Math.max(0, Math.min(scrollY, document.documentElement.scrollHeight - innerHeight));
  let previous = position();
  let overlay = false;
  brand.setAttribute('data-nav-wordmark-ready', '');

  function accessibility(hide: boolean) {
    brand.inert = hide || originalInert;
    if (hide) brand.setAttribute('aria-hidden', 'true');
    else if (originalAria === null) brand.removeAttribute('aria-hidden');
    else brand.setAttribute('aria-hidden', originalAria);
  }
  function animate(hide: boolean, immediate = false) {
    hidden = hide;
    tween?.kill();
    accessibility(hide);
    brand.setAttribute('data-nav-wordmark-state', hide ? 'hiding' : 'showing');
    // Convert screen pixels to SVG units so the rise stays 50px at every breakpoint.
    const units = svg!.viewBox.baseVal.width / Math.max(1, svg!.getBoundingClientRect().width);
    tween = window.gsap.to(parts, {
      '--nav-wordmark-y': `${hide ? -50 * units : 0}px`,
      opacity: hide ? 0 : 1,
      duration: immediate ? 0 : hide ? 0.55 : 0.5,
      stagger: immediate ? 0 : 0.006,
      ease: 'power3.out',
      onComplete: () => brand.setAttribute('data-nav-wordmark-state', hide ? 'hidden' : 'visible'),
    });
  }
  function restore() {
    tween?.kill();
    svg!.replaceChildren(...original);
    parts = [];
    hidden = false;
    accessibility(false);
    brand.removeAttribute('data-nav-wordmark-state');
  }
  function prepare() {
    if (reduced.matches) return restore();
    if (!parts.length) {
      parts = splitWordmark(svg!);
      if (!parts.length) return;
      svg!.replaceChildren(...parts);
    }
    previous = position();
    travel = 0;
    animate(previous > 660 && !brand.contains(document.activeElement), true);
  }
  function update() {
    queued = false;
    const current = position();
    const delta = current - previous;
    previous = current;
    if (overlay || reduced.matches || !parts.length) return;
    if (delta) travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
    let next = hidden;
    if (current <= 580 || travel <= -12 || brand.contains(document.activeElement)) next = false;
    else if (current > 660 && travel >= 12) next = true;
    if (next !== hidden) animate(next);
  }
  function schedule() {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  }
  function overlayChanged() {
    overlay = !!(menu?.matches(':popover-open') || search?.open);
    previous = position();
    travel = 0;
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', () => {
    if (parts.length) animate(hidden, true);
    previous = position();
    travel = 0;
  });
  brand.addEventListener('focusin', () => {
    if (parts.length) animate(false, true);
  });
  brand.addEventListener('focusout', schedule);
  menu?.addEventListener('toggle', overlayChanged);
  if (search)
    new MutationObserver(overlayChanged).observe(search, {
      attributes: true,
      attributeFilter: ['open'],
    });
  reduced.addEventListener('change', prepare);
  window.addEventListener('pagehide', restore);
  window.addEventListener('pageshow', prepare);
  overlayChanged();
  prepare();
});
