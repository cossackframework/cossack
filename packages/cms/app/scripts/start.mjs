// `pnpm dev`: sync the shell, make sure a RomeDB answers at ROMEDB_URL, then run the dev server.
//
// When nothing listens at ROMEDB_URL, `scripts/romedb.sh` is started here as a child (first
// start creates the database and writes ROMEDB_TOKEN into .env), and stopped with the dev
// server. A RomeDB already running at that URL is used as it is.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const children = [];
let exiting = false;
const stop = () => { for (const child of children) child.kill('SIGTERM'); };
process.on('SIGINT', () => { stop(); process.exit(130); });
process.on('SIGTERM', () => { stop(); process.exit(143); });

await run('node', ['scripts/sync.mjs']);
const env = await readEnv();
const url = env.ROMEDB_URL ?? 'http://127.0.0.1:4322';

if (await answers(url)) console.log(`[cms-app] RomeDB at ${url}.`);
else {
    console.log(`[cms-app] nothing answers at ${url}; starting RomeDB (scripts/romedb.sh).`);
    const romedb = spawn('bash', ['scripts/romedb.sh'], { cwd: root, stdio: 'inherit' });
    children.push(romedb);
    romedb.on('exit', code => { if (!exiting) { console.error(`[cms-app] RomeDB stopped (exit ${code}).`); stop(); process.exit(code ?? 1); } });
    const deadline = Date.now() + 20_000;
    // Ready when it answers and the token it wrote is the one .env holds, so the dev server reads a working .env.
    while (Date.now() < deadline) {
        const token = await fs.readFile(path.join(root, 'storage/romedb/token'), 'utf8').then(text => text.trim(), () => '');
        if (token && (await readEnv()).ROMEDB_TOKEN === token && await answers(url)) break;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!await answers(url)) { console.error(`[cms-app] RomeDB did not come up at ${url}.`); stop(); process.exit(1); }
}

const dev = spawn(process.execPath, ['--env-file-if-exists=.env', 'scripts/dev.js'], { cwd: root, stdio: 'inherit' });
children.push(dev);
dev.on('exit', code => { exiting = true; stop(); process.exit(code ?? 0); });

/** Whether an HTTP server answers at the URL, whatever its status. */
async function answers(target) {
    try { await fetch(target, { signal: AbortSignal.timeout(1000) }); return true; }
    catch { return false; }
}

async function readEnv() {
    const text = await fs.readFile(path.join(root, '.env'), 'utf8').catch(() => '');
    return Object.fromEntries(text.split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).trim()]; }));
}

function run(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)));
    });
}
