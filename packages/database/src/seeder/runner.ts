// src/seeder/runner.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DbClient } from '../types';

export interface Seeder {
    run(db: DbClient): Promise<void>;
}

export interface RunSeedersOptions {
    client: DbClient;
    /** Absolute path to the folder holding seeder files (default `src/seeders`). */
    folder?: string;
    /** Run only seeders whose filename matches this substring. */
    only?: string;
}

/**
 * Imports every `.ts`/`.js` seeder in `folder` (sorted by filename) and calls
 * its default export's `run(db)` method in order.
 *
 * Each seeder file default-exports a {@link Seeder}:
 *
 * ```ts
 * export default {
 *   async run(db) {
 *     await db.insertInto('users').values({ email: 'demo@cossack.dev' }).execute()
 *   },
 * }
 * ```
 */
export async function runSeeders(options: RunSeedersOptions): Promise<string[]> {
    const folder = options.folder ?? defaultSeedersFolder();
    let entries: string[];
    try {
        entries = await fs.readdir(folder);
    } catch (err: any) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
    const files = entries.filter(
        (f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts'),
    );
    const filtered = options.only
        ? files.filter((f) => f.includes(options.only as string))
        : files;
    filtered.sort();

    const ran: string[] = [];
    for (const file of filtered) {
        const fullPath = path.resolve(folder, file);
        const mod = await import(`${pathToFileURL(fullPath).href}?t=${Date.now()}`);
        const seeder: Seeder = mod.default ?? mod;
        if (typeof seeder?.run !== 'function') {
            throw new Error(`Seeder "${file}" has no \`run(db)\` method (or default export).`);
        }
        await seeder.run(options.client);
        ran.push(file);
    }
    return ran;
}

/** Default seeder folder, resolved relative to the current working directory. */
export function defaultSeedersFolder(): string {
    return path.resolve(process.cwd(), 'src', 'seeders');
}
