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

### Global reusable text motion (St Catherine’s)

`global.js` conditionally loads `components/text-reveal.js` for **all** `h1`–`h6`, paragraphs and
`.text-style-eyebrow`, `.eyebrow`, `[data-el="eyebrow"]` throughout the document. Native list items
and blockquotes within `.w-richtext` / `.rich-text` also qualify. Containers with nested text
blocks yield to their leaves, so `li > p` / `blockquote > p` animate once. Mixed containers with
both bare text and child blocks keep their bare text native; wrap that text in a paragraph to reveal it.
Text in controls/links, editable content, tables and media is excluded from automatic selection.
Structural ancestors such as `main tabindex="-1"` (a skip-link destination) remain eligible; targets
with their own tabindex and actual control ancestors remain excluded.

**Migration:** remove old `data-text-reveal="chars"` hooks to get the default preset for each tag.
The legacy value still explicitly selects the heading preset, including on a paragraph. Optional
`data-text-reveal="heading|paragraph|eyebrow|menu"` selects a preset on a text wrapper.

| Preset    | Units | Duration | Stagger each | Initial state                                                               | Origin / perspective |
| --------- | ----- | -------- | ------------ | --------------------------------------------------------------------------- | -------------------- |
| heading   | chars | 1.5s     | .025s        | y 100px, x 0, opacity 0, blur 22px, rotation 12°, rotationX −21°, scale .95 | 50% 100% / 800px     |
| paragraph | lines | 1.5s     | .1s          | y 30px, x 0, opacity 0, blur 0, rotations 0, scale 1                        | 0% 100% / 800px      |
| eyebrow   | lines | 1.5s     | .1s          | Same as paragraph                                                           | Same as paragraph    |
| menu      | words | .55s     | .025s        | y 28px, x 0, opacity 0, blur 8px, rotation 3°, rotationX 0, scale 1         | 50% 100% / none      |

Every preset uses delay 0, `power3.out`, stagger from `start`, and ends at x/y/rotations 0,
scale/opacity 1 and blur 0. Settings live in `src/utils/text-motion-settings.ts`; heading,
paragraph and menu values match the current Astro reference. There is no independent Astro
eyebrow preset, so eyebrows use the paragraph profile.

Automatic registration uses the existing global GSAP + ScrollTrigger with `once: true` and the
`top 92%` threshold clamped to the scrollable page. A numeric start function applies the clamp on
every individual refresh, including targets registered after page load; its upper limit is one
pixel before maximum scroll so `onEnter` can fire. Preparation checks the trigger’s actual numeric
start and scroll position. Footer text therefore reveals at maximum scroll without a bottom spacer. H1 follows exactly the same rule; any measurable target already past that threshold
starts after fonts are ready without another scroll. Content stays native until preparation.
The text-reveal component itself has **no** page-load/hero, menu-open, dialog, click or custom-event animation bindings. The separate hero-intro and navigation-menu controllers below use its manual factory.

Opt out on an element, section, or page; these also block manual `create()`:

```html
<p data-text-reveal="off">Always native text</p>
<section data-text-reveal="off">…</section>
<body data-text-reveal="off">
  …
</body>
```

Inherited `data-no-text-motion` and `data-no-heading-motion` also opt out. Use
`data-text-trigger="manual"` on a target or ancestor to disable automatic registration while
retaining the factory. The component initializes itself once; execution and `init()` are idempotent.
For newly inserted content, explicitly call `window.stCathsTextReveal.init(container)` (includes
that root itself). There is no continuous document scanning.

```js
await window.loadScript('components/text-reveal.js');
const motion = window.stCathsTextReveal;

// Show hidden content first and let its layout settle. create() then awaits fonts itself.
// Select a plain label span inside the link/button, not the control itself.
const label = document.querySelector('[data-el="menu-label"]');
const handle = await motion.create(label, { preset: 'menu', paused: true });
handle?.play();
// Or cancel immediately and restore its original DOM:
handle?.revert();
```

`create(element, options)` returns `Promise<TextRevealHandle | null>` with the actual GSAP tween
as `handle.animation`, plus `play(): void` and `revert(): void`. It never creates a ScrollTrigger
and cancels any existing registration/animation for that target, even when creation subsequently
returns null. Default is paused; use `paused: false` to run directly. Finite numeric overrides:
`duration`, `stagger`, `delay`, `blur`, `rotation`, `rotationX`, `y`, `x`, `opacity`, `scale`.
Duration/stagger/delay/blur are clamped to zero or above. It returns null for opted-out, unsafe,
hidden/zero-size targets, reduced motion, unavailable dependencies or an error. Show hidden content
**before** calling; it does not wait for a future menu/dialog event.

```js
const handle = await motion.create(label, { preset: 'menu' });
if (handle) {
  const timeline = gsap.timeline({ paused: true });
  timeline.add(handle.animation, 0);
  handle.animation.paused(false); // let the parent timeline control this child
  timeline.play();
}
```

Completion/cancellation restores native DOM immediately (external GSAP interruption defers cleanup
until its renderer returns). Create again after restoration to replay; reusing an already completed
handle cannot re-split text. `motion.dispose(root = document)` cancels pending/prepared/active work
in that scope; automatic targets do not replay afterward. Dispose before removing controlled views.

Kugiri 0.5.3 is bundled **only** in the component; generated `dist/prod/global.js` contains just the
shared selector/config it needs. The site must supply `window.gsap` and `window.ScrollTrigger`
(currently Webflow CDN 3.15.0) before automatic initialization. Neither GSAP core nor any GSAP plugin
is bundled or fetched here. Missing ScrollTrigger leaves automatic content natural; manual creation
still works with GSAP. ResizeObserver and MutationObserver are also required for safe effects.

Rich text follows [Kugiri’s documented painted-line splitting](https://github.com/edoardolunardi/kugiri#readme):
emphasis, strong, `<br>`, links and first-line indentation are preserved. Lines keep accessible native
text; no paragraph `aria-label` is added. Character/word headings use normalized rendered text (`innerText`, with a text-content fallback)
for their accessible name, so `<br>` remains a word boundary; authored `aria-label`/`aria-labelledby`
remain authoritative. Only generated lines are hidden. A plain menu span gets one visually hidden native text alternative inside the
span, retaining its enclosing link’s accessible name. Heading/word targets containing links instead
use a whole-element tween, so links remain exposed. Descendant IDs, names, tabindex and authored ARIA
also use this fallback to prevent duplicate identifiers or lost semantics. Media/form content is skipped.

Recursive original-node snapshots restore hierarchy, text and descendant attributes after Kugiri’s
Range mutations, including existing descendant listeners. Whole-element cleanup leaves descendants
in place, retaining focus. Ordinary paragraph links may be cloned per line while
split; their native link behavior and AX exposure remain, but directly attached listeners belong to
the original nodes and return on cleanup. Keyboard focus (`:focus-visible`) on a split link cancels
the reveal, restores its original anchor/listeners, and transfers focus without scrolling. Pointer
focus leaves the live anchor in place for native activation; any focused clone is mapped back to
its original on completion/cancellation. A link already focused before preparation stays native.
No click or key handlers are added. Opt out of dynamic widgets or copy with custom inline
handlers/state, and avoid modifying text/styles/ARIA during a reveal. Cleanup restores the snapshot;
changes made inside generated wrappers are not retained. Whole-element fallbacks preserve descendant
identity throughout but cannot stagger individual units. Character splitting temporarily loses
kerning/ligatures; generated lines suppress page translation until restoration. Check site fonts in
Safari/Firefox as well as Chromium.

Fonts are awaited before splitting. Width changes in the target/container, viewport resize, later
font loading, reduced-motion changes, disposal and page exit restore prepared/active text rather
than replaying. Hidden automatic targets watch only their own size and ancestor visibility attributes
until measurable; detached targets are released on observed size changes or explicit disposal.
After all work completes, component observers/listeners/triggers are removed. Native text survives
split/tween/trigger errors. GSAP’s own global plugin resources are not owned by this component.
See [ScrollTrigger.create](<https://gsap.com/docs/v3/Plugins/ScrollTrigger/static.create()/>) and
[ScrollTrigger.kill](<https://gsap.com/docs/v3/Plugins/ScrollTrigger/kill()/>) for the lifecycle used here.

#### Text-motion verification

```sh
bun install --frozen-lockfile
node --test tests/*.test.mjs
bunx --no-install tsc --noEmit # compare with existing repository baseline errors
bun run build
PLAYWRIGHT_MODULE=/Users/iggy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
TEXT_REVEAL_EVIDENCE_DIR=/Volumes/Sandisk-2TB-SSD/hermes/outputs/stcaths-global-text-motion/final \
bun run qa:text-reveal
```

The executable runner serves the actual production component, real Webflow CDN GSAP/ScrollTrigger
**3.15.0**, and the local fixture. It fetches pinned assets by default; for offline runs set
`TEXT_REVEAL_GSAP_PATH`, `TEXT_REVEAL_SCROLLTRIGGER_PATH`, and `TEXT_REVEAL_FONT_PATH` (Open Sans Latin
WOFF2, URL in the runner). `TEXT_REVEAL_SCENARIO` optionally filters scenario names. No dependencies
or browsers are installed by this runner, and Chromium’s sandbox stays enabled. If OS sandboxing
blocks launch, the parent must run it; that is not a passing browser check.

Scenarios cover immediate H1 outside main, below-fold registration, footer/eyebrow, rich text,
controls/opt-outs, manual paused creation/play/replay/timeline use, auto takeover, fonts, reduced
motion, resize/disposal, missing dependencies, failure restoration and duplicate initialization.
360/768/1280px checks compare line membership, top/left/right edges, height, and every non-whitespace
glyph’s coordinates at rest (all within 2px), then capture partial motion. Only whitespace
representation is normalized: Kugiri spacer boxes can paint gaps whose text Range has zero width.
Glyph-position checks still reject collapsed gaps. Rich-heading and menu-label `<br>` names are
asserted against the Chromium AX tree; keyboard focus/restoration and native link activation are
also checked. To reproduce the Webflow typography, supply the parent’s `nantes-web-book.woff2` via
`TEXT_REVEAL_FONT_PATH`; run results record the font source and hash. Evidence includes screenshots, full Chromium AX trees, state JSON and a run-result
with bundle/asset hashes, browser version, per-scenario outcomes and failures. Observers are counted
only when created by this component; Playwright polling is excluded. The runner never returns a
GSAP tween from `page.evaluate` because tweens are thenable. Separate lazy-CSSOM cases avoid host
attribute reads while split, preserving the style-restoration regression test.

### Button text roll

`global.js` conditionally loads `components/button-text.js` on `.button_link`. Each link owns
`.button_text` labels in its nearest `.button_component`, including the Webflow sibling overlay
structure; nested components are excluded. Direct labels inside `.button_link` links/buttons also
work. Automatic text reveal excludes `.button_text` and descendants; its manual factory is unchanged.

The concept letter roll uses native WAAPI: 500ms, 25ms per grapheme, `cubic-bezier(.16,1,.3,1)`,
`fill: both`, outgoing `0 → -150%` and incoming `150% → 0`. Pointer enter **and** leave trigger it
only for fine hover pointers excluding touch; focus and blur work on all pointer types. A playing
cycle queues at most one replay and restores after both `560 + letterCount * 25` ms and every native
animation's `finished` promise have completed. The timer is a minimum; compositor delays cannot cut
off the last letters. Native activation, control attributes, authored accessible names, icons and focus
stay intact.

Inherited `data-button-text="off"`, `data-text-reveal="off"`, `data-no-text-motion` or
`data-no-heading-motion` disable it (including on `body`). `data-text-trigger="manual"` only controls
scroll reveal. Disabled/inert controls, empty/missing labels and complex or interactive label contents
stay native. Initially supported labels contain only text/comments; rich labels are intentionally
skipped. Non-horizontal text, wrapped inline labels and flex/grid label containers also stay native.

Original nodes retain their native flow in a temporary invisible span, preserving spacing and wrapping;
measured glyph copies are aria-hidden and one hidden text alternative remains inside the label.
The original nodes and exact inline style return on completion or cancellation. Font readiness is
awaited; enabling reduced motion, viewport/container resize, font changes, disposal and pagehide cancel
active work and drop replay. Native `Intl.Segmenter` is used when available, otherwise `Array.from`.
Missing WAAPI, usable `Animation.finished` promises or ResizeObserver leaves native text. Rejected
completion promises restore the label and drop replay. There are no animation dependencies or component stylesheets.

For dynamic content, call `window.stCathsButtonText?.init(container)` after insertion and
`window.stCathsButtonText?.dispose(container)` before removal. Both include the root control;
repeated init/script loads are idempotent. Load via `await window.loadScript('components/button-text.js')`
if no original controls caused the conditional load. Do not run the manual text-reveal factory or
edit label contents/styles during a roll. Idle controls retain only their interaction listeners and
shared preference/pagehide listeners; size/font/resize resources exist only during work.

Run `node --test tests/*.test.mjs` and `bun run build`, then have the parent run real Chromium QA:

```sh
PLAYWRIGHT_MODULE=/Users/iggy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
BUTTON_TEXT_EVIDENCE_DIR=/Volumes/Sandisk-2TB-SSD/hermes/outputs/stcaths-button-text-motion/final \
bun run qa:button-text
```

The runner serves the actual production button/text-reveal bundles, the local Libre Franklin variable
font and installed GSAP/ScrollTrigger assets from `node_modules/gsap/dist`. Override paths with `BUTTON_TEXT_FONT_PATH`,
`TEXT_REVEAL_GSAP_PATH`, `TEXT_REVEAL_SCROLLTRIGGER_PATH`; optionally filter with
`BUTTON_TEXT_SCENARIO`. It writes screenshots, full AX trees, state JSON and `run-result.json` with
bundle/asset hashes, real partial progress/completion, typography at 360/768/1280, scope, native
activation, restoration/identity, replay, reduced motion, touch, cancellation, dynamic content and
dependency fallbacks. It never seeks or pauses the WAAPI animations. Browser checks remain pending
until that runner passes; a sandbox denial is a failure record, not a pass, and must not be retried
inside the coding sandbox.

### Hero intro

`components/hero-intro.js` joins the existing `Global / Intro Loader — Circle` CSS clock.
The one-second crest ring and expanding aperture stay in that component's Webflow embed.
The heading and brand arrive at 1.65s, menu at 1.75s, and supporting text/actions at 1.85s.
Heading and supporting text use the shared manual text factory; navbar arrivals and the
preparation masks are CSS in the loader embed. No stylesheet is stored in this repository.

| Webflow element | Attribute |
| --- | --- |
| Intro loader root (keep its authored `is-active` class) | `data-hero-intro=""` |
| Section / Hero root | `data-hero-intro-content=""` |
| Navbar logo wrapper | `data-hero-intro-nav="brand"` |
| Native menu trigger | `data-hero-intro-nav="menu"` |
| Navbar action wrapper | `data-hero-intro-nav="actions"` |

Before automatic text registration, `global.ts` marks the hero as manual only on pages with
the loader. Other hero instances keep their normal text behavior. A second font-loading event
can reprepare text before its reveal; the loader's completion does not depend on text handles
surviving that event. Late fonts or scripts use the readable CSS fallback without replaying.
Reduced motion, fragment links and history restoration skip the controlled sequence. Pointer,
keyboard, scrolling, resizing and page exit restore the native content immediately.

`bun run qa:hero-intro` checks four responsive sizes and interruption/fallback scenarios on the
real page with local JS overrides. Set `HERO_COMPONENT_EMBED_PATH` to a temporary export of the
Webflow loader embed outside the repository when testing unpublished styles. `HERO_EVIDENCE_DIR`
selects the evidence directory; `HERO_WIDTH` limits the run to one responsive size. Browser paths
use the same `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` options as the other runners.
The runner does not publish or edit Webflow.

### Navigation menu transitions

`global.js` loads `components/nav-menu.js` after the text-reveal component when
`[data-menu-motion]` is present. It uses the existing manual `menu` preset for word reveals,
with 55ms between rows. Submenu entry and Back first fade/lift the outgoing rows for
180ms with a 25ms stagger, change the native details state, then reveal the new labels.
The navigation menu's summaries alone delay their toggle for this exit; ordinary accordions,
links, search submission and native popover open/close controls are unchanged.

Webflow owns the markup and styles. In `Component / Nav Menu`:

| Element/class | Attribute |
| --- | --- |
| `nav-menu_wrapper` | `data-menu-motion=""`, `data-text-trigger="manual"` |
| `nav-menu_group` | `data-details-animate="false"` (opt out of the shared accordion height effect) |
| `nav-menu_link-text` | `data-menu-label=""` |
| `nav-menu_heading` / `nav-menu_back` | `data-menu-heading=""` / `data-menu-back=""` |
| `nav-menu_expand-icon` / `nav-menu_arrow-icon` | `data-menu-icon=""` |
| `nav-menu_ornament` | `data-menu-ornament=""` |
| Links wrapper, image, quick links, footer, top controls | `data-menu-surface="navigation\|image\|quicklinks\|footer\|top"` respectively |

Keep the existing `[data-nav-menu-popover]`, `[data-el="nav-group-list"]` and
`data-menu-section` hooks. The menu's existing Webflow `component-style` embed owns
the CSS; there is no stylesheet or mirrored CSS fixture in this repository.
The CSS uses native popover states, `@starting-style` and discrete `display`/`overlay`
transitions because these selectors and top-layer behavior cannot be expressed by ordinary
Designer states. The surface opens in 550ms and closes in 450ms, with a 200ms content exit.
Browsers without those CSS features keep native instantaneous surface changes.

The runtime readiness attribute gates the CSS enhancement. Missing dependencies leave a usable
native menu. Reduced motion skips transitions; enabling it or resizing mid-transition restores
readable text and settles the requested submenu. Native Escape/close interrupts immediately;
the CSS exit retains the painted surface without delaying native focus restoration. Reopening
starts at the main menu. Text is restored after each reveal and recreated on the next interaction.
The controller conceals the incoming panel while two animation frames settle after a details state
change and the text factory prepares its measurable contents. It removes that temporary mask only
when the incoming animation is ready, preventing a flash of unanimated text.

Run `bun run qa:nav-menu` with Playwright available via `PLAYWRIGHT_MODULE` and a Chrome executable
via `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. The runner opens the real published homepage in an isolated
browser, substitutes local production JS, and applies the matching Webflow attributes only
inside that browser. To test unpublished styling, export the component's current Webflow embed
to a temporary HTML file outside the repository and set `MENU_COMPONENT_EMBED_PATH` to that file.
Otherwise the runner uses the published Webflow styles. It does not publish or edit the site.
It checks all five submenus, Back,
partial opening/closing, keyboard focus and Escape, rapid closing, resize, reduced motion and
native navigation at 1440/820/667/390px. `MENU_EVIDENCE_DIR` selects the screenshot/results directory;
`MENU_WIDTH` optionally selects one width. Re-run without browser overrides after the approved
GitHub merge and Webflow publish to verify deployment.

### Academic results

`global.js` loads `components/statistics.js` when `[data-statistics]` is present.
Each `[data-statistic-value]` rolls its digits once when at least half visible,
matching the Astro concept: one revolution plus the final digit, 1800ms plus 90ms
per digit, a 70ms digit stagger, and `cubic-bezier(.22,.68,0,1)` easing.
Decimal points and percentage units stay still. Values come from the authored text.

In Webflow's `Element / Academic Results`, the `academic-results_component` list
has `data-statistics=""` and each of the three `academic-results_value` elements
has `data-statistic-value=""`. Its `component-style` embed owns the measured reel
overlays, clipping and edge fade, source visibility, reduced-motion fallback and
`--statistic-motion: 1` readiness flag. No stylesheet is stored in this repository.

The original text retains layout and accessibility throughout; decorative reels
are hidden from assistive technology. Completion restores the same original DOM
nodes. Reduced motion skips the animation; resizing, late fonts, page exit or
enabling reduced motion settles running values immediately. Missing CSS or JS
leaves the native values readable.

`bun run qa:statistics` checks four responsive widths, accessibility, original-node
restoration, repeat scrolling, interruption and missing-dependency fallbacks on the
real page with local JS overrides. Set `STATISTICS_COMPONENT_EMBED_PATH` to a
temporary export of the component's Webflow embed outside this repository for
unpublished styles. `STATISTICS_EVIDENCE_DIR` selects output; `STATISTICS_WIDTH`
limits the run to one width. Browser paths use `PLAYWRIGHT_MODULE` and
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`. The runner does not edit or publish Webflow.

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
