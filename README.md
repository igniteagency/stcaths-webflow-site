# St Catherine’s School Webflow JavaScript

This GitHub project provides a development workflow for JavaScript files in Webflow JS Starter.

In essence, it uses bun to start a development server on [localhost:3000](http://localhost:3000), bundle, build and serve any working file (from the `/src` directory) in local mode. Once pushed up and merged into `main`, it's auto-tagged with the latest semver tag version (using Github CI), and the production code will be auto-loaded from [jsDelivr CDN](https://www.jsdelivr.com/).

**Keep the repository public for jsDelivr to access and serve the file via CDN**

## Install

### Prerequisites

- Have [bun](https://bun.sh/) installed locally. Installation guidelines [here](https://bun.sh/docs/installation) (recommended approach - homebrew / curl)
  - Alternatively, `pnpm` or `npm` will work too.

### Setup

- Run `bun install`
  - Alternatively, `pnpm install` or `npm install`

## Usage

After duplicating or migrating the Starter, update the repository name in this README, `src/entry.ts`, and the Webflow site-head `entry.js` URL.

### Output

The project will process and output the files mentioned in the `files` const of `./bin/build.js` file. The output minified files will be in the `./dist/prod` folder for production (pushed to github), and in the `./dist/dev` used for local file serving (excluded from Git).

### Development

1. The initial `entry.js` file needs to be made available via external server first for this system to work (in the `<head>` area of the site).

   ```html
   <script src="https://cdn.jsdelivr.net/gh/igniteagency/stcaths-webflow-site/dist/prod/entry.js"></script>
   ```

   For occasional localhost testing when editing `entry.js`, you'll have to manually include that script like following:

   ```html
   <script src="http://localhost:3000/entry.js"></script>
   ```

2. **Load scripts dynamically using `window.loadScript`**

   You can load any script relative to your repo, or a full CDN URL, using the global `window.loadScript` function. This is the recommended way to load scripts in this setup.

   **Usage:**

   ```js
   // Load a relative script (from CDN or localhost, depending on env)
   window.loadScript('global.js');

   // Load an external library from a CDN, with options
   window.loadScript('https://cdn.jsdelivr.net/npm/some-lib@1.0.0/dist/index.js', {
     placement: 'head', // 'head' or 'body' (default: 'body')
     scriptName: 'some-lib', // Optional: emits a custom event 'scriptLoaded:some-lib' when loaded
     defer: true, // (default: true)
     isModule: false, // (default: false)
   });
   ```
   - Scripts are loaded as classic scripts by default, matching the IIFE build output.
   - The function deduplicates by URL (won't load the same script twice).
   - You can listen for a custom event when a script is loaded:

     ```js
     document.addEventListener('scriptLoaded:some-lib', (e) => {
       // e.detail.url, e.detail.name, e.detail.scriptName
       // Your code here
     });
     ```

   - **Options:**
     - `placement`: `'head' | 'body'` (default: `'body'`)
     - `defer`: `boolean` (default: `true`)
     - `isModule`: `boolean` (default: `false`)
     - `scriptName`: `string` (optional, for custom event)

   **Do not use the old `window.JS_SCRIPTS` set or batch loading. Use `window.loadScript` for all dynamic script loading.**

### Native details groups

`global.js` automatically treats any parent with two or more direct-child `<details>` elements as one exclusive disclosure group. No activation attribute is required.

```html
<div>
  <details open>...</details>
  <details>...</details>
</div>
```

- Each inferred group receives a unique shared native `name`.
- Nested disclosures are excluded from the outer group because only direct siblings are grouped.
- Authored `[open]` state is preserved.
- `.tabbed-content_tabs` opens its first direct child only when none is authored open.
- `data-accordion-open` is reserved for Webflow Designer preview state and is ignored at published runtime.
- Browsers without native named-details support receive a scoped `toggle` fallback.
- Disclosure animation belongs to progressive-enhancement CSS in Webflow, not JavaScript.

### Opt-in letter reveal (St Catherine’s only)

```html
<h2 data-text-reveal="chars">A place to discover her potential</h2>
<p data-text-reveal="chars">A short introduction written as plain text.</p>
```

`global.js` conditionally loads `components/text-reveal.js` when this hook exists. Only that bundle
contains [Kugiri](https://raw.githubusercontent.com/edoardolunardi/kugiri/main/README.md), pinned to
0.5.3 with Bun. It uses St Catherine’s existing CDN-provided `window.gsap`; it does not load or bundle
another GSAP or SplitText. Have the existing GSAP global available before component initialization.
There is no Webflow/CSS change or automatic opt-in for existing headings.

- Only static, plain-text `h1`–`h6` and `p` elements qualify. All child elements (including links,
  emphasis, icons, `<br>`, and accessible spans), interactive targets/ancestors, editable content,
  and non-text roles are skipped. Do not opt in text with programmatic interaction handlers.
- Native text stays visible while waiting for a positive viewport intersection, a measurable box,
  and `document.fonts.ready`. Hidden, `display:none`, zero-width and offscreen targets stay unsplit.
  Pending targets observe size and visibility attributes on their ancestors until they activate.
- The one-time reveal animates character opacity and vertical offset using GSAP for at most one
  second. Kugiri measures the browser’s existing line breaks, including `text-wrap: balance/pretty`.
  Completion restores original text nodes and authored attributes, including inline styles and
  `data-split`. A viewport resize or target-width change mid-animation cancels, restores, and never
  replays; native text can then reflow normally.
- Headings retain their original accessible name, respecting authored `aria-label` and
  `aria-labelledby`. Generated lines/characters are hidden from assistive technology. Paragraphs
  retain one visually hidden native text alternative during the animation because paragraph roles
  cannot be named with `aria-label`. Authored `role`, `aria-hidden` and other data/ARIA remain intact.
- Reduced motion skips the reveal initially and cancels both active and pending reveals if enabled
  later. Missing GSAP/observer support, split errors or tween errors leave natural text. Completed,
  skipped and canceled elements do not replay. Observers/listeners are removed on completion,
  cancellation or page exit; pending hidden targets remain watched until then.

The component initializes itself on execution. Repeated execution and repeated calls are idempotent,
including while fonts are pending. For newly inserted opt-in content:

```js
await window.loadScript('components/text-reveal.js');
window.stCathsTextReveal?.init(container); // optional root; defaults to document; includes root itself
```

There is no replay API or continuous DOM discovery. Avoid changing text, its inline style, font, or
ARIA during the one-second reveal: the original text/style snapshot is restored. Character boxes
temporarily lose cross-letter kerning, ligatures and connected-script shaping. Kugiri also prevents
page translation on split lines until restoration. Use sparingly on short copy; verify the actual
site typography in Safari/Firefox as well as Chromium. Transitions/animations that hide a target
without changing its box or observed attributes are outside this hook’s activation contract.

#### Reveal regression checks

```sh
bun install --frozen-lockfile
bun test
bunx --no-install tsc --noEmit
bun run build
bun run qa:text-reveal
```

The focused unit suite uses controlled split/GSAP/observer doubles for lifecycle failures. The
executable `bin/qa-text-reveal.mjs` serves the **actual `dist/prod` component**, real GSAP from the
existing dev dependency, and `tests/fixtures/text-reveal.html` on an ephemeral localhost port. It
uses an available Playwright module, without installing a browser or test framework. If Playwright
is outside this checkout, point `PLAYWRIGHT_MODULE` at its absolute `index.mjs`; optionally point
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` at an installed Chromium/Chrome executable. For this workstation:

```sh
PLAYWRIGHT_MODULE=/Users/iggy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
TEXT_REVEAL_EVIDENCE_DIR=/tmp/text-reveal-evidence \
bun run qa:text-reveal
```

QA fetches a pinned Open Sans Latin WOFF2 from Google Fonts, serves it locally and deliberately gates
its first load to check font readiness. Set `TEXT_REVEAL_FONT_PATH` to a local copy of that font for
offline runs. The script checks 360/768/1280px balance/pretty line breaks and geometry; actual
accessibility-tree names and paragraph text; exact completion restoration; viewport/container
resize; initial/live reduced motion; display/visibility/zero-width/offscreen activation; repeated
initialization and dynamic roots; unsafe markup; missing GSAP/observers; forced split/tween failures;
and real-time completion. Most cases pause real GSAP tweens for deterministic inspection. Each case
also checks observer cleanup and browser errors where applicable. A failed launch or assertion exits
nonzero. Do not bypass MachPort/OS sandbox launch failures: Hermes should run QA outside the coding
sandbox. A blocked launch is **not** a passing browser test.

Optional `TEXT_REVEAL_EVIDENCE_DIR` saves screenshots, full Chromium AX trees (`.ax.json`), and
measured tween/character state (`.state.json`) at 35% progress and after exact restoration at
360/768/1280px. These use the actual split nodes and GSAP tweens. `run-result.json` records the
bundle hash, browser version, scenario outcomes, evidence paths, and any failure; failed scenarios
also attempt a diagnostic capture. Separate restoration cases avoid reading host attributes while
split, so evidence collection cannot mask CSSOM's deferred `style` serialization. Real-time
completion covers both headings and paragraphs at mobile and desktop widths.

### Switching tabs

`Section / Switching Tabs` nests each panel `details` so they are not direct siblings. `details.ts` therefore cannot exclusive-group them. `global.js` loads `components/switching-tabs.js` when the component is on the page.

That script only:

- exclusive-opens one nested `details` at a time
- autoplays on desktop while the component is in view
- toggles `.is-out-of-view` so the loader CSS can pause

Do not animate panel height in JS. Use the same site `details::details-content` CSS as FAQs. `preventDefault` on summary clicks is required here so native toggle does not fight exclusive switch / autoplay.

Component CSS embed:

```html
<style>
  [data-el='switching-tabs-component'],
  .switcing-tabs_component {
    --autoplay-timer: 6s;
  }

  .switching-tabs_item:has(.accordions_item_component[open])
    .switching-tabs_loader-wrap
    > .switching-tabs_loader-line {
    animation: loaderLine var(--autoplay-timer, 6s) linear forwards;
  }

  .switcing-tabs_component.is-out-of-view .switching-tabs_loader-line,
  [data-el='switching-tabs-component'].is-out-of-view .switching-tabs_loader-line {
    animation: none;
  }

  @keyframes loaderLine {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(0%);
    }
  }
</style>
```

For the uncommon case where direct sibling disclosures must remain independently open, opt out on their parent:

```html
<div data-details-group="false">
  <details>...</details>
  <details>...</details>
</div>
```

3. Whilst working locally, run `bun run dev` to start a development server on [localhost:3000](http://localhost:3000)
   - Alternatively, `pnpm run dev` or `npm run dev`

4. To switch between serving scripts from localhost or CDN, use the following in your browser console:

   - To serve scripts from localhost (when running the dev server):
     ```js
     window.setScriptMode('local');
     ```
   - To switch back to CDN serving mode:
     ```js
     window.setScriptMode('cdn');
     ```

   This preference is saved in the browser's localStorage. If the local server is not running, it will automatically fall back to CDN.

5. As you make changes to your code locally and save, the [localhost:3000](http://localhost:3000) server will serve those files.

#### Debugging

- Add any debug console logs in the code using the `console.debug` function instead of `console.log`. This way, they can be toggled on/off using the browser native "Verbose/Debug" level.
- There is an optional debug mode setup for development that can execute conditional logic using `window.IS_DEBUG` check. Execute `window.setDebugMode(true)` in the browser console to enable the debug mode. Execute `window.setDebugMode(false)` to disable the mode.

### Publishing the code to CDN

1. Run `bun run build` to generate the production files in `./dist/prod` folder
   - Alternatively, `pnpm run build` or `npm run build`

2. To push code to production, merge the working branch into `main`. A Github Actions workflow will run tagging that version with an incremented [semver](https://semver.org/) tag. Once pushed, the production code will be auto loaded from [jsDelivr CDN](https://www.jsdelivr.com/).
   - By default, the version bump is a patch (`x.y.{{patch number}}`). To bump the version by a higher amount, mention a hashtag in the merge commit message, like `#major` or `#minor`

3. Production and pre-launch Webflow sites load the repository's default `main` branch. Use a `dev` branch override only for an explicitly requested dev-only test. Branch URLs are cached and may require a manual jsDelivr purge.
   - For an explicit dev-only test, override `window.PRODUCTION_BASE` after including `entry.js`, then remove the override before production delivery.

#### jsDelivr Notes & Caveats

- Direct jsDelivr links directly use semver tagged releases when available, else falls back to the master branch [[info discussion link](https://github.com/jsdelivr/jsdelivr/issues/18376#issuecomment-1046876129)]
- Tagged version branches are purged every 12 hours from their servers [[info discussion link](https://github.com/jsdelivr/jsdelivr/issues/18376#issuecomment-1046918481)]
- To manually purge a tagged version's files, wait for 10 minutes after the new release tag is added [[info discussion link](https://github.com/jsdelivr/jsdelivr/issues/18376#issuecomment-1047040896)]

[**JSDelivr CDN Purge URL**](https://www.jsdelivr.com/tools/purge)
