// src/config/app.ts
//
// Application configuration. Each file in `src/config/` default-exports a
// factory `({ env }) => ({...})` evaluated per request, so it can read request-
// scoped environment bindings (`env('KEY', default)`). Access values anywhere
// with `config('app.name')` (dotted: file name + nested path).
//
//   import { config } from '@cossackframework/core';
//   const appName = config('app.name'); // 'My App'
export default ({ env }) => ({
  name: 'My App',
  env: env('APP_ENV', 'production'),
});
