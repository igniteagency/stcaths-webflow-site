const AUTOPLAY_INTERVAL = 7000;
const supportsSiblingIndex = CSS.supports('z-index', 'sibling-index()');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

document.querySelectorAll('[data-image-gallery]').forEach((gallery, galleryNumber) => {
  const slides = [...gallery.querySelectorAll('[data-gallery-slide]')].slice(0, 5);
  const controls = [...gallery.querySelectorAll<HTMLButtonElement>('[data-gallery-control]')];
  const pagination = gallery.querySelector('[data-gallery-pagination]');
  const status = gallery.querySelector('[data-gallery-status]');
  if (pagination) pagination.hidden = slides.length < 2;
  if (!slides.length || controls.length !== slides.length) return;

  let current = 0;
  let manuallySelected = false;

  function sync(index: number, announce = false) {
    current = index;
    gallery.dataset.galleryIndex = String(index);
    slides.forEach((slide, i) => {
      const selected = i === index;
      slide.dataset.active = String(selected);
      slide.setAttribute('aria-hidden', String(!selected));
      slide.inert = !selected;
      controls[i].setAttribute('aria-pressed', String(selected));
    });
    if (announce && status) {
      const label = slides[index].dataset.galleryLabel;
      status.textContent = `${index + 1} of ${slides.length}${label ? `: ${label}` : ''}`;
    }
  }

  function select(index: number, manual = true) {
    if (manual) manuallySelected = true;
    gallery.setAttribute('data-gallery-immediate', '');
    sync(index, manual);
    getComputedStyle(gallery).getPropertyValue('--image-gallery-index');
    requestAnimationFrame(() => gallery.removeAttribute('data-gallery-immediate'));
  }

  slides.forEach((slide, i) => {
    if (!supportsSiblingIndex) slide.style.setProperty('--gallery-item-index', String(i));
    slide.id = `image-gallery-${galleryNumber}-slide-${i}`;
    slide.setAttribute('aria-label', `${i + 1} of ${slides.length}`);
    controls[i].setAttribute('aria-controls', slide.id);
    if (!controls[i].getAttribute('aria-label')) {
      controls[i].setAttribute('aria-label', `Show image ${i + 1} of ${slides.length}`);
    }
    controls[i].addEventListener('click', () => select(i));
    controls[i].addEventListener('keydown', (event) => {
      const next = {
        ArrowRight: (i + 1) % slides.length,
        ArrowLeft: (i + slides.length - 1) % slides.length,
        Home: 0,
        End: slides.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      controls[next].focus();
      select(next);
    });
  });

  gallery.addEventListener('transitionend', (event) => {
    if (event.target !== gallery || event.propertyName !== '--image-gallery-index') return;
    sync(Number(getComputedStyle(gallery).getPropertyValue('--image-gallery-index')));
  });
  sync(0);

  if (slides.length < 2) return;
  const timer = setInterval(() => {
    if (!gallery.isConnected) return clearInterval(timer);
    const bounds = gallery.getBoundingClientRect();
    if (
      manuallySelected ||
      reducedMotion.matches ||
      document.hidden ||
      gallery.matches(':hover, :focus-within') ||
      bounds.bottom <= 0 ||
      bounds.top >= innerHeight
    )
      return;
    select((current + 1) % slides.length, false);
  }, AUTOPLAY_INTERVAL);
});
