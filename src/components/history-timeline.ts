import Swiper from 'swiper';
import { A11y, Navigation } from 'swiper/modules';

const hook = (name: string) => `[data-history-timeline="${name}"]`;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function initTimeline(component: HTMLElement) {
  const section = component.closest('section');
  const track = component.querySelector<HTMLElement>(hook('track'));
  const template = component.querySelector<HTMLButtonElement>(hook('nav-template'));
  const main = track?.parentElement;
  const navTrack = template?.parentElement;
  const rail = navTrack?.parentElement;
  const dialog = section?.querySelector<HTMLDialogElement>(hook('lightbox'));
  if (!main || !track || !rail || !navTrack || !template || !dialog) return;
  const slides = Array.from(track.children) as HTMLElement[];
  if (!slides.length || component.dataset.historyReady) return;
  component.dataset.historyReady = 'true';

  const buttons = slides.map((slide, index) => {
    const button = template.cloneNode(true) as HTMLButtonElement;
    const year = slide.querySelector<HTMLElement>('[data-history-year]')?.dataset.historyYear || '';
    button.removeAttribute('data-history-timeline');
    button.querySelector('[data-history-year]')!.textContent = year;
    button.setAttribute('aria-label', `Go to ${year}`);
    button.addEventListener('click', () => swiper.slideToLoop(index));
    return button;
  });
  navTrack.replaceChildren(...buttons);
  const speed = () => (reducedMotion.matches ? 0 : 700);
  const nav = new Swiper(rail, {
    wrapperClass: 'history-timeline_nav-swiper-wrapper',
    slideClass: 'history-timeline_nav-swiper-slide',
    slidesPerView: 'auto',
    speed: speed(),
    watchSlidesProgress: true,
  });
  const swiper = new Swiper(main, {
    modules: [Navigation, A11y],
    wrapperClass: 'history-timeline_wrapper',
    slideClass: 'history-timeline_slide',
    slidesPerView: 1,
    loop: slides.length > 1,
    speed: speed(),
    autoHeight: true,
    navigation: {
      prevEl: component.querySelector<HTMLElement>('[data-slider-el="nav-prev"]'),
      nextEl: component.querySelector<HTMLElement>('[data-slider-el="nav-next"]'),
    },
    a11y: { notificationClass: 'history-timeline_notification' },
  });

  const galleries = slides.map((slide) =>
    Array.from(slide.querySelectorAll<HTMLElement>('[data-history-image]'))
  );
  let timer: ReturnType<typeof setInterval> | undefined;
  let imageIndex = 0;
  let galleryImages: HTMLImageElement[] = [];
  let galleryIndex = 0;
  let opener: HTMLElement | null = null;
  const galleryImage = dialog.querySelector<HTMLImageElement>(hook('lightbox-image'))!;
  const caption = dialog.querySelector<HTMLElement>(hook('lightbox-caption'))!;
  const counter = dialog.querySelector<HTMLElement>(hook('lightbox-counter'))!;
  const previous = dialog.querySelector<HTMLButtonElement>(hook('lightbox-prev'))!;
  const next = dialog.querySelector<HTMLButtonElement>(hook('lightbox-next'))!;

  function showImage(figures: HTMLElement[], index: number) {
    figures.forEach((figure, i) => {
      figure.toggleAttribute('data-history-active', i === index);
      figure.inert = i !== index;
    });
  }

  function rotateImages() {
    clearInterval(timer);
    if (
      reducedMotion.matches ||
      document.hidden ||
      dialog?.open ||
      component.matches(':hover, :focus-within')
    )
      return;
    const figures = galleries[swiper.realIndex];
    if (figures.length < 2) return;
    timer = setInterval(() => {
      imageIndex = (imageIndex + 1) % figures.length;
      showImage(figures, imageIndex);
    }, 3500);
  }

  function sync() {
    imageIndex = 0;
    slides.forEach((slide, index) => {
      slide.inert = index !== swiper.realIndex;
      buttons[index].setAttribute('aria-current', String(index === swiper.realIndex));
    });
    showImage(galleries[swiper.realIndex], 0);
    nav.slideTo(swiper.realIndex, speed());
    rotateImages();
  }

  function renderGallery() {
    const image = galleryImages[galleryIndex];
    galleryImage.src = image.currentSrc || image.src;
    galleryImage.alt = image.alt;
    caption.textContent = image.closest('figure')?.querySelector('figcaption')?.textContent || '';
    counter.textContent = `${galleryIndex + 1} / ${galleryImages.length}`;
    previous.hidden = next.hidden = galleryImages.length < 2;
  }

  function stepGallery(step: number) {
    galleryIndex = (galleryIndex + step + galleryImages.length) % galleryImages.length;
    renderGallery();
  }

  galleries.forEach((figures, slideIndex) => {
    figures[0]?.parentElement?.setAttribute('data-history-ready', 'true');
    showImage(figures, 0);
    figures.forEach((figure, index) => {
      const image = figure.querySelector<HTMLImageElement>('img')!;
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute(
        'aria-label',
        image.alt ? `Open image: ${image.alt}` : `Open image ${index + 1}`
      );
      const open = () => {
        galleryImages = galleries[slideIndex].map(
          (item) => item.querySelector<HTMLImageElement>('img')!
        );
        galleryIndex = index;
        opener = image;
        renderGallery();
        dialog.showModal();
        clearInterval(timer);
      };
      image.addEventListener('click', open);
      image.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      });
    });
  });
  dialog.querySelector(hook('lightbox-close'))!.addEventListener('click', () => dialog.close());
  previous.addEventListener('click', () => stepGallery(-1));
  next.addEventListener('click', () => stepGallery(1));
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      stepGallery(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  dialog.addEventListener('click', (event) => {
    const bounds = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    )
      dialog.close();
  });
  dialog.addEventListener('close', () => {
    opener?.focus();
    rotateImages();
  });
  swiper.on('slideChange', sync);
  swiper.on('transitionEnd', () => swiper.updateAutoHeight(0));
  const resizeObserver = new ResizeObserver(() => {
    if (!swiper.animating) swiper.updateAutoHeight(0);
  });
  slides.forEach((slide) => resizeObserver.observe(slide));
  component.addEventListener('pointerenter', () => clearInterval(timer));
  component.addEventListener('pointerleave', rotateImages);
  component.addEventListener('focusin', () => clearInterval(timer));
  component.addEventListener('focusout', () => requestAnimationFrame(rotateImages));
  document.addEventListener('visibilitychange', rotateImages);
  reducedMotion.addEventListener('change', () => {
    swiper.params.speed = nav.params.speed = speed();
    rotateImages();
  });
  sync();
}

document.querySelectorAll<HTMLElement>(hook('component')).forEach(initTimeline);
