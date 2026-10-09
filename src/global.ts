import { initDetailsGroups } from '$components/details';
import Dialog from '$components/dialog';
import { setCurrentYear } from '$utils/current-year';
import '$utils/disable-webflow-scroll';
import { disableWebflowAnchorSmoothScroll } from '$utils/disable-webflow-scroll';
import handleExternalLinks from '$utils/external-link';
import addMainElementId from '$utils/main-element-id';
import { duplicateMarqueeList } from '$utils/marquee-list';
import { setSearchResultTextFromQuery } from '$utils/search-query-text';
import { TEXT_REVEAL_SELECTOR } from '$utils/text-motion-settings';

window.Webflow = window.Webflow || [];
window.Webflow?.push(() => {
  setTimeout(() => {
    window.WF_IX = Webflow.require('ix3');
    console.debug('Webflow IX3 globalised:', window.WF_IX);
  }, 100);

  // Set current year on respective elements
  setCurrentYear();
  addMainElementId();
  handleExternalLinks();
  setSearchResultTextFromQuery();

  initComponents();
  UIFunctions();
  webflowOverrides();

  loadScrollTimelineCSSPolyfill();
});

function initComponents() {
  new Dialog();
}

function UIFunctions() {
  duplicateMarqueeList();
  initDetailsGroups();
  if (document.querySelector('[data-hero-intro]')) {
    document
      .querySelector('[data-hero-intro-content]')
      ?.setAttribute('data-text-trigger', 'manual');
  }
  window.conditionalLoadScript('.button_link', 'components/button-text.js');
  if (document.querySelector('[data-divider-reveal]')) {
    void window
      .loadScript('components/divider.js')
      .catch((error) => console.error('Divider motion unavailable:', error));
  }
  if (document.querySelector('[data-statistics]')) {
    void window
      .loadScript('components/statistics.js')
      .catch((error) => console.error('Statistic motion unavailable:', error));
  }
  if (document.querySelector(TEXT_REVEAL_SELECTOR + ',[data-menu-motion],[data-hero-intro]')) {
    void window
      .loadScript('components/text-reveal.js')
      .then(() => window.conditionalLoadScript('[data-hero-intro]', 'components/hero-intro.js'))
      .then(() => window.conditionalLoadScript('[data-menu-motion]', 'components/nav-menu.js'))
      .catch((error) => console.error('Text motion unavailable:', error));
  }
  window.conditionalLoadScript(
    '[data-el="switching-tabs-component"], .switcing-tabs_component, .switching-tabs_component',
    'components/switching-tabs.js'
  );
}

function webflowOverrides() {
  disableWebflowAnchorSmoothScroll();
}

function loadScrollTimelineCSSPolyfill() {
  window.loadScript('https://flackr.github.io/scroll-timeline/dist/scroll-timeline.js');
}
