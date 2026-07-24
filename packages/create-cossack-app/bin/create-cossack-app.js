#!/usr/bin/env node
import path from 'node:path';
import { createApp } from '../index.js';

const argv = process.argv.slice(2);
const projectName = argv.shift();
const options = { interactive: true };
for (let index = 0; index < argv.length; index++) {
  const token = argv[index];
  if (!token.startsWith('--')) continue;
  const [rawName, inline] = token.slice(2).split('=', 2);
  const name = rawName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  if (name === 'yes') {
    options.yes = true;
    options.interactive = false;
    continue;
  }
  options[name] = inline ?? argv[++index];
}

try {
  const result = await createApp(projectName, options);
  if (result.status === 'cancelled') {
    console.log('Cancelled. No files were changed.');
    process.exit(0);
  }
  console.log(`\nCossack app created in ${result.projectDir}\n`);
  console.log('Next steps:');
  console.log(`  cd ${path.basename(result.projectDir)}`);
  console.log('  pnpm install');
  console.log(result.adapter === 'node' ? '  pnpm run build && pnpm start' : '  pnpm run dev');
} catch (error) {
  console.error('Error creating Cossack app:', error.message);
  process.exit(1);
}
