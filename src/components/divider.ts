export {};

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const selector = '[data-divider-reveal]:not([data-divider-reveal="false"])';

if (!reduced.matches && typeof IntersectionObserver === 'function') {
  const groups = new Map<HTMLElement, { rules: HTMLElement[]; started: boolean }>();
  const vertical = (rule: HTMLElement) =>
    rule.getAttribute('data-wf--atom-divider--orientation') === 'vertical';
  const finish = (rule: HTMLElement) => {
    rule.setAttribute('data-divider-state', 'complete');
    rule.style.removeProperty('--divider-delay');
  };

  // When the centre-out horizontal sweep reaches this position, draw the upright.
  function delayAt(position: number) {
    const distance = Math.min(1, Math.abs(position - 0.5) * 2);
    if (!distance) return 0;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 30; i++) {
      const t = (low + high) / 2;
      if (3 * (1 - t) * t * t + t ** 3 < distance) low = t;
      else high = t;
    }
    const t = (low + high) / 2;
    return 1800 * (3 * (1 - t) ** 2 * t * 0.65 + 3 * (1 - t) * t * t * 0.35 + t ** 3);
  }

  document.querySelectorAll(selector).forEach((rule) => {
    if (getComputedStyle(rule).getPropertyValue('--divider-motion').trim() !== '1') return;
    const target = rule.closest('[data-pathways-rule="row"]')
      ? rule
      : (rule.closest<HTMLElement>('[data-pathways-rules]') ?? rule);
    if (!groups.has(target)) groups.set(target, { rules: [], started: false });
    groups.get(target)!.rules.push(rule);
    rule.setAttribute('data-divider-state', 'pending');
    const settle = (event: AnimationEvent) => {
      if (event.target === rule && event.animationName.startsWith('divider-reveal-')) finish(rule);
    };
    rule.addEventListener('animationend', settle);
    rule.addEventListener('animationcancel', settle);
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.15) return;
        const target = entry.target as HTMLElement;
        const group = groups.get(target);
        if (!group || group.started) return;
        group.started = true;
        observer.unobserve(target);
        const baseline = group.rules.find(
          (rule) => !vertical(rule) && !rule.closest('[data-pathways-rule]')
        );
        const bounds = (baseline ?? target).getBoundingClientRect();
        group.rules.forEach((rule) => {
          const rect = rule.getBoundingClientRect();
          if (!rect.width || !rect.height) return finish(rule);
          if (vertical(rule) && target !== rule && bounds.width) {
            rule.style.setProperty(
              '--divider-delay',
              `${delayAt((rect.left - bounds.left) / bounds.width)}ms`
            );
          }
          rule.setAttribute('data-divider-state', 'revealing');
        });
      });
    },
    { threshold: 0.15 }
  );
  groups.forEach((_, target) => observer.observe(target));
  window.addEventListener('resize', () => {
    groups.forEach((group) => {
      if (group.started) group.rules.forEach(finish);
    });
  });
  const finishAll = () => {
    observer.disconnect();
    groups.forEach((group) => group.rules.forEach(finish));
  };
  reduced.addEventListener('change', () => {
    if (reduced.matches) finishAll();
  });
  window.addEventListener('pagehide', finishAll);
}
