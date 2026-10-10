import { commandSpecs } from '../command-specs.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exists, listFiles } from '../fs-utils.js';
import { flagString } from '../flags.js';
import { extractImageCalls, isLocalSource, resolveOutputPath } from '../image-scan.js';

const execFileP = promisify(execFile);

const SUPPORTED_SOURCE_EXT = new Set(['.ts', '.mdx', '.md', '.js', '.jsx']);

import { runWithSpec, createCommandOutput } from '../command-spec.js';

const spec = commandSpecs.image;

export async function imageCommand(args, ctx) {
  ctx.out ??= createCommandOutput(ctx);
  return runWithSpec(spec, args, ctx, () => imageCommandInner(args, ctx), imageHelp);
}

async function imageCommandInner(args, ctx) {
  const [sub] = args;
  if (sub === 'optimize') return optimize(args.slice(1), ctx);
  throw Object.assign(new Error(`Unknown image subcommand: ${sub || '(none)'}. Available: optimize`),
    { code: 'COSSACK_IMAGE_SUBCOMMAND_UNKNOWN' });
}

async function optimize(_rest, ctx) {
  const root = ctx.projectRoot || ctx.cwd || process.cwd();
  const format = flagString(ctx.flags.format) || 'webp';
  const quality = Number(flagString(ctx.flags.quality) || 80);

  if (!['webp', 'avif'].includes(format)) {
    throw Object.assign(new Error(`Unsupported --format "${format}". Use webp or avif.`),
      { code: 'COSSACK_IMAGE_FORMAT_INVALID' });
  }
  if (!Number.isInteger(quality) || quality < 0 || quality > 100) {
    throw Object.assign(new Error('--quality must be an integer between 0 and 100.'),
      { code: 'COSSACK_IMAGE_QUALITY_INVALID' });
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
    ctx.out.line('  No local Image({ ... }) usages with width found in src/.');
    return ctx.out.data({ status: 'empty', format, quality, optimized: 0, planned: 0, skipped: 0 });
  }

  // Planning is useful without a converter installed and never launches it.
  const bin = ctx.dryRun ? undefined : await detectImagemagick();
  if (!ctx.dryRun && !bin) throw Object.assign(
    new Error('ImageMagick is not installed. Install ImageMagick to run cossack image optimize.'),
    { code: 'COSSACK_IMAGE_PROVIDER_MISSING' });

  // 3. Run ImageMagick for each unique (src, size) pair.
  let optimized = 0;
  let planned = 0;
  let skipped = 0;
  const diagnostics = [];
  const seen = new Set();
  for (const job of jobs) {
    const key = `${job.src}@${job.width || ''}x${job.height || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Resolve the source file under public/ (Vite serves public/* at /).
    const relPath = job.src.replace(/^\//, '');
    const inPath = path.resolve(publicDir, relPath);
    if (!isInside(publicDir, inPath)) {
      diagnostics.push({ code: 'COSSACK_IMAGE_PATH_INVALID', severity: 'error',
        message: `Image source must be inside public/: ${job.src}`, path: job.from });
      skipped++;
      continue;
    }
    if (!(await exists(inPath))) {
      ctx.out.line(`  skip     ${job.src} (not found in public/ — referenced in ${job.from})`);
      diagnostics.push({ code: 'COSSACK_IMAGE_SOURCE_MISSING', severity: 'error',
        message: `Image source not found: ${job.src}`, path: job.from });
      skipped++;
      continue;
    }
    const outRel = resolveOutputPath(relPath, job.width, job.height, format);
    const outPath = path.resolve(publicDir, outRel);
    const outputExists = await exists(outPath);
    const outputLink = await fs.lstat(outPath).then(stat => stat.isSymbolicLink(), error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    const realPublicDir = await fs.realpath(publicDir);
    if (outputLink || !isInside(realPublicDir, await fs.realpath(inPath)) ||
        (outputExists && !isInside(realPublicDir, await fs.realpath(outPath)))) {
      diagnostics.push({ code: 'COSSACK_IMAGE_PATH_INVALID', severity: 'error',
        message: `Unsafe image path: ${job.src}. Paths must stay inside public/ and output files cannot be symlinks.`, path: job.from });
      skipped++;
      continue;
    }

    if (ctx.dryRun) {
      ctx.out.file('planned', outPath);
      planned++;
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
      await execFileP(bin, imArgs, { timeout: 30_000 });
      ctx.out.file(outputExists ? 'overwritten' : 'created', outPath);
      optimized++;
    } catch {
      // Converter stderr may contain application paths or source excerpts.
      // Keep its output out of the machine protocol.
      diagnostics.push({ code: 'COSSACK_IMAGE_CONVERSION_FAILED', severity: 'error',
        message: `Image conversion failed for ${job.src}. Check the source and ImageMagick format support.`, path: job.from });
      skipped++;
    }
  }

  ctx.out.line(
    `\nDone. Optimized ${optimized}, skipped ${skipped} (format: ${format}, quality: ${quality}).`,
  );
  if (ctx.flags.json !== true) for (const diagnostic of diagnostics) ctx.out.warn(diagnostic.message);
  return { exitCode: diagnostics.length ? 1 : 0,
    data: ctx.out.data({ status: ctx.dryRun ? 'dry-run' : 'completed', format, quality, optimized, planned, skipped }), diagnostics };
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/** Detect ImageMagick: prefer IM7 `magick`, fall back to IM6 `convert`. */
async function detectImagemagick() {
  for (const bin of ['magick', 'convert']) {
    try {
      await execFileP(bin, ['--version'], { timeout: 5_000 });
      return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function imageHelp() {
  return commandSpecs.image.help(`cossack image <subcommand>

Image tooling.

Subcommands:
  optimize   Scan src/ for <Image> usages and generate optimized webp/avif
             variants next to the originals in public/ (requires ImageMagick).`);
}
