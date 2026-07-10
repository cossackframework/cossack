// src/config/app.ts
//
// Application configuration. Each file in `src/config/` default-exports a
// factory `({ env }) => ({...})` evaluated per request, so it can read request-
// scoped environment bindings (`env('KEY', default)`). Access values anywhere
// with `config('app.name')` (dotted: file name + nested path).
//
//   import { config } from '@cossackframework/framework/config';
//   const appName = config('app.name'); // 'My App'
import type { EnvFunction } from '@cossackframework/framework/config';

export interface AppConfig {
    name: string;
    env: string;
    debug: boolean;
    url: string;
    timezone: string;
    locale: string;
    fallback_locale: string;
    key: string;
}

// Register the typed shape so `config('app.name')` infers `string`,
// `config('app.debug')` infers `boolean`, etc. Without this, config() still
// works but returns `unknown`.
declare module '@cossackframework/framework/config' {
    interface CossackConfigRegistry {
        app: AppConfig;
    }
}

export default ({ env }: { env: EnvFunction }): AppConfig => ({
    name: env('APP_NAME', 'My App'),
    env: env('APP_ENV', 'production'),
    debug: env('APP_DEBUG', 'false') === 'true' || env('APP_DEBUG') === '1',
    url: env('APP_URL', 'http://localhost'),
    timezone: 'UTC',
    locale: env('APP_LOCALE', 'en'),
    fallback_locale: env('APP_FALLBACK_LOCALE', 'en'),
    key: env('APP_SECRET'),
});
