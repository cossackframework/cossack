#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import prompts from 'prompts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const projectName = process.argv[2];
  if (!projectName) {
    console.error('Please provide a project name.');
    console.error('Usage: create-cossack-app <project-name>');
    process.exit(1);
  }

  const projectDir = path.resolve(process.cwd(), projectName);
  const templateDir = path.resolve(__dirname, '../template');

  const response = await prompts({
    type: 'select',
    name: 'adapter',
    message: 'Which adapter would you like to use?',
    choices: [
      { title: 'Cloudflare Workers (Default)', value: 'cloudflare' },
      { title: 'Node.js', value: 'node' },
    ],
  });
  const adapter = response.adapter || 'cloudflare';

  try {
    await fs.mkdir(projectDir, { recursive: true });
    await fs.cp(templateDir, projectDir, { recursive: true });

    // Write tsconfig.json (kept outside template/ to avoid IDE errors in the monorepo)
    const tsconfigSource = path.resolve(__dirname, '../tsconfig.template.json');
    await fs.copyFile(tsconfigSource, path.join(projectDir, 'tsconfig.json'));

    // Update compatibility_date to today
    const wranglerPath = path.join(projectDir, 'wrangler.jsonc');
    if (await fs.access(wranglerPath).then(() => true).catch(() => false)) {
      let wranglerContent = await fs.readFile(wranglerPath, 'utf-8');
      const today = new Date().toISOString().split('T')[0];
      wranglerContent = wranglerContent.replace(
        /"compatibility_date"\s*:\s*"\d{4}-\d{2}-\d{2}"/,
        `"compatibility_date": "${today}"`
      );
      await fs.writeFile(wranglerPath, wranglerContent);
    }

    if (adapter === 'node') {
      console.log('Configuring for Node.js...');

      const packageJsonPath = path.join(projectDir, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      delete packageJson.devDependencies['wrangler'];
      delete packageJson.devDependencies['@cloudflare/workers-types'];
      delete packageJson.devDependencies['@cloudflare/vite-plugin'];

      packageJson.dependencies['@cossackframework/node-adapter'] = '^0.1.0';
      packageJson.dependencies['@hono/node-server'] = '^1.0.0';
      packageJson.dependencies['ws'] = '^8.16.0';

      packageJson.devDependencies['@types/ws'] = '^8.5.10';
      packageJson.devDependencies['@types/node'] = '^20.0.0';

      packageJson.scripts['dev'] = 'node scripts/dev.js';
      packageJson.scripts['start'] = 'node dist/server/index.js';

      await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

      await fs.rm(path.join(projectDir, 'wrangler.jsonc'), { force: true });

      const tsconfigPath = path.join(projectDir, 'tsconfig.json');
      const tsconfig = JSON.parse(await fs.readFile(tsconfigPath, 'utf-8'));
      tsconfig.compilerOptions.types = ['vite/client', 'node'];
      await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));

      const indexTsContent = `import { serve } from '@hono/node-server';
import { CossackNodeAdapter } from '@cossackframework/node-adapter';
import { createApp } from '@cossackframework/framework/router';

const app = createApp();

const server = serve({
    fetch: app.fetch,
    port: Number(process.env.PORT) || 3000,
}, (info) => {
    console.log(\`Listening on http://localhost:\${info.port}\`);
});
`;
      await fs.writeFile(path.join(projectDir, 'src/index.ts'), indexTsContent);

      // Update vite.config.ts for Node.js output
      const viteConfigPath = path.join(projectDir, 'vite.config.ts');
      let viteConfig = await fs.readFile(viteConfigPath, 'utf-8');
      // Remove the cloudflare plugin import and usage for Node.js
      viteConfig = viteConfig.replace("import { cloudflare } from '@cloudflare/vite-plugin';\n", '');
      viteConfig = viteConfig.replace(/\s*cloudflare\(\{[^}]*\}\),\n/, '\n');
      await fs.writeFile(viteConfigPath, viteConfig);
    }

    console.log(`\nCossack app created in ${projectDir}\n`);
    console.log('Next steps:');
    console.log(`  cd ${projectName}`);
    console.log('  pnpm install');
    if (adapter === 'node') {
      console.log('  pnpm run build');
      console.log('  pnpm start');
    } else {
      console.log('  pnpm run dev');
    }
  } catch (error) {
    console.error('Error creating Cossack app:', error);
    process.exit(1);
  }
}

main();
