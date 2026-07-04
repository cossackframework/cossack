import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exists, listFiles } from '../fs-utils.js';
import { flagString } from '../flags.js';
import { extractImageCalls, isLocalSource, resolveOutputPath } from '../image-scan.js';

const execFileP = promisify(execFile);

const SUPPORTED_SOURCE_EXT = new Set(['.ts', '.mdx', '.md', '.js', '.jsx']);

export async function imageCommand(args, ctx) {
  const [sub] = args;
  if (sub === 'optimize') return optimize(args.slice(1), ctx);
  console.error(
    `Unknown image subcommand: ${sub || '(none)'}.\nAvailable: optimize`,
  );
  return 1;
}

async function optimize(_rest, ctx) {
  const root = ctx.projectRoot || process.cwd();
  const format = flagString(ctx.flags.format) || 'webp';
  const quality = Number(flagString(ctx.flags.quality) || 80);

  if (!['webp', 'avif'].includes(format)) {
    console.error(`  error   unsupported --format "${format}". Use webp or avif.`);
    return 1;
  }

  // 1. Detect ImageMagick (IM7 `magick`, else IM6 `convert`).
  const bin = await detectImagemagick();
  if (!bin) {
    console.error(
      '  error   ImageMagick not found. Install it to use `cossack image:optimize`:\n' +
        '          macOS:   brew install imagemagick\n' +
        '          Ubuntu:  sudo apt-get install imagemagick\n' +
        '          Windows: choco install imagemagick',
    );
    return 1;
  }

  // 2. Walk src/, collect every Image() usage with a local src + dimensions.
  const srcDir = path.resolve(root, 'src');
  const publicDir = path.resolve(root, 'public');
  const files = await listFiles(srcDir);
  const jobs = [];
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (!SUPPORTED_SOURCE_EXT.has(ext)) continue;
    const abs = path.join(srcDir, rel);
    let source;
    try {
      source = await fs.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    for (const call of extractImageCalls(source)) {
      if (!call.src || !isLocalSource(call.src)) continue;
      if (!call.width) continue;
      jobs.push({ src: call.src, width: call.width, height: call.height, from: rel });
    }
  }

  if (jobs.length === 0) {
    console.log('  No local Image({ ... }) usages with width found in src/.');
    return 0;
  }

  // 3. Run ImageMagick for each unique (src, size) pair.
  let optimized = 0;
  let skipped = 0;
  const seen = new Set();
  for (const job of jobs) {
    const key = `${job.src}@${job.width || ''}x${job.height || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Resolve the source file under public/ (Vite serves public/* at /).
    const relPath = job.src.replace(/^\//, '');
    const inPath = path.resolve(publicDir, relPath);
    if (!(await exists(inPath))) {
      console.log(`  skip     ${job.src} (not found in public/ — referenced in ${job.from})`);
      skipped++;
      continue;
    }
    const outRel = resolveOutputPath(relPath, job.width, job.height, format);
    const outPath = path.resolve(publicDir, outRel);

    if (ctx.dryRun) {
      console.log(`  would optimize  ${job.src} -> /${outRel}`);
      continue;
    }

    const resizeArg = job.width && job.height
      ? `${job.width}x${job.height}`
      : job.width
        ? `${job.width}x`
        : `x${job.height}`;
    const imArgs =
      bin === 'magick'
        ? ['convert', inPath, '-resize', resizeArg, '-quality', String(quality), `${format}:${outPath}`]
        : [inPath, '-resize', resizeArg, '-quality', String(quality), `${outPath}`];
    try {
      await execFileP(bin, imArgs);
      console.log(`  optimized  /${outRel}`);
      optimized++;
    } catch (err) {
      console.error(`  error   failed ${job.src}: ${err.message}`);
      skipped++;
    }
  }

  console.log(
    `\nDone. Optimized ${optimized}, skipped ${skipped} (format: ${format}, quality: ${quality}).`,
  );
  return 0;
}

/** Detect ImageMagick: prefer IM7 `magick`, fall back to IM6 `convert`. */
async function detectImagemagick() {
  for (const bin of ['magick', 'convert']) {
    try {
      await execFileP(bin, ['--version']);
      return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function imageHelp() {
  return `cossack image <subcommand>

Image tooling.

Subcommands:
  optimize   Scan src/ for <Image> usages and generate optimized webp/avif
             variants next to the originals in public/ (requires ImageMagick).

Options for \`optimize\`:
  --format <webp|avif>   Output format (default: webp).
  --quality <0-100>      Output quality (default: 80).
  --dry-run              Show what would be generated without writing.`;
}
