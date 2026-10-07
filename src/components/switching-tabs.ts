/**
 * Exclusive autoplay for Section / Switching Tabs.
 * Nested details are not siblings, so native name grouping cannot exclusive-switch them.
 * Panel height uses site-wide details::details-content CSS, not JS.
 */

const SWITCHING_TABS_SELECTOR =
  '[data-el="switching-tabs-component"], .switcing-tabs_component, .switching-tabs_component';
const AUTOPLAY_TIMER_CSS_VAR = '--autoplay-timer';
const OUT_OF_VIEW_CLASS = 'is-out-of-view';
const DESKTOP_MQ = '(min-width: 992px)';

function getAutoplayMs(component: HTMLElement): number {
  const timerValue = getComputedStyle(component).getPropertyValue(AUTOPLAY_TIMER_CSS_VAR).trim();

  if (timerValue.endsWith('ms')) {
    return parseFloat(timerValue) || 6000;
  }

  if (timerValue) {
    return (parseFloat(timerValue) || 6) * 1000;
  }

  return 6000;
}

export class AutoRotatingTabs {
  private component: HTMLElement;
  private tabs: HTMLDetailsElement[];
  private currentTabIndex = 0;
  private intervalId: number | null = null;
  private autoplayTimer: number;
  private intersectionObserver?: IntersectionObserver;
  private isInView = false;
  private mediaQuery: MediaQueryList;
  private abortController: AbortController;

  constructor(component: HTMLElement) {
    this.abortController = new AbortController();
    this.component = component;
    this.mediaQuery = window.matchMedia(DESKTOP_MQ);
    this.tabs = Array.from(component.querySelectorAll<HTMLDetailsElement>('details'));
    this.autoplayTimer = getAutoplayMs(component);

    if (!this.tabs.length) {
      console.warn('AutoRotatingTabs: No tabs found.');
      return;
    }

    const openIndex = this.tabs.findIndex((tab) => tab.open);
    this.currentTabIndex = openIndex >= 0 ? openIndex : 0;
    this.init();
  }

  private init(): void {
    this.setupEventListeners();
    this.openTabAtCurrentIndex();

    if (this.mediaQuery.matches) {
      this.setupIntersectionObserver();
    }

    this.mediaQuery.addEventListener(
      'change',
      (event) => {
        if (event.matches) {
          this.setupIntersectionObserver();
        } else {
          this.pauseAutoRotation();
          this.intersectionObserver?.disconnect();
        }
      },
      { signal: this.abortController.signal }
    );
  }

  private setupEventListeners(): void {
    this.tabs.forEach((tab, index) => {
      const toggle = tab.querySelector('summary');
      if (!toggle) return;

      toggle.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          if (index === this.currentTabIndex) return;

          this.currentTabIndex = index;
          this.openTabAtCurrentIndex();
        },
        { signal: this.abortController.signal }
      );
    });
  }

  private setupIntersectionObserver(): void {
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.target !== this.component) return;

          this.isInView = entry.isIntersecting;
          if (this.isInView) {
            this.startAutoRotation();
          } else {
            this.pauseAutoRotation();
          }
        });
      },
      { threshold: 0.1 }
    );

    this.intersectionObserver.observe(this.component);
  }

  private openTabAtCurrentIndex(): void {
    this.tabs.forEach((tab, index) => {
      tab.open = index === this.currentTabIndex;
    });
    this.startAutoRotation();
  }

  private startAutoRotation(): void {
    if (!this.mediaQuery.matches || !this.isInView) return;

    this.pauseAutoRotation();
    this.component.classList.remove(OUT_OF_VIEW_CLASS);
    this.intervalId = window.setInterval(() => {
      this.currentTabIndex = (this.currentTabIndex + 1) % this.tabs.length;
      this.openTabAtCurrentIndex();
    }, this.autoplayTimer);
  }

  private pauseAutoRotation(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.component.classList.add(OUT_OF_VIEW_CLASS);
  }

  public destroy(): void {
    this.abortController.abort();
    this.pauseAutoRotation();
    this.intersectionObserver?.disconnect();
  }
}

export function initAutoRotatingTabs(): void {
  document.querySelectorAll(SWITCHING_TABS_SELECTOR).forEach((component) => {
    new AutoRotatingTabs(component as HTMLElement);
  });
}

window.Webflow = window.Webflow || [];
window.Webflow?.push(() => {
  initAutoRotatingTabs();
});
