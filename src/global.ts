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
  window.conditionalLoadScript('.button_link', 'components/button-text.js');
  if (document.querySelector(TEXT_REVEAL_SELECTOR + ',[data-menu-motion]')) {
    void window
      .loadScript('components/text-reveal.js')
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
