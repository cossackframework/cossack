import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodePendingWrite, encodePendingWrite, PendingWriteConflictError, samePendingWrite, type PendingWrite, type PendingWriteStore } from './pending';

const MAX_FILE = 2_359_296;
const ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * One private file per pending write: created exclusively with mode 0600, flushed with its
 * directory before dispatch, and never overwritten with a different body.
 */
export class FilePendingWriteStore implements PendingWriteStore {
    readonly durability = 'durable' as const;
    readonly #directory: string;
    #ready: Promise<void> | undefined;

    constructor(directory: string) {
        this.#directory = path.resolve(directory);
    }

    async put(id: string, write: PendingWrite): Promise<void> {
        const file = await this.#file(id);
        const text = encodePendingWrite(write);
        if (Buffer.byteLength(text) > MAX_FILE) throw new RangeError('pending write exceeds byte limit');
        let handle: fs.FileHandle;
        try {
            handle = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const existing = await this.get(id);
            if (existing && samePendingWrite(existing, write)) return;
            throw new PendingWriteConflictError(id);
        }
        try {
            await handle.writeFile(text, 'utf8');
            await handle.sync();
        } catch (error) {
            await handle.close();
            await fs.unlink(file).catch(() => {});
            throw error;
        }
        await handle.close();
        await this.#syncDirectory();
    }

    async get(id: string): Promise<PendingWrite | undefined> {
        const file = await this.#file(id);
        let handle: fs.FileHandle;
        try { handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            throw error;
        }
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid()) || stat.size > MAX_FILE) {
                throw new Error('pending write requires a private bounded regular file');
            }
            return decodePendingWrite(await handle.readFile('utf8'));
        } finally { await handle.close(); }
    }

    async delete(id: string): Promise<void> {
        const file = await this.#file(id);
        await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await this.#syncDirectory();
    }

    async list(options: { limit?: number } = {}): Promise<readonly PendingWrite[]> {
        await this.#prepare();
        const names = (await fs.readdir(this.#directory)).filter(name => name.endsWith('.json') && ID.test(name.slice(0, -5)));
        const writes: PendingWrite[] = [];
        for (const name of names) {
            const write = await this.get(name.slice(0, -5));
            if (write) writes.push(write);
        }
        writes.sort((a, b) => a.savedAt - b.savedAt);
        return writes.slice(0, options.limit ?? writes.length);
    }

    async #file(id: string): Promise<string> {
        if (!ID.test(id)) throw new TypeError('pending write id requires 1..80 letters, digits, underscores or hyphens');
        await this.#prepare();
        return path.join(this.#directory, `${id}.json`);
    }

    #prepare(): Promise<void> {
        this.#ready ??= fs.mkdir(this.#directory, { recursive: true, mode: 0o700 }).then(() => {});
        return this.#ready;
    }

    async #syncDirectory(): Promise<void> {
        const directory = await fs.open(this.#directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
        try { await directory.sync(); }
        finally { await directory.close(); }
    }
}
