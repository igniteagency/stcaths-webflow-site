# AGENTS.md

This file provides guidance to coding agents (Claude Code, Codex, and others) when working with code in this repository.

## Project Overview

This is a Webflow JavaScript starter project where JavaScript/TypeScript is authored and managed separately from HTML/CSS (which remain in Webflow). Scripts are not bundled into a single file - each script is loaded individually per page as needed, with only `src/entry.ts` (built as `entry.js`) loaded globally. The system uses esbuild for building and serves scripts from either localhost during development or jsDelivr CDN in production.

Component CSS belongs in that component's Webflow embed; behavior and programmatic animation belong in its `.ts` component file. Do not commit separate CSS files or mirrored CSS fixtures. Browser QA can read a temporary export of the Webflow embed from outside the repository.

When working on JavaScript/TypeScript in this repository, always report exactly what was changed in Webflow in the final handoff. Name the affected site/page and component, identify the elements, list attribute names and values, and describe each embed/CSS, style, setting, property or structure change (including animation timings where relevant). State whether changes were saved only or actually published. Do not summarize this merely as "hooks and CSS updated." If no Webflow edits were made, explicitly say "No Webflow changes." This is a reporting requirement, not an additional approval step.

**Think carefully and only action the specific task I have given you with the most concise and elegant solution that changes as little code as possible.**

## Key Architecture Concepts

### Script Loading System

- **Entry Point**: `src/entry.ts` is the main entry file that sets up the global script loading system
- **Dynamic Loading**: Use `window.loadScript()` function to load scripts dynamically (replaces the old `window.JS_SCRIPTS` approach)
- **Environment Switching**: Scripts can be served from localhost (`local` mode) or CDN (`cdn` mode) using `window.setScriptMode()`
- **CDN Integration**: Production scripts are served via jsDelivr CDN from GitHub releases
- **Branch Convention**: Production and pre-launch Webflow sites use the default `main` branch. Use `dev` only for an explicitly requested dev-only test.

### Native Details Groups

- `src/components/details.ts` infers an exclusive group from any parent containing at least two direct-child `<details>` elements.
- Do not require `data-details-group` to activate normal groups. Use `data-details-group="false"` only to opt direct siblings out of exclusivity.
- Preserve authored `[open]` state. `data-accordion-open` is a Webflow Designer preview control and must not set published runtime state.
- `.tabbed-content_tabs` opens its first item only when no direct child is authored open.
- Native shared `name` owns exclusivity; unsupported browsers use only the scoped `toggle` fallback.
- Do not intercept summary clicks or animate disclosure height in JavaScript for normal accordions. Webflow CSS owns progressive enhancement.
- `src/components/switching-tabs.ts` is the exception: nested tab `details` are not siblings, so JS exclusive-switches and autoplays only. Still do not animate height in JS. Load it via `conditionalLoadScript` from `global.ts`.

### Build System

- **Build Tool**: Uses esbuild with custom build script at `bin/build.js`
- **File Processing**: Processes files defined in the `files` array in `bin/build.js`
- **Output Directories**:
  - Development: `./dist/dev` (served locally, excluded from Git)
  - Production: `./dist/prod` (committed to Git, served via CDN)

### TypeScript Configuration

- **Path Aliases**: Uses TypeScript path mapping for clean imports:
  - `$components/*` → `src/components/*`
  - `$utils/*` → `src/utils/*`
  - `$types/*` → `src/types/*`
  - `$dev/*` → `src/dev/*`
- **Global Types**: All global variables, types, and browser extensions are defined in `src/types/global.d.ts`
- **Type Priority**: Always use types from `global.d.ts` before importing from external libraries
- **DOM Extensions**: Extends `ParentNode` for type-safe `querySelector`/`querySelectorAll` returning `HTMLElement`

## Development Commands

### Start Development Server

```bash
bun run dev
# or: pnpm run dev / npm run dev
```

Starts esbuild development server on http://localhost:3000 with hot reloading.

### Build for Production

```bash
bun run build
# or: pnpm run build / npm run build
```

Generates minified production files in `./dist/prod` folder.

### Environment Switching (Browser Console)

```javascript
// Switch to localhost serving (when dev server is running)
window.setScriptMode('local');

// Switch to CDN serving
window.setScriptMode('cdn');

// Enable debug mode
window.setDebugMode(true);
```

## Coding Standards & Conventions

### Naming Conventions

- **Constants**: Use `UPPER_SNAKE_CASE` for constant variables, placed at the top of the file
- **Files/Folders**: Use kebab-case for files and folders
- **Page Scripts**: Named after the page (e.g., `home.ts`)
- **Data Attributes**: Always use `data-el="{{contextual value}}"` for selecting HTML elements instead of class names
  - For specialized modules, use custom data attributes (e.g., `data-marquee-el="component"`)

### Code Quality Rules

- **No jQuery**: Never use jQuery, even if Webflow loads it - use vanilla TypeScript and modern browser APIs
- **Error Handling**: Always handle errors gracefully using `console.error` for errors and `console.debug` for debug logs (never `console.log`)
- **Performance**: Prioritize modern browser APIs (e.g., use `IntersectionObserver` instead of scroll event listeners)
- **Modularity**: Avoid global side effects; keep logic scoped to the relevant module or component
- **Comments**: Minimize code comments; code should be self-explanatory and modular

### Animation & Libraries

- **GSAP**: Prefer GSAP for all animations, use ScrollTrigger for scroll-based effects
- **Finsweet TS Utils**: Use for Webflow-related utilities
- **External Libraries**: Only import if native browser APIs are insufficient

## File Structure & Patterns

### Source Organization

- `src/entry.ts` - Global entry point, contains only logic needed for all pages
- `src/global.ts` - Global utilities and Webflow integration
- `src/components/` - Reusable UI components/modules
- `src/pages/` - Page-specific scripts (loaded per page as needed)
- `src/utils/` - Utility functions
- `src/dev/` - Development utilities (debug, environment switching)
- `src/types/global.d.ts` - All global types and browser extensions

### Script Loading Pattern

Always use `window.loadScript()` for dynamic script loading:

```javascript
// Load a script from the repo
window.loadScript('global.js');

// Load external library with options
window.loadScript('https://cdn.jsdelivr.net/npm/library@1.0.0/dist/index.js', {
  placement: 'head',
  scriptName: 'library-name',
});

// Listen for script load events
document.addEventListener('scriptLoaded:library-name', (e) => {
  // Script loaded successfully
});
```

## Deployment Process

1. **Development**: Work locally with `bun run dev` serving from localhost
2. **Build**: Run `bun run build` to generate production files
3. **Deploy**: Merge to `main` branch triggers GitHub Actions that:
   - Creates semver tag (patch by default, use `#major` or `#minor` in commit message for higher bumps)
   - Makes scripts available via jsDelivr CDN
4. **CDN**: Starter scripts are served from `https://cdn.jsdelivr.net/gh/igniteagency/webflow-js-starter-new/dist/prod/`

## Development Guidelines

### Debugging & Logging

- Use `console.debug()` instead of `console.log()` for debug logs
- Debugging features (e.g., GSAP markers) should be toggled via `window.IS_DEBUG_MODE`
- Console logs should use styles from `src/dev/console-styles.ts` for clarity
- Environment switching between local and CDN managed via `window.setScriptMode` and `window.SCRIPTS_ENV`

### Formatting & Linting

- Uses Prettier for code formatting (trailing commas, single quotes, 2-space tabs, 100-char print width)
- Uses `@trivago/prettier-plugin-sort-imports` for import order: third-party, `$`-prefixed, then relative imports
- ESLint present but not strictly enforced; no testing frameworks used

## Important Notes

- Repository must remain **public** for jsDelivr CDN access
- Update repository name in README.md and `src/entry.ts` after forking
- jsDelivr caches tagged versions for 12 hours
- The `entry.js` file must be included in Webflow's `<head>` section first
- Scripts are loaded as IIFE by default
- Never handle user data or sensitive information in this codebase
- Do not use batch script loading; always use `window.loadScript` for dynamic loading
- **For any library dependency related information, do confirm the fact by doing a web search on the respective documentation instead of making a guess**

## Git Workflow

- Keep commit messages concise while mentioning changes and details
- Use semantic versioning tags for releases (`#major`, `#minor` for version bumps)
- Main branch deployments trigger automatic CDN updates via GitHub Actions

## Dependencies

- **Runtime**: Bun (preferred), PNPM, or NPM
- **Build**: esbuild with TypeScript support
- **Libraries**: GSAP (globally available from CDN), Finsweet TypeScript utilities
- **Linting**: ESLint with Finsweet config, Prettier

## External Documentation References

- [Webflow API Docs for LLMs](https://developers.webflow.com/llms.txt)
- [Webflow Data API Reference](https://developers.webflow.com/v2.0.0/data/reference/rest-introduction.mdx)
- [Finsweet TS Utils Documentation](https://finsweet.com/ts-utils/)
- [jsDelivr CDN Documentation](https://www.jsdelivr.com/documentation)
- [Bun Documentation](https://bun.sh/docs)
- [esbuild Documentation](https://esbuild.github.io/)
