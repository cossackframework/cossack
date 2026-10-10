// Keep synchronous SSR dependencies out of the default browser graph. The
// explicit /server entry remains available when serialization is intentional.
export * from './index';
export { renderToString } from './browser-ssr';
