// Add a published version to releases.json, for the release workflow or by hand:
//   pnpm --filter cossack-update-server run release -- --version 0.10.0 [--channel latest]
//     [--notes <url>] [--published <ISO date>] [--security] [--host-template 0.10.0] [--minimum-from 0.9.0]
// Then deploy the server (pnpm --filter cossack-update-server run deploy).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../releases.json', import.meta.url));
const args = process.argv.slice(2);
const value = name => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const version = value('version');
if (!version || !VERSION.test(version)) { console.error('Give --version, such as --version 0.10.0.'); process.exit(1); }
for (const name of ['host-template', 'minimum-from']) if (value(name) && !VERSION.test(value(name))) { console.error(`--${name} must be a version.`); process.exit(1); }
const channel = value('channel') ?? (version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest');
const list = JSON.parse(fs.readFileSync(file, 'utf8'));
const releases = (list.channels[channel] ??= []);
const release = {
  version,
  published: value('published') ?? new Date().toISOString(),
  notes: value('notes') ?? `https://github.com/cossackframework/cossack/releases/tag/${version}`,
  security: args.includes('--security'),
  ...(value('host-template') ? { hostTemplate: value('host-template') } : {}),
  ...(value('minimum-from') ? { minimumFrom: value('minimum-from') } : {}),
};
const existing = releases.findIndex(entry => entry.version === version);
if (existing >= 0) releases[existing] = release; else releases.push(release);
fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
console.log(`${existing >= 0 ? 'Updated' : 'Added'} ${version} in channel ${channel}.`);
