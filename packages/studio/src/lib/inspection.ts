import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ORMConfig, ORMToolingContext } from '@cossackframework/database';
import { inspectConfiguredDatabase, type DatabaseInspection } from '@cossackframework/database/tooling';

/** Studio and CLI use the same read-only service and connection ownership. */
export function inspectStudioDatabase(config: ORMConfig, context: ORMToolingContext): Promise<DatabaseInspection> {
  return inspectConfiguredDatabase(config, context);
}

export interface StudioInspectionOptions {
  projectRoot: string;
  environment?: string;
  target?: 'local' | 'remote';
  binding?: string;
}

export async function inspectStudioProject(options: StudioInspectionOptions): Promise<DatabaseInspection> {
  const cwd = path.resolve(options.projectRoot);
  const require = createRequire(path.join(cwd, 'package.json'));
  const root = path.dirname(require.resolve('@cossackframework/database/package.json'));
  const tooling = await import(pathToFileURL(path.join(root, 'dist/tooling/index.js')).href) as typeof import('@cossackframework/database/tooling');
  const configPath = path.join(cwd, 'orm.config.ts');
  const config = await tooling.loadORMConfig(configPath);
  const inspection = await tooling.inspectConfiguredDatabase(config, { cwd, configPath,
    target: options.target ?? 'local', readOnly: true,
    ...(options.environment ? { environment: options.environment } : {}) });
  if (options.binding && inspection.target.binding !== options.binding) {
    throw new Error('The inspected database does not match the requested Studio binding. Configure the adapter to select that binding.');
  }
  return inspection;
}
