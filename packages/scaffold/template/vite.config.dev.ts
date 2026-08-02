/**
 * Dev-only Vite config overlay for contributors linking a local Cossack
 * framework checkout (`pnpm link` / workspace overrides pointing at a clone of
 * the framework repo).
 *
 * WHY THIS EXISTS
 * ---------------
 * When @cossackframework packages resolve to TypeScript source (the case while
 * they're linked locally, pre-1.0), Vite's SSR loader re-transforms every one
 * of their ~100 source files on each cold dev start — ~14s of pure TS
 * transform time per boot. Pre-bundling them once with esbuild (and caching the
 * result in node_modules/.vite/deps_ssr) cuts cold start to ~5s and warm start
 * to ~2.5s. The app's own src/ still transforms normally, so HMR is unaffected.
 *
 * This is applied ONLY when the COSSACK_LOCAL env var is set (see scripts/dev.js):
 *
 *   COSSACK_LOCAL=1 pnpm dev
 *
 * WHEN YOU DON'T NEED THIS
 * ------------------------
 * If your @cossackframework/* deps come from npm (normal install), they ship
 * pre-built and Vite's optimizer handles them with no help — leave COSSACK_LOCAL
 * unset and this file is never loaded. The block is also harmless if loaded
 * against built packages (Vite just re-bundles ESM, near-instant), so a stale
 * flag can't break your build — only waste a little startup time.
 *
 * EDITING THE PACKAGE LIST
 * ------------------------
 * If you link additional Cossack packages locally (or stop linking one), edit
 * the array below. Only list packages that resolve to `src/*.ts` in your
 * checkout — everything else is fine without an entry.
 */
import type { UserConfig } from 'vite';

const devConfig: UserConfig = {
  environments: {
    ssr: {
      optimizeDeps: {
        include: [
          '@cossackframework/ui',
          '@cossackframework/auth',
          '@cossackframework/orm',
        ],
      },
    },
  },
};

export default devConfig;
