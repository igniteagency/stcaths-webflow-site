import '$dev/debug';
import '$dev/env';
import { LOCAL_SERVER } from '$dev/env';

/**
 * Entry point for the build system.
 * Fetches scripts from localhost or production site depending on the setup
 * Polls `localhost` on page load, else falls back to deriving code from production URL
 */

// Add ScriptOptions and ScriptListItem types for global use
export interface ScriptOptions {
  placement?: 'head' | 'body';
  defer?: boolean;
  isModule?: boolean;
  name?: string;
  scriptName?: string;
  // allow any other new option name here
  [key: string]: unknown;
}

function getProductionBase() {
  return 'https://cdn.jsdelivr.net/gh/igniteagency/webflow-js-starter-new/dist/prod/';
}

window.PRODUCTION_BASE = getProductionBase();

function getScriptBase() {
  return window.SCRIPTS_ENV === 'local' ? LOCAL_SERVER : window.PRODUCTION_BASE;
}

window.SCRIPT_BASE = getScriptBase();

/**
 * Loads a script either from the JS repo, or accepts a direct library URL too
 * Examples:
 * ```ts
 * window.loadScript('global.js');
 * window.loadScript('https://cdn.jsdelivr.net/npm/some-lib@1.0.0/dist/index.js', {
 *   placement: 'head',
 *   name: 'some-lib',
 * });
 * ```
 * @param url - The URL of the script to load
 * @param options - The options for the script
 * @param attr - Any other attributes to add to the script element
 * @returns A promise that resolves when the script is loaded
 */
window.loadScript = function (url, options, attr?: Record<string, string>): Promise<void> {
  const opts: ScriptOptions = {
    placement: 'body',
    defer: true,
    isModule: false,
    name: undefined,
    scriptName: undefined,
    ...options,
  };

  const attributes: Record<string, string> = { ...attr };
  const scriptName = opts.scriptName || opts.name;
  window.SCRIPT_BASE = getScriptBase();

  // Work with both relative repo paths and direct CDN URLs
  const isAbsolute = /^https?:\/\//.test(url);
  const finalUrl = isAbsolute ? url : window.SCRIPT_BASE + url;

  if (document.querySelector(`script[src="${finalUrl}"]`)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = finalUrl;
    if (opts.defer) {
      script.defer = true;
    }
    if (opts.isModule) {
      script.type = 'module';
    }
    Object.entries(attributes).forEach(([key, value]) => {
      script.setAttribute(key, value);
    });
    script.onload = () => {
      if (scriptName) {
        document.dispatchEvent(
          new CustomEvent(`scriptLoaded:${scriptName}`, {
            detail: { url: finalUrl, name: scriptName, scriptName },
          })
        );
      }
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load script: ${finalUrl}`));

    document[opts.placement].appendChild(script);
  });
};

window.loadCSS = function (href: string): Promise<void> {
  if (document.querySelector(`link[href="${href}"]`)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;

    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load CSS: ${href}`));

    document.head.appendChild(link);
  });
};

window.conditionalLoadScript = function (selector, url) {
  if (document.querySelector(selector)) {
    return window.loadScript(url);
  }
};
