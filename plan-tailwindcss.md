# Plan - Tailwind CSS Integration

## Objective
Integrate Tailwind CSS 4.x (via the `@tailwindcss/vite` plugin) into the Cossack Framework so that developers can use Tailwind utility classes in both server-side rendered and client-side components with zero friction.

---

## 1. Current State Analysis

### How CSS works today
1. **`src/style.css`** contains plain CSS rules. It is imported by `src/client/entry-client.ts` (`import '../style.css'`).
2. **Vite client build** (`vite.client.config.ts`) processes the CSS import and emits a hashed CSS asset (e.g. `assets/entry-client.LFqhaMsZ.css`) into `dist/client/`.
3. **SSR HTML generation** (`src/root.ts:34`) reads the client build manifest to find the CSS filename and injects a `<link rel="stylesheet">` tag into the HTML document.
4. **SSG rendering** (`src/ssg-renderer.ts:286-287`) does the same — reads the manifest and injects the CSS link.
5. There is **no PostCSS config** and **no Tailwind config** anywhere in the monorepo.

### Template system
- Components use `html` tagged template literals from `@cossackframework/renderer`.
- Class names are plain strings: `class="nav-link ${condition ? 'active' : ''}"`.
- Tailwind utility classes (e.g. `text-3xl font-bold`) work as plain strings too — no changes needed to the renderer.

### Build pipeline
- **Client build**: `vite build --config vite.client.config.ts` → outputs to `dist/client/`
- **SSR build**: `vite build --config vite.ssr.config.ts --ssr` → outputs to `dist/worker/`
- Both builds use the `cossackPages` Vite plugin (file-based routing). The client build also uses `cossackSecurityPlugin` (strips server-only code).
- `create-cossack-app` scaffolds new projects from `packages/create-cossack-app/template/`, which has its own `vite.client.config.ts`, `vite.ssr.config.ts`, and `style.css`.

---

## 2. Changes Required

### 2.1 `packages/create-cossack-app` (scaffolding — new projects)

This is where the primary integration lives, since this is what end-users get when they run `create-cossack-app`.

#### 2.1.1 Add dependencies to `template/package.json`

```diff
  "devDependencies": {
+   "@tailwindcss/vite": "^4.1.0",
+   "tailwindcss": "^4.1.0",
    ...
  }
```

Both `tailwindcss` and `@tailwindcss/vite` are needed. Tailwind v4 uses a CSS-first config — no `tailwind.config.js` is required.

#### 2.1.2 Add `@tailwindcss/vite` plugin to `template/vite.client.config.ts`

```diff
  import { defineConfig } from 'vite';
  import path from 'path';
+ import tailwindcss from '@tailwindcss/vite';
  import { cossackPages } from '@cossackframework/framework/vite-plugin';
  import { cossackSecurityPlugin } from '@cossackframework/framework/vite-security-plugin';

  export default defineConfig(({ mode }) => {
    return {
      plugins: [
+       tailwindcss(),
        cossackSecurityPlugin({ mode: 'client', devWarning: true }),
        cossackPages({ mode }),
      ],
      ...
    };
  });
```

**Plugin order**: `tailwindcss()` should come first so it processes CSS before other plugins.

#### 2.1.3 Add `@tailwindcss/vite` plugin to `template/vite.ssr.config.ts`

```diff
  import { defineConfig } from 'vite';
  import path from 'path';
+ import tailwindcss from '@tailwindcss/vite';
  import { cossackPages } from '@cossackframework/framework/vite-plugin';

  export default defineConfig(({ mode }) => {
    return {
      plugins: [
+       tailwindcss(),
        cossackPages({ mode }),
      ],
      ...
    };
  });
```

The SSR build needs the plugin too so that any CSS `@import "tailwindcss"` encountered during SSR is resolved correctly. The actual CSS output is produced by the client build (which the SSR `root.ts` reads from the manifest), but the SSR build still needs to resolve the import to avoid build errors.

#### 2.1.4 Replace `template/src/style.css`

```css
@import "tailwindcss";
```

Users can add custom CSS below this line (custom `@theme` overrides, `@layer` additions, etc.).

### 2.2 `packages/framework` (the example/demo app)

The framework package itself is a runnable application that demonstrates all features. It should also be updated to use Tailwind so the demo pages serve as living examples.

#### 2.2.1 Add dependencies to `packages/framework/package.json`

```diff
  "devDependencies": {
+   "@tailwindcss/vite": "^4.1.0",
+   "tailwindcss": "^4.1.0",
    ...
  }
```

#### 2.2.2 Update `packages/framework/vite.client.config.ts`

Same change as the template — add `import tailwindcss from '@tailwindcss/vite'` and `tailwindcss()` as the first plugin.

#### 2.2.3 Update `packages/framework/vite.ssr.config.ts`

Same change — add the Tailwind Vite plugin.

#### 2.2.4 Replace `packages/framework/src/style.css`

```css
@import "tailwindcss";
```

The existing plain CSS rules in `style.css` (e.g., `h1`, `main`, `aside`, `button[data-variant]`) should be removed — they can be replaced with Tailwind utility classes directly in the component templates if desired, or kept as custom CSS below the `@import` if preferred.

### 2.3 No changes needed to library packages

- **`@cossackframework/core`** — Pure TypeScript, no CSS.
- **`@cossackframework/renderer`** — Template engine, no CSS. The `html` tagged template already supports class attributes as plain strings.
- **`@cossackframework/node-adapter`** — Runtime adapter, no CSS.

---

## 3. Tailwind v4 Content Detection

Tailwind v4 automatically detects template files by scanning for class-like strings in the project. Since Cossack components use:

- `src/pages/**/*.ts` — page components
- `src/pages/**/*.mdx` — MDX pages
- `src/components/**/*.ts` — shared components
- `src/App.ts` — global app component

All of these are `.ts` files containing `class="..."` strings inside `html` tagged templates. Tailwind v4's default content detection scans all non-`node_modules` files, so **no `content` configuration is needed**. It will find classes like `class="text-3xl font-bold"` in `.ts` files automatically.

If needed, users can customize content sources in their CSS:

```css
@import "tailwindcss";

@source "../src";
```

But the default should work out of the box.

---

## 4. SSR/SSG Compatibility

### How it works
1. **Client build** processes `style.css` with `@import "tailwindcss"` → Tailwind scans all `.ts` files, finds used utility classes, and emits a single CSS file into `dist/client/assets/`.
2. **`root.ts`** reads the client build manifest, finds the CSS asset, and injects `<link rel="stylesheet" href="/{css-file}">` into the SSR HTML. This already works — no changes needed to `root.ts` or `ssg-renderer.ts`.
3. **SSR build** compiles the server worker. The `@tailwindcss/vite` plugin ensures the `@import "tailwindcss"` is resolved (not left as-is), but the SSR build doesn't emit CSS assets — it relies on the client build's output.

### Known issue with `@tailwindcss/vite` and dual builds
There is a known issue ([tailwindlabs/tailwindcss#16389](https://github.com/tailwindlabs/tailwindcss/issues/16389)) where CSS asset hashes can differ between client and SSR builds. In the Cossack architecture, this is **not a problem** because:
- The CSS is only produced by the **client build**.
- The SSR build does **not** produce or link CSS — it reads the client manifest.
- `root.ts` and `ssg-renderer.ts` both reference CSS from the client manifest only.

### Dev mode (Wrangler)
In dev mode, Wrangler runs `vite build` via the `build.command` in `wrangler.jsonc`. The Tailwind plugin will process CSS during these builds. Vite's dev server (if used separately via `scripts/dev.js`) also supports the `@tailwindcss/vite` plugin with HMR.

---

## 5. Testing Strategy

### 5.1 Build verification
- Run `pnpm run build` from the monorepo root and verify both client and SSR builds complete without errors.
- Verify the client build produces a CSS asset containing Tailwind utility classes.

### 5.2 Existing e2e tests
- Run `cd packages/framework && pnpm exec playwright test` to verify all existing e2e tests pass after the integration. These tests verify SSR, navigation, state sync, etc. — none should be affected since CSS is a separate concern.

### 5.3 New e2e test — Tailwind class rendering
- Create a test page that uses Tailwind utility classes in its `html` template.
- Verify via Playwright that:
  - The page renders correctly (SSR).
  - The utility classes are present in the DOM.
  - The styles are computed correctly (e.g., `getComputedStyle` checks).
  - Client-side navigation to/from the page works without style loss.

### 5.4 Existing unit tests
- Run `cd packages/core && pnpm vitest --run` and `cd packages/renderer && pnpm vitest --run` to confirm no regressions in library packages.

---

## 6. Implementation Order

| Step | What | Package |
|------|------|---------|
| 1 | Install `tailwindcss` + `@tailwindcss/vite` | `framework` |
| 2 | Add `tailwindcss()` plugin to `vite.client.config.ts` | `framework` |
| 3 | Add `tailwindcss()` plugin to `vite.ssr.config.ts` | `framework` |
| 4 | Replace `src/style.css` with `@import "tailwindcss"` | `framework` |
| 5 | Verify builds pass | `framework` |
| 6 | Run existing e2e tests | `framework` |
| 7 | Install `tailwindcss` + `@tailwindcss/vite` | `create-cossack-app/template` |
| 8 | Add plugin to both template vite configs | `create-cossack-app/template` |
| 9 | Replace `template/src/style.css` | `create-cossack-app/template` |
| 10 | Add Tailwind test page + e2e test | `framework` |
| 11 | Run full test suite | all |

---

## 7. What Does NOT Change

- **Renderer** — The `html` tagged template literal, `TemplateResult`, `renderToString`, and `render` functions are unchanged. Tailwind classes are just strings in `class` attributes.
- **Core decorators** — `@State`, `@Server`, `@Client`, etc. have no relationship to CSS.
- **Security plugin** — Code stripping logic is unaffected by CSS changes.
- **`root.ts` / `ssg-renderer.ts`** — These already read CSS from the client manifest. No changes needed.
- **`router.ts`** — Routing logic is unaffected.
- **Wrangler config** — Build commands remain the same.
- **Node adapter** — Runtime adapter, no CSS involvement.

---

## 8. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Tailwind v4 auto-detection misses classes in tagged template literals | Low — Tailwind v4 scans all source files by default | Users can add `@source` directives in CSS if needed |
| SSR build fails on `@import "tailwindcss"` | Low — `@tailwindcss/vite` handles this | Adding the plugin to the SSR config resolves this |
| Large CSS bundle size | Low — Tailwind v4 only includes used utilities | No action needed; tree-shaking is built-in |
| Dev mode HMR issues with Wrangler | Medium — Wrangler runs builds, not Vite dev server | Monitor and report if HMR breaks; full reload still works |
| Existing tests break | Low — CSS is orthogonal to component logic | Verified by running full test suite |