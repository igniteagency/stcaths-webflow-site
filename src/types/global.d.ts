import type { Webflow } from '@finsweet/ts-utils';
import type GSAP from 'gsap';
import type ScrollTrigger from 'gsap/ScrollTrigger';
import type SplitText from 'gsap/SplitText';
import type jQuery from 'jquery';
import type { ScriptOptions } from 'src/entry';

import type { SCRIPTS_ENV } from '$dev/env';

interface Webflow_IX3 extends Webflow.require {
  emit: (
    eventName: string,
    details?: any,
    targetElement?: Element | null,
    options?: { bubbles?: boolean }
  ) => void;
  destroy: () => void;
  ready: () => Promise<void>;
}

declare global {
  Webflow: typeof Webflow;

  /** GSAP and sub-libs loading from Webflow CDN */
  gsap: GSAP;
  ScrollTrigger: typeof ScrollTrigger;
  SplitText: typeof SplitText;
  ScrollSmoother: typeof ScrollSmoother;

  /** Swiper JS global types */
  declare const Swiper: typeof import('swiper').default;
  type SwiperModule =
    | typeof import('swiper').Navigation
    | typeof import('swiper').Pagination
    | typeof import('swiper').Autoplay
    | typeof import('swiper').A11y;

  declare const Navigation: SwiperModule;
  declare const Pagination: SwiperModule;
  declare const Autoplay: SwiperModule;
  declare const A11y: SwiperModule;
  declare const EffectFade: SwiperModule;

  /** Global window types */
  interface Window {
    Webflow: Webflow;
    WF_IX: Webflow_IX3;

    SCRIPTS_ENV: SCRIPTS_ENV;
    setScriptMode(env: SCRIPTS_ENV): void;

    IS_DEBUG_MODE: boolean;
    setDebugMode(mode: boolean): void;

    PRODUCTION_BASE: string;

    SCRIPT_BASE: string;

    loadScript: (
      url: string,
      options?: ScriptOptions,
      attr?: Record<string, string>
    ) => Promise<void>;

    loadCSS: (url: string) => Promise<void>;

    /**
     * Conditionally load a script if a selector is found on the page
     * @param selector CSS selector to check for existence
     * @param url Internal or third party URL of the script to load. Directly feeds into loadScript
     */
    conditionalLoadScript: (selector: string, url: string) => void;

    jQuery: typeof jQuery;
  }

  // Extend `querySelector` and `querySelectorAll` function
  // to stop the nagging of converting `Element` to `HTMLElement` all the time
  interface ParentNode {
    querySelector<E extends HTMLElement = HTMLElement>(selectors: string): E | null;
    querySelectorAll<E extends HTMLElement = HTMLElement>(selectors: string): NodeListOf<E>;
  }
}

export {};
