import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { readPackageVersion } from '../pkg.js';
import { InspectionRunner } from './inspection-runner.js';

async function frameworkVersion(root) {
  try {
    const require = createRequire(path.join(root, 'package.json'));
    // The framework exposes import-only entries, so require.resolve(entry) fails.
    // Read the installed manifest along Node's package search path without loading it.
    for (const directory of require.resolve.paths('@cossackframework/framework') ?? []) {
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(directory, '@cossackframework/framework/package.json'), 'utf8'));
        if (pkg.name === '@cossackframework/framework' && typeof pkg.version === 'string') return pkg.version;
      } catch {}
    }
    return null;
  } catch { return null; }
}

export async function startMcpServer(project, options = {}) {
  const root = await fs.realpath(project);
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('Invalid project package.json.');
  const versions = { cli: readPackageVersion(), framework: await frameworkVersion(root) };
  const runner = new InspectionRunner(root);
  const handle = serveStdio(() => {
    const server = new McpServer({ name: 'cossack', version: versions.cli });
    server.registerTool('inspect_project', {
      description: 'Inspect static Cossack routes, Cloudflare configuration or cache/rate-limit providers in the bound project. No build, module execution or remote readiness check.',
      inputSchema: z.object({
        scope: z.enum(['routes', 'cloudflare', 'providers']),
        environment: z.string().min(1).max(128).optional(),
        route: z.string().min(1).max(2048).optional(),
        check: z.boolean().default(false),
      }).strict().refine(value => value.route === undefined || value.scope === 'routes' && !value.check, { message: 'route requires routes inspection without check.' }),
      outputSchema: z.object({
        schemaVersion: z.literal(1),
        versions: z.object({ cli: z.string(), framework: z.string().nullable() }),
        ok: z.boolean(), data: z.unknown(),
        diagnostics: z.array(z.object({ code: z.string(), message: z.string(), severity: z.string() }).passthrough()),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (input, ctx) => {
      let result;
      try { result = await runner.run(input, ctx.mcpReq.signal); }
      catch (error) { result = { ok: false, data: null, diagnostics: [{ code: error.code ?? 'COSSACK_INSPECTION_FAILED', severity: 'error', message: 'Inspection did not complete.' }] }; }
      const structuredContent = { schemaVersion: 1, versions, ...result };
      return { structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }], isError: !result.ok };
    });
    return server;
  }, options);
  return { root, versions, async close() { await runner.close(); await handle.close(); } };
}
