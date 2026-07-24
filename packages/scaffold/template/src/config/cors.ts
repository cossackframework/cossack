import type { EnvFunction } from '@cossackframework/framework/config';
import type { CorsConfig } from '@cossackframework/framework/cors';

declare module '@cossackframework/framework/config' {
    interface CossackConfigRegistry {
        cors: CorsConfig;
    }
}

const csv = (value: string): string[] =>
    value.split(',').map((entry) => entry.trim()).filter(Boolean);

const origins = (value: string): string[] =>
    csv(value).map((origin) => origin === '*' || origin.includes('*.')
        ? origin
        : origin.replace(/\/+$/, ''));

export default ({ env }: { env: EnvFunction }): CorsConfig => ({
    enabled: ['true', '1'].includes(env('CORS_ENABLED', 'true').toLowerCase()),
    origins: origins(env('CORS_ORIGINS')),
    methods: csv(env('CORS_METHODS', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS'))
        .map((method) => method.toUpperCase()),
    headers: csv(env('CORS_HEADERS')),
    exposeHeaders: csv(env('CORS_EXPOSE_HEADERS')),
    credentials: ['true', '1'].includes(env('CORS_CREDENTIALS', 'false').toLowerCase()),
    maxAge: Number(env('CORS_MAX_AGE', '86400')),
});
