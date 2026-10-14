import { DEVELOPMENT_TRACE_SESSION } from '@cossackframework/framework/development-traces';
import { testRunIdSchema } from '../test-results-service.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readInstalledPackage, COSSACK_PACKAGES } from '../installed-packages.js';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { readPackageVersion } from '../pkg.js';
import { InspectionRunner } from './inspection-runner.js';

const toolResultSchema = z.object({
  schemaVersion: z.literal(1),
  versions: z.object({ cli: z.string(), framework: z.string().nullable() }),
  ok: z.boolean(), data: z.unknown(),
  diagnostics: z.array(z.object({ code: z.string(), message: z.string(), severity: z.string() }).passthrough()),
});

export async function startMcpServer(project, options = {}) {
  const root = await fs.realpath(project);
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('Invalid project package.json.');
  const versions = { cli: readPackageVersion(), framework: (await readInstalledPackage(root, '@cossackframework/framework').catch(() => null))?.manifest.version ?? null };
  const runner = new InspectionRunner(root);
  const handle = serveStdio(() => {
    const server = new McpServer({ name: 'cossack', version: versions.cli });
    server.registerTool('inspect_project', {
      description: 'Inspect static Cossack routes, Cloudflare configuration, localization catalogs, schedules, workflows or cache/rate-limit providers in the bound project. No build, application-module execution or remote readiness check; every scope except localization may import the project\'s installed Wrangler to parse its configuration.',
      inputSchema: z.object({
        scope: z.enum(['routes', 'cloudflare', 'providers', 'localization', 'schedules', 'workflows']),
        environment: z.string().min(1).max(128).optional(),
        route: z.string().min(1).max(2048).optional(),
        locale: z.string().min(1).max(64).optional(),
        check: z.boolean().default(false),
      }).strict().refine(value => value.route === undefined || value.scope === 'routes' && !value.check, { message: 'route requires routes inspection without check.' }).refine(value => value.locale === undefined || value.scope === 'localization', { message: 'locale requires localization inspection.' }),
      outputSchema: toolResultSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (input, ctx) => {
      let result;
      try { result = await runner.run(input, ctx.mcpReq.signal); }
      catch (error) { result = { ok: false, data: null, diagnostics: [{ code: error.code ?? 'COSSACK_INSPECTION_FAILED', severity: 'error', message: 'Inspection did not complete.' }] }; }
      const installed = await readInstalledPackage(root, '@cossackframework/framework').catch(() => null);
      const structuredContent = { schemaVersion: 1, versions: { ...versions, framework: installed?.manifest.version ?? null }, ...result };
      return { structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }], isError: !result.ok };
    });
    server.registerTool('read_documentation', {
      description: 'Read offline installed package export targets, versioned CLI command schemas and agent guidance. Use symbol with symbols:true for one exact export when a full catalog is too large. No application modules are executed.',
      inputSchema: z.object({ package: z.enum(COSSACK_PACKAGES).optional(), symbols: z.boolean().default(false), symbol: z.string().min(1).max(256).refine(value => value.trim().length > 0).optional() }).strict()
        .refine(value => !value.symbols || value.package !== undefined, { message: 'symbols requires package.' })
        .refine(value => value.symbol === undefined || value.symbols, { message: 'symbol requires symbols.' }),
      outputSchema: toolResultSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (input, ctx) => {
      let result;
      try { result = await runner.run({ operation: 'documentation', ...input }, ctx.mcpReq.signal); }
      catch (error) { result = { ok: false, data: null, diagnostics: [{ code: error.code ?? 'COSSACK_DOCS_FAILED', severity: 'error', message: error.code === 'COSSACK_MCP_RESULT_TOO_LARGE' ? 'Catalog exceeds the response limit. Request one exact export with symbols:true and symbol.' : 'Documentation could not be read.' }] }; }
      const installed = await readInstalledPackage(root, '@cossackframework/framework').catch(() => null);
      const structuredContent = { schemaVersion: 1, versions: { ...versions, framework: installed?.manifest.version ?? null }, ...result };
      return { structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }], isError: !result.ok };
    });
    server.registerTool('read_test_results', {
      description: 'Read recorded Vitest evidence for the bound project and compare bounded source snapshots. Does not run tests. Missing, unfinished, changed and unknown evidence never imply a current passing suite.',
      inputSchema: z.object({ run: testRunIdSchema.optional() }).strict(),
      outputSchema: toolResultSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (input, ctx) => {
      let result;
      try { result = await runner.run({ operation: 'test-results', ...input }, ctx.mcpReq.signal); }
      catch (error) { result = { ok: false, data: null, diagnostics: [{ code: error.code ?? 'COSSACK_TEST_REPORT_FAILED', severity: 'error', message: 'Stored test evidence could not be read.' }] }; }
      const installed = await readInstalledPackage(root, '@cossackframework/framework').catch(() => null);
      const structuredContent = { schemaVersion: 1, versions: { ...versions, framework: installed?.manifest.version ?? null }, ...result };
      return { structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }], isError: !result.ok };
    });
    server.registerTool('read_development_traces', {
      description: 'Read bounded browser development snapshots for the bound project. No recording, code execution or live server query. Values are omitted; age and provenance distinguish historical capture from current state.',
      inputSchema: z.object({ session: z.string().regex(DEVELOPMENT_TRACE_SESSION).optional() }).strict(),
      outputSchema: toolResultSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (input, ctx) => {
      let result;
      try { result = await runner.run({ operation: 'traces', ...input }, ctx.mcpReq.signal); }
      catch (error) { result = { ok: false, data: null, diagnostics: [{ code: error.code ?? 'COSSACK_TRACE_FAILED', severity: 'error', message: 'Stored development trace could not be read.' }] }; }
      const installed = await readInstalledPackage(root, '@cossackframework/framework').catch(() => null);
      const structuredContent = { schemaVersion: 1, versions: { ...versions, framework: installed?.manifest.version ?? null }, ...result };
      return { structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }], isError: !result.ok };
    });
    return server;
  }, options);
  return { root, versions, async close() { await runner.close(); await handle.close(); } };
}
