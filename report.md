# Framework issues found while rebuilding cossack.dev

Observed on 2026-08-10 from the clean `master` checkout at `92a0efb`, with local packages reporting version `0.8.2`.

## 1. Cloudflare scaffold omits TypeScript

- Command: `cossack create cossack-dev --adapter cloudflare --preset minimal --features ui,markdown --theme neutral --yes`
- Generated `package.json` includes a TypeScript `tsconfig.json`, but no `typescript` dependency.
- Reproduction: after `pnpm install`, `pnpm tsc --noEmit` fails with `Command "tsc" not found`.
- Workaround used: `pnpm add -D -w typescript@^7.0.2`.
- Likely source: `packages/scaffold/src/index.js`, `packageJson()` dev dependency construction.

## 2. Placeholder Worker types block canonical Wrangler type generation

- A minimal Cloudflare scaffold writes `worker-configuration.d.ts` with hand-authored `DB`, `EMAIL`, and `APP_SECRET` declarations even though the project has no database or auth features.
- Running `wrangler types` fails with: `A non-Wrangler worker-configuration.d.ts already exists, please rename and try again.`
- This conflicts with the template comment and current Cloudflare guidance to generate bindings from `wrangler.jsonc`.
- Workaround used: delete the placeholder file, then run `wrangler types` to generate only `ASSETS`, `APP_NAME`, `APP_URL`, and `APP_LOCALE`.
- Likely source: `packages/scaffold/template/worker-configuration.d.ts` and scaffold file selection.

## 3. Generated Vitest command loads an incompatible Cloudflare Vite configuration

- The scaffold includes Vitest but no dedicated `vitest.config.ts`.
- Reproduction: add any `*.test.ts`, then run `vitest run` from the generated project.
- Startup fails in `@cloudflare/vite-plugin` because Vitest adds Node built-ins to the SSR environment's `resolve.external`, which the Cloudflare plugin rejects.
- Workaround used: add a standalone `vitest.config.ts` that does not import the application `vite.config.ts`.
- The scaffold should generate a test config when it advertises Vitest.

## 4. Solar Icons' TypeScript source is not consumable by Node-based SSR tests

- `@cossackframework/ui/dist/index.js` has a runtime import from `@cossackframework/solar-icons/types`.
- The installed Solar Icons package exports that path as `./src/types.ts` rather than compiled JavaScript.
- In a Node-based Vitest render test, the import fails with: `Stripping types is currently unsupported for files under node_modules`.
- The normal Vite application build succeeds because Vite transforms the dependency, but direct Node/SSR tooling cannot consume it safely.
- Likely fixes: publish compiled JS/declarations for Solar Icons exports, or remove the runtime `normalizeStyle` re-export/import from the UI barrel.

## 5. UI Modal drops pass-through accessibility attributes

- `ModalProps` advertises arbitrary HTML attributes, but `packages/ui/src/components/Modal.ts` does not collect/spread the remaining props onto `<dialog>`.
- Passing `aria-label`, `aria-labelledby`, `data-testid`, or other dialog attributes has no effect.
- This makes it impossible to give a generic UI Modal an accessible name through its public props.
- `Sheet` appears to implement the expected pass-through behavior and can be used as a comparison.

## 6. `Image()` accepts dimensions but does not render them

- `packages/core/src/shared/image.ts` accepts `width` and `height` and uses them for Cloudflare resizing, but the returned `<img>` omits `width` and `height` attributes.
- This prevents intrinsic aspect-ratio reservation and can cause layout shift even when callers supply dimensions.
- The helper should emit the provided dimensions as HTML attributes in addition to using them in the provider URL.

## 7. Generated `build:ssg` script builds the application twice

- The current scaffold writes `"build:ssg": "vite build && cossack ssg"` while the generated Vite config already installs `cossackSsg()`.
- Running the script completes a full SSR/client build and SSG pass, then `cossack ssg` reports `vite build (SSG runs via the cossackSsg plugin)` and repeats the full build and SSG pass.
- The output is correct, but build time and logs are duplicated.
- The scaffold script can likely be reduced to `vite build`, or the CLI should reuse the completed build instead of invoking Vite again when the plugin is present.

## 8. Scaffold can emit a compatibility date newer than bundled `workerd`

- On 2026-08-10, the generated `wrangler.jsonc` used `"compatibility_date": "2026-08-10"`.
- The installed Wrangler/Miniflare runtime supports dates only through `2026-08-08`, so `vite dev` fails before serving a page with `ERR_RUNTIME_FAILURE`.
- Workaround used: pin the project to the newest date reported by the bundled runtime, `2026-08-08`.
- Scaffold date generation should account for the compatible runtime shipped by its resolved Wrangler dependency rather than unconditionally using the current wall-clock date.

## 9. Minimal Vite config prebundles absent auth/database dependencies

- A minimal project generated without auth or database still includes `@cossackframework/auth` and `@cossackframework/database` in `environments.ssr.optimizeDeps.include` and `resolve.dedupe`.
- Starting Vite prints `Failed to resolve dependency` for both packages.
- Workaround used: remove the absent packages from the generated project config.
- The scaffold should compose these entries only when the corresponding feature/package is selected.

## 10. Renderer serializes boolean ARIA values as empty attributes

- Cossack UI Tabs binds `aria-selected=${current === item.value}` as a boolean.
- In the browser the selected tab renders as `aria-selected=""` instead of the required `aria-selected="true"`; unselected values are likewise not expressed as the ARIA string `"false"`.
- Keyboard selection and panel rendering still work, but assistive technology receives an invalid state value and automated accessibility checks can flag it.
- The renderer should distinguish ARIA attributes from native boolean attributes and serialize boolean values as `"true"` / `"false"`, or UI components must stringify ARIA states explicitly.
- Framework fix applied locally: Tabs now stringifies `aria-selected` and keeps every tabpanel in the DOM with inactive panels using the native `hidden` attribute, so every `aria-controls` reference remains valid.
- Related renderer behavior: a directly interpolated native boolean attribute serializes both `false` and `undefined` as an empty attribute (present), while `true` becomes the string `"true"`. Tabs therefore uses its existing class map plus a stringified `aria-hidden` state until native boolean serialization is corrected centrally.

## 11. Solar `Icon` entries disappear from Cloudflare development SSR

- The affected package is currently named `@cossackframework/solar-icons` (the reported `@cossackframework/icons` behavior maps to this package in the generated site).
- Reproduction: render Cossack UI `Icon` components in the shared header using entries imported from `@cossackframework/solar-icons/<name>`, then request `/` from `vite dev` without allowing the client JavaScript to run.
- The SSR HTML contains the surrounding buttons and Cossack component markers, but the icon slots are empty. Hand-authored inline GitHub/X/Discord SVGs are present in the same response. The missing Solar icons appear only after client hydration.
- Production SSG output does include the SVGs, so this is specifically a Cloudflare/Vite development SSR integration problem rather than invalid icon data.
- Importing the advertised single-style path (`/<name>/line`) did not correct the development SSR response. The package publishes TypeScript source files directly through every export, which is also the root of issue 4's Node SSR failure and is the likely integration boundary to fix.
- Site workaround: critical shell, dialog, and clipboard glyphs now use equivalent compile-time inline SVG templates. A raw `curl` response from `vite dev` contains all 12 `.ui-icon` SVGs before hydration.
- Recommended framework/package fix: publish compiled ESM JavaScript plus declarations for icon entries and types, then add a Cloudflare Vite SSR test that asserts `renderToString(component(Icon, ...))` survives the development worker module graph.
- Follow-up from browser review: the initial site workaround using nested inline-SVG `TemplateResult` helpers was reported to exhibit the inverse behavior in another served build—the SVG appeared in SSR HTML and disappeared after hydration. The current local Playwright run did not reproduce that second symptom, but it suggests SVG subtree reconciliation can vary across the development/SSG hydration paths.
- Hardened site workaround: critical glyphs now render as simple `<span>` nodes with CSS masks, avoiding SVG child reconciliation entirely. Regression coverage asserts the masks exist with JavaScript disabled, remain visible after hydration, and survive a reactive theme-toggle render.
- Package-page follow-up: `/packages/solar-icons` now renders 13 real UI `Icon` components. Their SVGs are present in unit SSR output and remain visible after browser hydration, but every Vite-development navigation to the page logs `[cossack] hydration mismatch, falling back to render: existing shorter than blueprint (expected <!--CRP_2-->)`. This narrows the remaining failure to marker reconciliation around `Icon`'s nested `unsafeHTML()` output rather than missing icon data; the hydration fallback masks the visual loss but still discards SSR work.
- Database-page follow-up: nine direct Solar entry imports passed through UI `Icon` render correctly after a client-side route transition, but a direct Vite-development request to `/packages/database` produces empty icon slots in the initial page and does not subsequently hydrate them. Desktop review reached the page through client navigation and showed the icons; mobile review loaded it directly and showed none. The site now uses compile-time CSS-mask glyphs for this rail so direct SSR and client navigation are visually identical.
- Reduced-motion follow-up: a direct Vite-development request to `/packages/solar-icons` with `prefers-reduced-motion: reduce` SSR-renders the hero `PlanetIcon`, then hydration logs `existing shorter than blueprint (expected <!--CRP_2-->)` and removes that SVG from the DOM. The same hero icon is visible when the page is reached through client navigation without reduced motion. The site now renders the identical duotone planet as a local static SVG image and reserves UI `Icon` for the non-critical gallery; a Playwright regression asserts the hero survives hydration and that both its spin and label orbits collapse to the reduced-motion duration.

## 12. Markdown transform can split a valid wrapper into invalid HTML fragments

- Reproduction: configure a Markdown processor that returns valid nested HTML such as `<article><h1>Title</h1><p>Body</p></article>`, then render the generated `.md` route through `vite dev`.
- `packages/framework/src/vite-plugin.ts` blindly splits the processed string immediately after the first `</h1>` so it can insert the author/date byline. The generated page therefore passes `<article><h1>Title</h1>` and `<p>Body</p></article>` to two separate `unsafeHTML()` calls.
- Each fragment is parsed independently, so the browser auto-closes the first `<article>` and discards the unmatched closing tag in the second fragment. The resulting DOM no longer matches the processor's valid structure and hydration warns: `[cossack] hydration mismatch, falling back to render: existing shorter than blueprint (expected <!--CRP_1-->)`.
- Site workaround: keep the H1 as a top-level node and begin all structural wrappers after it. This removes the warning, but the processor API does not document this constraint and otherwise-valid processor output should not be corrupted.
- Recommended framework fix: insert byline data in the AST/processor contract, avoid string-splitting arbitrary HTML, or at minimum detect wrapper boundaries and document/test the required top-level H1 structure.

## 13. UI Tabs underline indicator has no initial SSR style

- Reproduction: render `Tabs` with `variant: 'underline'`, omit an explicit `value`, and let the component select `items[0]` as documented.
- The first trigger correctly renders `aria-selected="true"`, but `.cs-tabs__indicator` has an empty inline style in SSR HTML. On cossack.dev the active Syntax tab therefore has no visual active state until a tab is clicked.
- `Tabs.updateIndicator()` measures the active trigger and writes the indicator position only on the client. The initial measurement does not reliably produce a visible indicator during this page's hydration, while `selectTab()` followed by `requestAnimationFrame()` does after interaction.
- Site workaround: style `.cs-tabs__trigger[aria-selected="true"]` directly, which gives the initial SSR state and every later selected state a deterministic visual treatment.
- Recommended UI fix: make the selected trigger carry the base active styling for both variants, treating the measured sliding indicator as progressive enhancement rather than the only underline state. Add an SSR/hydration test asserting the default tab is visibly selected before interaction.

## 14. SSG runner omits application Vite plugins and cannot resolve their virtual modules

- Reproduction: register an application Vite plugin that resolves `virtual:site-content`, import that module from an SSG page, then run `vite build` with `cossackSsg()`.
- The normal SSR and client builds both resolve and bundle the virtual module successfully. During `[cossack/ssg] Starting static rendering`, the page import fails with `Cannot find module 'virtual:site-content'`.
- `packages/framework/src/vite-ssg-plugin.ts` calls `runnerImport()` with `configFile: false` behavior and reconstructs only Cossack's own plugins. Application-defined plugins from `vite.config.ts` are unavailable to the ephemeral SSG module runner.
- Site workaround: compile the Markdown collections into a generated physical TypeScript module before the build. The SSG runner can import that file without the omitted application plugin.
- Recommended framework fix: preserve or explicitly accept application plugins when constructing the runner configuration, or render from the completed SSR bundle instead of re-importing source through a partial Vite configuration. Add an integration fixture whose SSG page imports an application-owned virtual module.

## 15. UI Switch exposes nested interactive semantics

- `packages/ui/src/components/Switch.ts` renders `<label role="switch" aria-checked=...>` around a focusable native `<input type="checkbox">`.
- Axe reports `nested-interactive` because the element with the interactive switch role contains another interactive control. It also reports the missing required `aria-checked` value because the renderer serializes the boolean as an empty attribute (issue 10).
- Site workaround: use the UI Checkbox component in the package showcase instead of Switch.
- Recommended UI fix: put `role="switch"` and the stringified `aria-checked` value on the native checkbox itself, leaving the label as the accessible labeling wrapper. Add an axe regression test for checked and unchecked states.

## 16. Neutral UI palette semantic success/warning text fails WCAG AA contrast

- In the generated neutral light theme, UI Badge and Alert use `text-success` / `text-warning` over 10%-tinted semantic backgrounds.
- Axe measured success at 2.87:1 (`#00a63e` on `#e6f6ec`) and warning at 1.97:1 (`#fe9a00` on `#fff5e5`) for normal-sized text; both require 4.5:1.
- Site workaround: scope darker semantic foreground values to the UI package showcase while retaining the components' tinted backgrounds.
- Recommended UI fix: separate semantic foreground tokens from bright accent/fill tokens, or darken the neutral palette's success and warning text values. Add light/dark axe coverage for every Badge and Alert variant.

## 17. Neutral UI palette muted foreground can miss WCAG AA for small text

- The neutral palette defines light-mode `--muted-foreground` as `oklch(0.556 0 0)` over a white `--background`.
- In Chromium/axe on the cossack.dev UI package gallery, a 12px caption using that token resolved to `#787878` on `#ffffff`, measured at 4.41:1, and failed the WCAG AA 4.5:1 requirement for normal text.
- The failure reproduced after switching the gallery Tabs component to its Usage panel and scanning the visible caption; it was reported as a serious `color-contrast` violation.
- Site workaround: use a darker `oklch(0.42 0 0)` foreground for small gallery captions in light mode and an explicit lighter value in dark mode.
- Recommended UI fix: lower the neutral light-mode muted foreground enough to remain safely above 4.5:1 across browser color conversion, or document a stronger caption token for text below the large-text threshold. Add axe coverage for 12px muted text on the default background.

## 18. Page discovery treats co-located test files as application routes

- Reproduction: add `src/pages/packages/package-pages.test.ts` containing Vitest tests, then run the generated `pnpm run build:ssg` command.
- The regular SSR and client builds include the test module as a page chunk. When static rendering starts, importing the generated pages registry executes Vitest's `describe()` outside a test runner and fails in `@vitest/runner` with `TypeError: Cannot read properties of undefined (reading 'config')`.
- This indicates route discovery includes files matching `*.test.ts` under `src/pages` instead of excluding test/spec modules and other conventional non-route companions.
- Site workaround: move the test to `src/package-pages.test.ts`, outside the route tree.
- Recommended framework fix: exclude at least `*.test.*`, `*.spec.*`, test fixture directories, and declaration files during page discovery. Add a Vite/SSG fixture with a co-located page test and assert it never appears in the virtual page registry or client chunks.

## 19. On default adapter (Cloudflare), we still get `scripts/dev.js`, which is Node.js specific.