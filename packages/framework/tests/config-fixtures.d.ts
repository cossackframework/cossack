import '../src/config';
/** Authored config shapes supplied by the runtime-only fixtures in this suite. */
declare module '../src/config' {
    interface CossackConfigRegistry {
        database: { driver: string; connections: { mysql: { host: string; port: number } } };
        realtime: { marker: string; port: number };
        sample: { name: string };
    }
}
