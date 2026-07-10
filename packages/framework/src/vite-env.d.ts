/// <reference types="vite/client" />

declare module 'virtual:cossack-pages' {
  interface PageModule {
    default: unknown;
  }

  // For lazy loading (client build), pages are functions that return promises
  type PageModuleLoader = () => Promise<PageModule>;

  interface LayoutModule {
    default: new () => import('@cossackframework/core').Cossack;
  }

  interface LoadingModule {
    default: unknown;
  }

  interface ComponentModule {
    [key: string]: unknown;
  }

  interface CossackPagesRegistry {
    // Pages can be either the module directly (SSR/eager) or a loader function (client/lazy)
    pages: Record<string, PageModule | PageModuleLoader>;
    layouts: Record<string, LayoutModule>;
    loadings: Record<string, LoadingModule | undefined>;
    components: Record<string, ComponentModule>;
  }

  const registry: CossackPagesRegistry;
  export default registry;
}

declare module 'virtual:cossack-ssg' {
  export { collectSsgRoutes, renderSsgPage, getStaticParams, filePathToRoutePath } from './ssg-renderer';
  export { generateSitemap } from './sitemap-generator';
}

declare module 'virtual:cossack-lang' {
  type TranslationCatalog = Record<string, string>;

  // Client: a lazy loader per locale (code-split chunk).
  // Server: a thunk resolving to the already-imported catalog.
  type CatalogLoader = () => Promise<{ default: TranslationCatalog } | TranslationCatalog>;

  export const defaultLocale: string;
  export const supportedLocales: string[];
  export const catalogs: Record<string, CatalogLoader>;
  export function loadCatalog(locale: string): Promise<TranslationCatalog | undefined>;
}

declare module 'virtual:cossack-middlewares' {
  import type { MiddlewareHandler } from 'hono';
  /** Ordered list of global request middlewares from `src/bootstrap/middlewares.ts`. */
  const middlewares: MiddlewareHandler[];
  export default middlewares;
}

declare module 'virtual:cossack-config' {
  import type { ConfigFactory } from '@cossackframework/core';
  /** Config factories from `src/config/*.ts`, keyed by file name (no extension). */
  const configs: Record<string, ConfigFactory>;
  export default configs;
}

// Programmatic TS loader used by the `cossack ssg` CLI to import user `.ts`
// pages/App outside of Vite. Typed loosely to avoid coupling to tsx internals.
declare module 'tsx/esm/api' {
  export function tsImport(name: string, defaultCase?: unknown): Promise<Record<string, unknown>>;
}

// Ambient globals registered by the framework (src/i18n-globals.ts) so
// `__('key')`, `setLocale('es')`, `getLocale()`, and `isLocale('es')` work
// in render() without explicit imports. This file is a global script (no
// top-level import/export), so plain `declare function` is globally visible.
declare function __(key: string, params?: Record<string, string | number>): string;
declare function setLocale(locale: string): Promise<void>;
declare function getLocale(): string;
declare function isLocale(locale: string): boolean;
