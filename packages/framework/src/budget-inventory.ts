/** Private Node-only identity for supported local Worker budget measurements. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { endianness } from 'node:os';
import path from 'node:path';

const inside = (base: string, file: string) => {
  const relative = path.relative(base, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const nativePackages: Record<string, string> = {
  'darwin arm64 LE': '@cloudflare/workerd-darwin-arm64',
  'darwin x64 LE': '@cloudflare/workerd-darwin-64',
  'linux arm64 LE': '@cloudflare/workerd-linux-arm64',
  'linux x64 LE': '@cloudflare/workerd-linux-64',
  'win32 x64 LE': '@cloudflare/workerd-windows-64',
};

/** Inventory caps; exceeding any of them declines reuse. */
export interface BudgetInventoryLimits {
  /** Non-tool files hashed across all Worker inventories and sources. */
  files: number;
  /** Directories traversed across all Worker inventories. */
  directories: number;
  /** Directory entries listed across all Worker inventories. */
  entries: number;
}

/** @internal Default inventory caps; exported so tests can assert them. */
export const BUDGET_INVENTORY_LIMITS: Readonly<BudgetInventoryLimits> = Object.freeze({ files: 4096, directories: 4096, entries: 8192 });

/** Unsupported or changing inventories decline reuse; they never invent evidence. */
export async function fingerprintBudgetInventory(root: string, artifacts: string[], sourceFiles: string[], context: string,
  includeStartupRuntime = false, limits: Partial<BudgetInventoryLimits> = {}): Promise<string | undefined> {
  const { files: maxFiles, directories: maxDirectories, entries: maxEntries } = { ...BUDGET_INVENTORY_LIMITS, ...limits };
  try {
    const project = await realpath(root);
    const digest = createHash('sha256');
    digest.update(JSON.stringify({ version: 1, context, node: process.versions, platform: process.platform, arch: process.arch }));
    let files = 0; let directories = 0; let entriesSeen = 0; let bytes = 0; let toolBytes = 0;
    const projectFile = (input: string) => {
      const resolved = path.resolve(root, input);
      if (!inside(path.resolve(root), resolved)) throw Error();
      return path.join(project, path.relative(path.resolve(root), resolved));
    };
    const ordinaryPath = async (file: string) => {
      // Reject symbolic path components; realpath alone would permit a symbolic leaf.
      if (await realpath(file) !== file) throw Error();
      const stat = await lstat(file, { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error();
      return stat;
    };
    const hashFile = async (file: string, tool = false, maximum = Infinity) => {
      const before = await ordinaryPath(file);
      const size = Number(before.size);
      if (size > maximum || (!tool && (++files > maxFiles || bytes + size > 64 * 1024 * 1024)) ||
        (tool && toolBytes + size > 256 * 1024 * 1024)) throw Error();
      digest.update(JSON.stringify(['file', file, before.size.toString(), before.ino.toString(), before.mtimeNs.toString(), before.ctimeNs.toString()]));
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let text: Buffer[] | undefined = maximum <= 1024 * 1024 ? [] : undefined;
      let read = 0;
      try {
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs) throw Error();
        for await (const chunk of handle.createReadStream({ highWaterMark: 65536, autoClose: false })) {
          read += chunk.length;
          if (tool) toolBytes += chunk.length; else bytes += chunk.length;
          if (read > maximum || bytes > 64 * 1024 * 1024 || toolBytes > 256 * 1024 * 1024) throw Error();
          digest.update(chunk); text?.push(chunk);
        }
      } finally { await handle.close(); }
      const after = await ordinaryPath(file);
      if (read !== size || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw Error();
      return text ? Buffer.concat(text).toString('utf8') : undefined;
    };
    const walk = async (directory: string): Promise<boolean> => {
      if (++directories > maxDirectories) throw Error();
      if (await realpath(directory) !== directory) throw Error();
      const before = await lstat(directory, { bigint: true });
      if (!before.isDirectory() || before.isSymbolicLink()) throw Error();
      const entries = await readdir(directory);
      entriesSeen += entries.length;
      if (entriesSeen > maxEntries) throw Error();
      const populated: string[] = [];
      for (const entry of entries) {
        const file = path.join(directory, entry); const stat = await lstat(file);
        if (stat.isSymbolicLink()) throw Error();
        if (stat.isDirectory()) {
          if (await walk(file)) populated.push(entry);
        } else { await hashFile(file); populated.push(entry); }
      }
      const after = await lstat(directory, { bigint: true });
      if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        JSON.stringify(entries) !== JSON.stringify(await readdir(directory))) throw Error();
      // Wrangler creates empty .wrangler/tmp directories during dry runs.
      // Empty directories contribute no modules; a later file still changes
      // this digest, and every traversed directory retains race/cap checks.
      if (populated.length) digest.update(JSON.stringify(['directory', directory, populated]));
      return populated.length > 0;
    };
    for (const input of artifacts) {
      const artifact = projectFile(input); const directory = path.dirname(artifact);
      // Read through the same bounded, checked descriptor used for the digest.
      const config = JSON.parse((await hashFile(artifact, false, 1024 * 1024))!);
      if (config.no_bundle !== true || typeof config.main !== 'string' || config.build?.command || config.site || config.unsafe ||
        config.wasm_modules || config.text_blobs || config.data_blobs) return;
      const main = path.resolve(directory, config.main);
      if (!inside(directory, main) || !/\.(?:m?js)$/.test(main) || (config.base_dir && path.resolve(directory, config.base_dir) !== directory)) return;
      await ordinaryPath(main);
      digest.update(JSON.stringify(['artifact', artifact, main]));
      await walk(directory);
    }
    for (const input of sourceFiles) await hashFile(projectFile(input), false, 1024 * 1024);
    const require = createRequire(path.join(project, 'package.json'));
    const manifestPath = await realpath(require.resolve('wrangler/package.json'));
    const manifest = JSON.parse((await hashFile(manifestPath, true, 1024 * 1024))!);
    const main = await realpath(require.resolve('wrangler'));
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.wrangler;
    if (typeof bin !== 'string') return;
    await hashFile(main, true); await hashFile(path.resolve(path.dirname(manifestPath), bin), true);
    if (includeStartupRuntime) {
      const wranglerRequire = createRequire(main);
      const miniflare = await realpath(wranglerRequire.resolve('miniflare'));
      const miniflareManifest = await realpath(wranglerRequire.resolve('miniflare/package.json'));
      await hashFile(miniflareManifest, true); await hashFile(miniflare, true);
      const miniflareRequire = createRequire(miniflare);
      const loader = await realpath(miniflareRequire.resolve('workerd'));
      await hashFile(await realpath(miniflareRequire.resolve('workerd/package.json')), true); await hashFile(loader, true);
      const override = process.env.MINIFLARE_WORKERD_PATH;
      digest.update(JSON.stringify(['runtime', override ?? null, process.env.MINIFLARE_WORKERD_AUTOGATES ?? null]));
      let binary: string;
      // Miniflare passes this command directly to spawn. Bare names use PATH,
      // so resolving them against the project would bind a different binary.
      if (override !== undefined) {
        if (!path.isAbsolute(override)) return;
        binary = override;
      }
      else {
        const nativePackage = nativePackages[`${process.platform} ${process.arch} ${endianness()}`];
        if (!nativePackage) return;
        const workerdRequire = createRequire(loader);
        const nativeManifest = await realpath(workerdRequire.resolve(`${nativePackage}/package.json`));
        binary = await realpath(workerdRequire.resolve(`${nativePackage}/bin/workerd${process.platform === 'win32' ? '.exe' : ''}`));
        await hashFile(nativeManifest, true);
        const runtime = miniflareRequire('workerd');
        if (typeof runtime.default !== 'string' || await realpath(runtime.default) !== binary) return;
      }
      await hashFile(binary, true);
    }
    return digest.digest('hex');
  } catch { return undefined; }
}
