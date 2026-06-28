#!/usr/bin/env node
import { createApp } from '../index.js';

const projectName = process.argv[2];

async function main() {
  try {
    const { projectDir, adapter } = await createApp(projectName);
    console.log(`\nCossack app created in ${projectDir}\n`);
    console.log('Next steps:');
    console.log(`  cd ${path_basename(projectDir)}`);
    console.log('  pnpm install');
    if (adapter === 'node') {
      console.log('  pnpm run build');
      console.log('  pnpm start');
    } else {
      console.log('  pnpm run dev');
    }
  } catch (error) {
    console.error('Error creating Cossack app:', error.message);
    process.exit(1);
  }
}

function path_basename(p) {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || p;
}

main();
