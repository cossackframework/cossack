import fs from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseDirectory } from './directory';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Databases as files in one directory, `DIR/{id}.romedb` with a lowercase UUID v4 name: the
 * layout `romedb serve --directory DIR` serves, so the same directory can move behind it later.
 * `url(id)` is the file path; open it with `connectNode`. One process owns the files: delete a
 * database only after closing its client.
 */
export function fileDatabases(directory: string): DatabaseDirectory {
    const root = path.resolve(directory);
    const file = (id: string) => {
        if (!ID.test(id)) throw new TypeError('Database files are named by a lowercase UUID v4.');
        return path.join(root, `${id}.romedb`);
    };
    return {
        // The name is the caller's; the file is created when `connectNode` first opens it.
        async create() {
            await fs.mkdir(root, { recursive: true, mode: 0o700 });
            return crypto.randomUUID();
        },
        async delete(id) {
            const database = file(id);
            await Promise.all([database, `${database}-wal`, path.join(root, `${id}.db-log`)].map(name => fs.rm(name, { force: true })));
        },
        url: file,
    };
}
