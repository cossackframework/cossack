// Deno-runtime tests need a `deno` binary. CI installs one and must fail loudly
// if it is missing; local runs without Deno skip those tests instead.
import { spawnSync } from 'node:child_process';

export const denoBinary = process.env.COSSACK_DENO_BINARY || 'deno';
export const denoAvailable = spawnSync(denoBinary, ['--version'], { stdio: 'ignore', timeout: 10000 }).status === 0;
export const skipWithoutDeno = !denoAvailable && !process.env.CI;
