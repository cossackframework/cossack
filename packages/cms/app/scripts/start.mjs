// `pnpm dev`: sync the shell, then run the dev server.
//
// ROMEDB_URL picks the database: a file path (the default, storage/romedb/app.romedb) opens
// in the dev server's process; a loopback URL makes the dev server start `romedb serve` for
// it (the romedbDev Vite plugin), which reads the service's token file, so nothing is copied
// into .env.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await run('node', ['scripts/sync.mjs']);
const dev = spawn(process.execPath, ['--env-file-if-exists=.env', 'scripts/dev.js'], { cwd: root, stdio: 'inherit' });
const forward = signal => () => dev.kill(signal);
process.on('SIGINT', forward('SIGINT'));
process.on('SIGTERM', forward('SIGTERM'));
dev.on('exit', code => process.exit(code ?? 0));

function run(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)));
    });
}
