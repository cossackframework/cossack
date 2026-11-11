import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientError, connect } from '@romedb/client';
import type { DatabaseClient, EmbeddedClient } from './database';
import { decodePendingWrite, encodePendingWrite, pagePendingWrites, PendingWriteConflictError, samePendingWrite, type PendingListOptions, type PendingWrite, type PendingWriteStore } from './pending';

/** What this entry uses of `@romedb/node`, an optional peer: a Node app on a service does not install it. */
interface EmbeddedOpener {
    openEmbedded(options: { path: string; create: boolean; timeoutMs?: number; maxOpen?: number }): Promise<EmbeddedClient>;
}

const MAX_FILE = 2_359_296;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const TEMPORARY = '.tmp';
const CORRUPT = '.corrupt';
/** A temporary body older than this was left by a crash between its write and its link. */
const STALE_TEMPORARY_MS = 60 * 60_000;
/**
 * A saved name that does not decode and is younger than this may be a body still being written
 * (the no-hard-link fallback writes in place), so `list` leaves it for a later run.
 */
const FRESH_MS = 30_000;
/** Windows reports no POSIX permission bits (every file is 0o666, or 0o444) and cannot flush a folder. */
const windows = () => process.platform === 'win32';
/** `link` failures meaning the filesystem has no hard links (exFAT, some FUSE and SMB mounts). */
const NO_HARD_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EACCES']);
const FILE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);

/** A saved file that does not decode, such as one cut short by a crash from an older release. */
export class CorruptPendingWriteError extends Error {
    constructor(readonly id: string, cause: unknown) {
        super(`The pending write ${id} does not decode.`, { cause });
        this.name = 'CorruptPendingWriteError';
    }
}

/**
 * One private file per pending write, mode 0600 (on Windows, where files carry no POSIX mode,
 * the folder's access list protects them). The body is written and flushed under a temporary
 * name and then hard-linked into place, so a saved name never holds a partial body and an existing
 * one is never replaced. On a filesystem without hard links the body is written straight to its
 * exclusive name instead. `list` sets aside files that do not decode, so one bad file cannot stop
 * recovery of the rest, and reports files it cannot read through `unreadable`.
 */
export class FilePendingWriteStore implements PendingWriteStore {
    readonly durability = 'durable' as const;
    readonly #directory: string;
    #ready: Promise<void> | undefined;
    #unreadable: string[] = [];

    constructor(directory: string) {
        this.#directory = path.resolve(directory);
    }

    async put(id: string, write: PendingWrite): Promise<void> {
        const file = await this.#file(id);
        const text = encodePendingWrite(write);
        if (Buffer.byteLength(text) > MAX_FILE) throw new RangeError('pending write exceeds byte limit');
        const temporary = path.join(this.#directory, `.${id}.${randomUUID()}${TEMPORARY}`);
        await writePrivate(temporary, text);
        try {
            await fs.link(temporary, file);
        } catch (error) {
            await fs.unlink(temporary).catch(() => {});
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'EEXIST') return this.#alreadySaved(id, write);
            if (!code || !NO_HARD_LINKS.has(code)) throw error;
            // No hard links here: the exclusive create still never replaces a saved write.
            try { await writePrivate(file, text); }
            catch (fallback) {
                if ((fallback as NodeJS.ErrnoException).code === 'EEXIST') return this.#alreadySaved(id, write);
                throw fallback;
            }
            await this.#syncDirectory();
            return;
        }
        await fs.unlink(temporary);
        await this.#syncDirectory();
    }

    async #alreadySaved(id: string, write: PendingWrite): Promise<void> {
        const existing = await this.get(id);
        if (existing && samePendingWrite(existing, write)) return;
        throw new PendingWriteConflictError(id);
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
            // A second link is the temporary body of a put between its link and unlink, or of one
            // that crashed there: the saved name is complete either way.
            const linked = stat.nlink === 1 || (stat.nlink === 2 && await this.#linkedTemporary(id, stat));
            if (!stat.isFile() || !linked || (!windows() && (stat.mode & 0o077) !== 0) || (typeof process.getuid === 'function' && stat.uid !== process.getuid()) || stat.size > MAX_FILE) {
                throw new Error('pending write requires a private bounded regular file');
            }
            const text = await handle.readFile('utf8');
            try { return decodePendingWrite(text); }
            catch (error) { throw new CorruptPendingWriteError(id, error); }
        } finally { await handle.close(); }
    }

    /** IDs the latest `list` could not read: torn files it set aside, and files failing the ownership checks. */
    unreadable(): readonly string[] {
        return this.#unreadable;
    }

    async #linkedTemporary(id: string, saved: { ino: number; dev: number }): Promise<boolean> {
        const names = await fs.readdir(this.#directory).catch(() => [] as string[]);
        for (const name of names) {
            if (!name.startsWith(`.${id}.`) || !name.endsWith(TEMPORARY)) continue;
            const stat = await fs.lstat(path.join(this.#directory, name)).catch(() => undefined);
            if (stat && stat.ino === saved.ino && stat.dev === saved.dev) return true;
        }
        return false;
    }

    async delete(id: string): Promise<void> {
        const file = await this.#file(id);
        await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await this.#syncDirectory();
    }

    async list(options: PendingListOptions = {}): Promise<readonly PendingWrite[]> {
        await this.#prepare();
        const names = await fs.readdir(this.#directory);
        const writes: PendingWrite[] = [];
        const unreadable: string[] = [];
        for (const name of names) {
            if (name.endsWith(TEMPORARY)) {
                await this.#dropStaleTemporary(name);
                continue;
            }
            if (!name.endsWith('.json') || !ID.test(name.slice(0, -5))) continue;
            try {
                const write = await this.get(name.slice(0, -5));
                if (write) writes.push(write);
            } catch (error) {
                if (error instanceof CorruptPendingWriteError) {
                    const file = path.join(this.#directory, name);
                    const stat = await fs.lstat(file).catch(() => undefined);
                    // Possibly a body still being written: neither set aside nor reported yet.
                    if (!stat || Date.now() - stat.mtimeMs < FRESH_MS) continue;
                    // Kept beside the others under a name nothing reads, for an operator to inspect.
                    await fs.rename(file, `${file}${CORRUPT}`).catch(() => {});
                }
                // Either way it is reported: set aside, or (failing the ownership checks) left in place.
                unreadable.push(name.slice(0, -5));
            }
        }
        this.#unreadable = unreadable;
        return pagePendingWrites(writes, options);
    }

    async #dropStaleTemporary(name: string): Promise<void> {
        const file = path.join(this.#directory, name);
        const stat = await fs.lstat(file).catch(() => undefined);
        if (stat && Date.now() - stat.mtimeMs > STALE_TEMPORARY_MS) await fs.unlink(file).catch(() => {});
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
        if (windows()) return;
        const directory = await fs.open(this.#directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
        try { await directory.sync(); }
        finally { await directory.close(); }
    }
}

/** Create `file` exclusively, private, and write and flush `text` to it. */
async function writePrivate(file: string, text: string): Promise<void> {
    const handle = await fs.open(file, FILE_FLAGS, 0o600);
    try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
    } catch (error) {
        await handle.close();
        await fs.unlink(file).catch(() => {});
        throw error;
    }
    await handle.close();
}

export interface NodeConnectionOptions {
    /**
     * A file path (or `file:` URL) opens the database in this process and creates it when it is
     * missing. An `http(s)://` URL connects to `romedb serve` or RomeDB Cloud.
     */
    url: string;
    /** Service or Cloud credential. Files need none. */
    token?: string;
    timeoutMs?: number;
    /** Most files this process keeps open at once (`openEmbedded`'s `maxOpen`, default 16). */
    maxOpen?: number;
}

/** True when `ROMEDB_URL` names a service rather than a file. */
export function isServiceUrl(url: string): boolean {
    return /^(?:https?|romedb):\/\//i.test(url);
}

/**
 * Open the database `url` names with `@romedb/node`: a file in this process (one process owns a
 * file), or a connection to `romedb serve` or Cloud. Pass it to `createRomeDB` as `connect`.
 */
export async function connectNode(options: NodeConnectionOptions): Promise<DatabaseClient> {
    const { url, token, timeoutMs, maxOpen } = options;
    const timeout = timeoutMs === undefined ? {} : { timeoutMs };
    if (isServiceUrl(url)) {
        if (!token) throw new TypeError(`ROMEDB_TOKEN is required for ${url}`);
        return connect({ url, token, warm: false, ...timeout });
    }
    const file = path.resolve(url.startsWith('file:') ? fileURLToPath(url) : url);
    // The addon loads only when a file is opened, so service URLs work where it can't load.
    // Published as source, so this also has to compile where the peer is not installed.
    // @ts-ignore
    const { openEmbedded } = await import('@romedb/node/embedded-client') as EmbeddedOpener;
    const open = (create: boolean) => openEmbedded({ path: file, create, ...timeout, ...(maxOpen === undefined ? {} : { maxOpen }) });
    if (await exists(file)) return open(false);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    // Another process may create it first; open that file then.
    return open(true).catch(error => {
        if (error instanceof ClientError && error.code === 'RDB_ALREADY_EXISTS') return open(false);
        throw error;
    });
}

async function exists(file: string): Promise<boolean> {
    try { await fs.access(file, constants.F_OK); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

export { fileDatabases } from './node-directory';
