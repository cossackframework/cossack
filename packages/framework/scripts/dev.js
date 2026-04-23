import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
