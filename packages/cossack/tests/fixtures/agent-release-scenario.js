import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const repository = path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const execute = promisify(execFile);
const digest = (value) => createHash('sha256').update(value).digest('hex');

// The SDK is a test client. Every server-side CLI/compiler/scaffold import must
// resolve from the actual tarball consumer, never a workspace library link.
export async function verifyAgentReleaseScenario(installedRoot) {
  const consumer = await fs.realpath(installedRoot);
  const relativeConsumer = path.relative(repository, consumer);
  assert(
    relativeConsumer === '..' || relativeConsumer.startsWith(`..${path.sep}`) || path.isAbsolute(relativeConsumer),
    'A real installed consumer outside the workspace is required',
  );
  const requireConsumer = createRequire(path.join(consumer, 'package.json'));
  const cliPath = await fs.realpath(requireConsumer.resolve('cossack/bin/cossack.js'));
  const mcpPath = await fs.realpath(requireConsumer.resolve('cossack/bin/cossack-mcp.js'));
  const requireCli = createRequire(cliPath);
  const artifacts = {};
  for (const name of [
    'cossack',
    '@cossackframework/scaffold',
    '@cossackframework/framework',
    '@cossackframework/core',
    '@cossackframework/renderer',
  ]) {
    const resolver = name === '@cossackframework/scaffold' ? requireCli : requireConsumer;
    let resolved;
    try {
      resolved = resolver.resolve(`${name}/package.json`);
    } catch (error) {
      if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
      for (const search of resolver.resolve.paths(name)) {
        const candidate = path.join(search, name, 'package.json');
        try {
          await fs.access(candidate);
          resolved = candidate;
          break;
        } catch {}
      }
    }
    assert(resolved, `Installed metadata for ${name} is required`);
    const packagePath = await fs.realpath(resolved);
    assert(packagePath.startsWith(consumer + path.sep), `${name} must be installed in the consumer`);
    assert(
      packagePath.includes('@file+'),
      `${name} must originate from a file tarball, not a registry or workspace link`,
    );
    const manifest = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    artifacts[name] = { version: manifest.version, packagePath, packageSha256: digest(await fs.readFile(packagePath)) };
  }
  assert(cliPath.startsWith(path.dirname(artifacts.cossack.packagePath) + path.sep));
  assert(mcpPath.startsWith(path.dirname(artifacts.cossack.packagePath) + path.sep));
  const evidence = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-agent-scenario-'));
  const app = path.join(evidence, 'app');
  const steps = [];
  async function cli(args, cwd = app, expectedCode = 0) {
    let result;
    try {
      result = {
        ...(await execute(process.execPath, [cliPath, ...args, '--json'], {
          cwd,
          timeout: 45000,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env, VITEST: '', WRANGLER_SEND_METRICS: 'false' },
        })),
        code: 0,
      };
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      result = { stdout: error.stdout, stderr: error.stderr, code: error.code };
    }
    assert.equal(result.code, expectedCode, `CLI ${args.join(' ')}: ${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr, '', 'Structured CLI output must not mix raw diagnostics into stderr');
    const envelope = JSON.parse(result.stdout.trim());
    assert.equal(envelope.schemaVersion, 1);
    assert.equal(envelope.command, args[0]);
    assert.equal(envelope.ok, expectedCode === 0);
    steps.push({ args, exitCode: result.code, envelope });
    await fs.writeFile(path.join(evidence, `${steps.length}-cli.json`), JSON.stringify(steps.at(-1), null, 2), {
      mode: 0o600,
    });
    return envelope;
  }
  async function snapshot(directory = app, prefix = '') {
    const records = {};
    for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (item.name === 'node_modules') continue;
      const relative = path.join(prefix, item.name);
      const target = path.join(directory, item.name);
      if (item.isDirectory()) Object.assign(records, await snapshot(target, relative));
      else {
        assert(item.isFile(), 'Only authored files and the explicit node_modules link are allowed');
        records[relative] = digest(await fs.readFile(target));
      }
    }
    return records;
  }
  let client;
  try {
    const created = await cli(['create', 'app', '--adapter=cloudflare', '--preset=minimal', '--yes'], evidence);
    assert.equal(created.data.status, 'created');
    await fs.symlink(path.join(consumer, 'node_modules'), path.join(app, 'node_modules'), 'dir');
    // Keep authored dependencies bound to the same retained tarballs. The recipe
    // may propose additional packages; this scenario does not execute their UI.
    const consumerPackage = JSON.parse(await fs.readFile(path.join(consumer, 'package.json'), 'utf8'));
    const appPackage = JSON.parse(await fs.readFile(path.join(app, 'package.json'), 'utf8'));
    for (const [name, reference] of Object.entries(consumerPackage.dependencies)) {
      if (reference.startsWith('file:'))
        appPackage.dependencies[name] = `file:${path.resolve(consumer, reference.slice(5))}`;
    }
    appPackage.packageManager = consumerPackage.packageManager;
    await fs.writeFile(path.join(app, 'package.json'), JSON.stringify(appPackage, null, 2) + '\n');
    const workspace = await fs.readFile(path.join(consumer, 'pnpm-workspace.yaml'), 'utf8');
    await fs.writeFile(
      path.join(app, 'pnpm-workspace.yaml'),
      workspace.replaceAll('file:./acceptance-artifacts/', `file:${consumer}/acceptance-artifacts/`),
    );
    const manifestPath = path.join(app, '.cossack/scaffold.json');
    const beforeManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.deepEqual(beforeManifest.resolvedFeatures, []);
    const pageRelative = 'src/pages/index.ts';
    assert(beforeManifest.files[pageRelative], 'The edited page must be scaffold-owned');
    const pagePath = path.join(app, pageRelative);
    const originalPage = await fs.readFile(pagePath, 'utf8');
    const authored =
      originalPage +
      "\n// agent-owned customization must survive composition\nthrow new Error('agent-inspection-must-not-execute-application');\n";
    await fs.writeFile(pagePath, authored);
    const inspected = await cli(['inspect', 'routes']);
    assert(inspected.data.routes.some((route) => route.filePath === `/${pageRelative}`));
    const beforePlan = await snapshot();
    const plan = await cli(['add', 'ui', '--dry-run', '--yes']);
    assert.equal(plan.data.status, 'dry-run');
    assert(plan.data.resolvedFeatures.includes('ui'));
    const plannedFiles = plan.data.effects.filter((effect) => effect.action === 'planned').map((effect) => effect.path);
    assert(plannedFiles.length > 0, 'A recipe plan must expose real file effects');
    assert(!plannedFiles.includes(pageRelative), 'The plan must not schedule replacement of the edited page');
    assert.deepEqual(await snapshot(), beforePlan, 'Dry-run must not change any authored file');
    const applied = await cli(['add', 'ui', '--yes']);
    assert.equal(applied.data.status, 'added');
    assert(applied.data.resolvedFeatures.includes('ui'));
    assert(
      !applied.data.effects.some(
        (effect) => effect.path === pageRelative && ['created', 'overwritten'].includes(effect.action),
      ),
    );
    assert.equal(await fs.readFile(pagePath, 'utf8'), authored);
    const afterManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert(afterManifest.resolvedFeatures.includes('ui'));
    assert.equal(
      afterManifest.files[pageRelative].hash,
      beforeManifest.files[pageRelative].hash,
      'Preserved edits must not silently become the owned template baseline',
    );
    const afterApply = await snapshot();
    const checked = await cli(['check', 'routes']);
    assert(checked.data.scaffold.recipe.features.some((feature) => feature.name === 'ui'));
    assert.deepEqual(await snapshot(), afterApply, 'Structured checks must not change authored files');
    assert.equal(checked.data.readiness.staticMetadata, 'valid');
    assert.deepEqual(checked.diagnostics, []);
    client = new Client({ name: 'cossack-release-agent', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpPath, '--project', app],
      stderr: 'pipe',
      env: { ...process.env, VITEST: '', WRANGLER_SEND_METRICS: 'false' },
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    await client.connect(transport);
    const tools = await client.listTools();
    assert(tools.tools.some((tool) => tool.name === 'inspect_project' && tool.annotations?.readOnlyHint === true));
    const remote = await client.callTool({ name: 'inspect_project', arguments: { scope: 'routes', check: true } });
    assert.equal(remote.structuredContent.versions.cli, artifacts.cossack.version);
    assert.equal(remote.structuredContent.versions.framework, artifacts['@cossackframework/framework'].version);
    assert.deepEqual(remote.structuredContent.data, checked.data);
    assert.deepEqual(remote.structuredContent.diagnostics, checked.diagnostics);
    assert.equal(remote.structuredContent.ok, checked.ok);
    assert.deepEqual(await snapshot(), afterApply, 'MCP inspection must not change authored files');
    const badPage = path.join(app, 'src/pages/agent-invalid.ts');
    await fs.writeFile(
      badPage,
      "import { Cossack, Page } from '@cossackframework/core';\n@Page({transport:'agent-invalid-transport'}) export default class Invalid extends Cossack {render(){return null;}}\n",
    );
    const invalid = await cli(['check', 'routes'], app, 1);
    assert(invalid.diagnostics.some((diagnostic) => diagnostic.code === 'COSSACK_ROUTE_TRANSPORT_INVALID'));
    const remoteInvalid = await client.callTool({
      name: 'inspect_project',
      arguments: { scope: 'routes', check: true },
    });
    assert.equal(remoteInvalid.structuredContent.ok, false);
    assert.deepEqual(remoteInvalid.structuredContent.data, invalid.data);
    assert.deepEqual(remoteInvalid.structuredContent.diagnostics, invalid.diagnostics);
    await fs.rm(badPage);
    const recovered = await cli(['check', 'routes']);
    const remoteRecovered = await client.callTool({
      name: 'inspect_project',
      arguments: { scope: 'routes', check: true },
    });
    assert.deepEqual(remoteRecovered.structuredContent.data, recovered.data);
    assert.deepEqual(remoteRecovered.structuredContent.diagnostics, []);
    assert.equal(await fs.readFile(pagePath, 'utf8'), authored);
    assert.equal(stderr, '', 'MCP stdout is protocol-owned and stderr must remain quiet');
    const result = {
      evidence,
      app,
      artifacts,
      plannedFiles,
      preservedPage: pageRelative,
      diagnosticCodes: invalid.diagnostics.map((item) => item.code),
      steps: steps.length,
      runtime: 'static-inspection-only',
      mcp: {
        valid: remote.structuredContent,
        invalid: remoteInvalid.structuredContent,
        recovered: remoteRecovered.structuredContent,
      },
    };
    await fs.writeFile(path.join(evidence, 'verified.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  } finally {
    try {
      await client?.close();
    } finally {
      // Retain authored files and evidence; detach the shared immutable dependency
      // tree so future cleanup cannot accidentally recurse into the consumer.
      await fs.rm(path.join(app, 'node_modules'), { force: true });
    }
  }
}
