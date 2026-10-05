import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { runCaptured } from '../packages/cossack/src/spawn.js';
import assert from 'node:assert/strict';
import { writeHostedWorkflowAcceptance } from '../packages/cossack/tests/fixtures/hosted-workflow-acceptance.js';

async function verifyClientSecrets(root, secrets) {
  const pending = [path.join(root, 'dist/client')];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(filename);
      else if (entry.isFile()) {
        const content = await fs.readFile(filename);
        for (const value of Object.values(secrets)) assert.ok(!content.includes(Buffer.from(value)), 'Acceptance secret found in a client artifact');
      } else throw new Error('Unexpected client artifact type');
    }
  }
}

// Preparation only. There is intentionally no deployment/provisioning command.
export async function prepareHostedRelease({ installedRoot, outputDir, build = false }) {
  if (!installedRoot || !path.isAbsolute(installedRoot)) throw new Error('An absolute installed artifact root is required');
  const directory = outputDir ?? path.join(os.tmpdir(), `cossack-hosted-review-${randomUUID()}`);
  if (!path.isAbsolute(directory)) throw new Error('An absolute fresh output directory is required');
  await fs.mkdir(directory, { mode: 0o700 });
  const name = `cossack-090-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const resourceNames = { worker: name, workflow: `${name}-workflow`, database: `${name}-audit` };
  const require = createRequire(path.join(installedRoot, 'package.json'));
  const manifestPath = require.resolve('@cossackframework/scaffold/package.json');
  const metadata = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const { createApp } = await import(pathToFileURL(path.resolve(path.dirname(manifestPath), metadata.exports['.'].import)).href);
  const { projectDir: root } = await createApp('app', { cwd: directory, adapter: 'cloudflare', preset: 'minimal', features: ['workflows'], interactive: false });
  await fs.symlink(path.join(installedRoot, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  await writeHostedWorkflowAcceptance(root);
  const projectRequire = createRequire(path.join(root, 'package.json'));
  const executable = (packageName, relative) => path.join(path.dirname(projectRequire.resolve(`${packageName}/package.json`)), relative);
  const wrangler = executable('wrangler', 'bin/wrangler.js');
  const environment = { ...process.env, CLOUDFLARE_ENV: '', NODE_ENV: 'production', VITEST: '', CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_LOG_PATH: path.join(directory, 'private-wrangler.log') };
  const run = async (label, args, timeout = 120000) => {
    const result = await runCaptured(process.execPath, args, { cwd: root, env: environment, timeoutMs: timeout, maxOutputBytes: 8 * 1024 * 1024, shell: false });
    await fs.writeFile(path.join(directory, `${label}.log`), result.stdout + result.stderr, { mode: 0o600 });
    if (result.code !== 0) throw new Error(`Hosted preparation ${label} failed; inspect the private output directory`);
    return result.stdout;
  };
  const identity = JSON.parse(await run('identity', [wrangler, 'whoami', '--json'], 30000));
  if (identity.loggedIn !== true || !Array.isArray(identity.accounts) || identity.accounts.length !== 1 || !/^[a-f0-9]{32}$/i.test(identity.accounts[0].id)) {
    throw new Error('Hosted preparation requires one authenticated account; select an account explicitly before proceeding');
  }
  const accountId = identity.accounts[0].id;
  const configPath = path.join(root, 'wrangler.jsonc');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.name = name;
  config.account_id = accountId;
  config.workers_dev = true;
  config.routes = [];
  config.workflows[0].name = resourceNames.workflow;
  config.d1_databases = [{ binding: 'DB', database_name: resourceNames.database, database_id: '00000000-0000-0000-0000-000000000000' }];
  config.observability = { enabled: true, head_sampling_rate: 1 };
  config.upload_source_maps = true;
  config.secrets = { required: [...new Set([...(config.secrets?.required ?? []), 'ACCEPTANCE_KEY'])] };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  const secretsPath = path.join(directory, 'secrets.json');
  await fs.writeFile(secretsPath, JSON.stringify({ APP_SECRET: randomBytes(32).toString('hex'), ACCEPTANCE_KEY: randomBytes(32).toString('hex') }), { mode: 0o600 });
  if (build) {
    await run('types', [wrangler, 'types', '--env-interface', 'CloudflareBindings']);
    await run('workflow-types', [executable('typescript', 'bin/tsc'), '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--moduleResolution', 'Bundler', '--module', 'ESNext', '--target', 'ES2022', 'worker-configuration.d.ts', 'src/workflows/approval.ts']);
    await run('build', [executable('vite', 'bin/vite.js'), 'build']);
    await run('dry-run', [wrangler, 'deploy', '--dry-run', '--secrets-file', secretsPath, '--config', 'dist/ssr/wrangler.json', '--outdir', path.join(directory, 'prepared-upload')]);
    const secrets = JSON.parse(await fs.readFile(secretsPath, 'utf8'));
    await verifyClientSecrets(root, secrets);
    await run('local-smoke', [fileURLToPath(new URL('./verify-hosted-local-smoke.mjs', import.meta.url)), root, secretsPath]);
  }
  const plan = {
    status: build ? 'locally-validated-awaiting-approval' : 'prepared-not-built',
    accountId, resourceNames, root, secretsPath, installedRoot,
    remoteMutationPerformed: false,
    localSmokePassed: build,
    databaseId: null,
    limitations: ['No hosted checks passed', 'D1 placeholder must be replaced with the newly created immutable ID', 'No promotion, existing resource binding or production route is authorized', 'Remote source-map remapping requires separate evidence'],
  };
  await fs.writeFile(path.join(directory, 'plan.json'), JSON.stringify(plan, null, 2), { mode: 0o600 });
  await fs.writeFile(path.join(directory, 'review.md'), `# Hosted release acceptance proposal\n\nStatus: ${plan.status}. No remote mutations performed.\n\nUse account ${accountId} already selected by the authenticated one-account Wrangler profile.\n\nCreate only these fresh resources after approval:\n\n- Worker: ${resourceNames.worker}\n- Workflow: ${resourceNames.workflow}\n- D1 database: ${resourceNames.database}\n\nNo custom domain, production binding, existing application or promotion is selected.\n\nBefore any create, inspect account inventories and prove these names absent. Save private immutable IDs/creation receipts before the next mutation. Create the D1 database, record its ID, replace only the placeholder in this private app, then rebuild and deploy this Worker. Upload secrets through private file input, never CLI values. Both acceptance APIs reject requests until ACCEPTANCE_KEY is configured.\n\nVerify actual native Waiting at the event barrier, failed-step retry, external event completion, pause/resume, terminal failure redaction and D1 completed-step counters. Tail the Worker to verify each deliberate API failure's returned request ID against the provider-delivered fixed structured event; keep raw tail data private because provider metadata can include request details. Uploaded maps alone do not prove remote remapping.\n\nCleanup requires matching account, unique names and recorded immutable IDs: remove this owned Workflow and its instances, this owned Worker and its Durable Object namespaces, and this owned D1 database. Confirm absence. Unknown or conflicting ownership requires manual review, not name-only deletion. Preserve private receipts on interrupted cleanup.\n\nThis is not CF-09 hosted CI acceptance, provider startup measurement or a completed release claim.\n`, { mode: 0o600 });
  return { directory, resourceNames, built: build, remoteMutationPerformed: false };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--build') options.build = true;
      else if (['--installed-root', '--out'].includes(args[index]) && args[index + 1] && !args[index + 1].startsWith('--')) {
        options[args[index] === '--out' ? 'outputDir' : 'installedRoot'] = args[++index];
      } else throw new Error('Usage: --installed-root <absolute path> [--out <fresh absolute path>] [--build]');
    }
    console.log(JSON.stringify(await prepareHostedRelease(options)));
  } catch {
    console.error('Hosted acceptance preparation failed; no deployment command is implemented. Inspect the private preparation directory.');
    process.exitCode = 1;
  }
}
