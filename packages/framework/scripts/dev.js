import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Ensure the SSG static directory exists (wrangler requires it even in dev)
const ssgStaticDir = path.join(PROJECT_ROOT, 'dist/ssg-static');
if (!fs.existsSync(ssgStaticDir)) {
    fs.mkdirSync(ssgStaticDir, { recursive: true });
}

// Start the DevTools server
const devTools = spawn('node', [path.join(__dirname, 'dev-tools.js')], {
    stdio: 'inherit',
    shell: false
});

// Start Wrangler
// We use shell: true to ensure 'wrangler' is found in the PATH (from node_modules/.bin)
const wrangler = spawn('wrangler', ['dev'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, COSSACK_DEV: 'true' }
});

const cleanup = () => {
    // Kill the devTools server
    if (devTools.pid) {
        try {
            process.kill(devTools.pid);
        } catch (e) { /* ignore */ }
    }
    
    // Kill wrangler (since it runs in a shell, we might need to kill the process group, 
    // but typically killing the shell process is enough for dev workflows)
    if (wrangler.pid) {
        try {
            process.kill(wrangler.pid);
        } catch (e) { /* ignore */ }
    }
    
    process.exit();
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// If wrangler exits, we should likely exit too
wrangler.on('close', (code) => {
    cleanup();
});
