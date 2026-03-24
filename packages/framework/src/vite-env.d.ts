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
