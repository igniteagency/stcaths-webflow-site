export {};

function initNavTone() {
  const navbar = document.querySelector('.navbar-wrapper');
  if (!navbar || navbar.dataset.navToneReady) return;
  navbar.dataset.navToneReady = 'true';

  const groups = [
    ...navbar.querySelectorAll(
      '.navbar_container > .nav-menu_trigger, .navbar_container > .navbar_logo-link, .navbar_container > .navbar_button-wrapper'
    ),
  ];
  // Shared Global / Visual frames cover hero, inset and gallery photos.
  const photos = [...document.querySelectorAll('main .image-wrapper')].filter((frame) =>
    frame.querySelector('img[src], video')
  );
  const menu = navbar.querySelector('[data-nav-menu-popover]');
  const search = navbar.querySelector<HTMLDialogElement>('dialog.nav-search_component');
  let queued = false;

  function updateNavTone() {
    queued = false;
    const menuOpen = Boolean(menu?.matches(':popover-open') || search?.open);
    const bounds = photos
      .filter(
        (frame) =>
          !frame.closest('[hidden], .w-condition-invisible') && frame.getClientRects().length
      )
      .map((frame) => frame.getBoundingClientRect());

    for (const group of groups) {
      const rect = group.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, rect.top + Math.min(rect.height / 2, 26)));
      const overPhoto = bounds.some(
        (photo) =>
          photo.width > 0 &&
          photo.height > 0 &&
          x >= photo.left &&
          x <= photo.right &&
          y >= photo.top &&
          y <= photo.bottom
      );
      const tone = !menuOpen && overPhoto ? 'light' : 'dark';
      if (group.dataset.navTone !== tone) group.dataset.navTone = tone;
    }
  }

  function scheduleNavTone() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(updateNavTone);
  }

  addEventListener('scroll', scheduleNavTone, { passive: true });
  addEventListener('resize', scheduleNavTone);
  addEventListener('pageshow', scheduleNavTone);
  document.addEventListener('load', scheduleNavTone, true);
  menu?.addEventListener('toggle', scheduleNavTone);
  if (search)
    new MutationObserver(scheduleNavTone).observe(search, {
      attributes: true,
      attributeFilter: ['open'],
    });
  const resizeObserver = new ResizeObserver(scheduleNavTone);
  resizeObserver.observe(navbar);
  const main = document.querySelector('main');
  if (main) resizeObserver.observe(main);
  document.fonts.ready.then(scheduleNavTone);
  updateNavTone();
}

initNavTone();
