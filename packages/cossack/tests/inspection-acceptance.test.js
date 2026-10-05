import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildEffectiveRouteModel } from '../src/scan-routes.js';
import { explainRoute } from '../src/inspection-service.js';
import { transformCossackClass, transformServerResources, isClientSafeMethod } from '@cossackframework/framework/vite-security-plugin';
let root;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-inspection-acceptance-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function write(file, source) {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, source);
}
it('combines grouped routes, nested layouts, recipes, services, and compiled method facts', async () => {
  await write('package.json', '{}');
  await write('.cossack/scaffold.json', JSON.stringify({ schemaVersion: 3, runtime: 'node', explicitFeatures: ['auth'], config: { database: 'sqlite' } }));
  await write('src/pages/layout.ts', '@Page({ services: [Session], middlewares: [outer] }) export default class Layout {}');
  await write('src/pages/(account)/layout.ts', '@Page({ services: [Audit], middlewares: [inner, access] }) export default class Account {}');
  await write('src/shared/base.ts', 'export default class Base extends Cossack { @Server() inherited() { return "PRIVATE_BASE"; } }');
  const source = `import { server$ } from '@cossackframework/core';
import Base from '../../../../shared/base.js';
@Page({ transport: 'sse', middlewares: [pageGuard], services: [Local] })
export default class Users extends Base {
  constructor() { super(); throw new Error('inspection must not execute'); }
  data = server$(() => 'PRIVATE_RESOURCE', { initial: '' });
  @Server() save() { return 'PRIVATE_SERVER'; }
  automatic() { return 'PRIVATE_AUTOMATIC'; }
  unused() { return 'PRIVATE_UNUSED'; }
  @Client() local() { return 'CLIENT_BODY'; }
  render() { this.helper(); return html\`<button @click="\${this.automatic}">Save</button>\`; }
  helper() { return 'CLIENT_HELPER'; }
}`;
  const file = 'src/pages/(account)/users/[id]/index.ts';
  const authored = source;
  await write(file, authored);
  const model = await buildEffectiveRouteModel(root);
  const page = model.pages[0];
  expect(page.route).toBe('/users/:id');
  expect(page.layouts).toEqual(['/src/pages/layout.ts', '/src/pages/(account)/layout.ts']);
  expect(page.middlewareStack.map(entry => entry.count)).toEqual([1, 2, 1]);
  expect(page.layoutAndPageMiddlewareCount).toBe(4);
  expect(model.layouts.map(layout => layout.services)).toEqual([['Audit'], ['Session']]);
  expect(page.services).toEqual(['Local']);
  expect(page.inheritance.status).toBe('resolved');
  expect(page.inheritedDeclarations[0].methods[0].name).toBe('inherited');
  expect(page.serverMethods.map(method => method.resource ?? method.name)).toEqual(expect.arrayContaining(['save', 'automatic', 'data']));
  expect(page.clientMethods.map(method => method.name)).toEqual(expect.arrayContaining(['local', 'render', 'helper']));
  expect(page.strippedMethods.map(method => method.name)).toEqual(['unused']);
  expect(model.scaffold.recipe.features.map(feature => feature.name)).toEqual(['ui', 'database', 'auth']);
  expect(model.runtime.transports[0].status).toBe('available');
  const id = path.join(root, file);
  const client = transformCossackClass(transformServerResources(authored, id), id, isClientSafeMethod, new Set(['render']), false);
  for (const marker of ['PRIVATE_RESOURCE', 'PRIVATE_SERVER', 'PRIVATE_AUTOMATIC', 'PRIVATE_UNUSED']) expect(client).not.toContain(marker);
  for (const marker of ['CLIENT_BODY', 'CLIENT_HELPER']) expect(client).toContain(marker);
  for (const method of page.serverMethods) expect(client).toContain(`__cossack_proxies?.get('${method.name}')`);
});
it('keeps layout middleware totals unknown when options cannot be resolved', async () => {
  await write('src/pages/layout.ts', '@Page(config) export default class Layout {}');
  await write('src/pages/index.ts', '@Page({ middlewares: [guard] }) export default class Page {}');
  const page = (await buildEffectiveRouteModel(root)).pages[0];
  expect(page.middlewareStack.map(entry => entry.count)).toEqual([null, 1]);
  expect(page.layoutAndPageMiddlewareCount).toBeNull();
});

it('resolves aliased and re-exported layout service tokens to their class declarations', async () => {
  await write('tsconfig.json', JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', skipLibCheck: true },
    include: ['src/**/*.ts'],
  }));
  await write('src/services/session.ts', `import { Service as RegisterService } from '@cossackframework/core';
    @RegisterService() export class SessionService { static { throw new Error('inspection must not execute service modules'); } }`);
  await write('src/services/index.ts', "export { SessionService as SessionAlias } from './session.js';");
  await write('src/pages/layout.ts', `import { SessionAlias as RootSession } from '../services/index.js';
    @Page({ services: [RootSession] }) export default class RootLayout {}`);
  await write('src/pages/(account)/layout.ts', `import { SessionService } from '../../services/session.js';
    @Page({ services: [SessionService] }) export default class AccountLayout {}`);
  await write('src/pages/(account)/index.ts', '@Page() export default class Home {}');

  const model = await buildEffectiveRouteModel(root);
  expect(model.layouts.map(layout => layout.serviceOwnership)).toEqual([
    { method: 'typescript-source', status: 'resolved', services: [
      { expression: 'SessionService', className: 'SessionService', source: '/src/services/session.ts', line: 2, serviceDecorator: 'declared' },
    ] },
    { method: 'typescript-source', status: 'resolved', services: [
      { expression: 'RootSession', className: 'SessionService', source: '/src/services/session.ts', line: 2, serviceDecorator: 'declared' },
    ] },
  ]);
  const explanation = explainRoute(model, '/src/pages/(account)/index.ts');
  expect(explanation.reasons.join('\n')).toContain(
    'TypeScript-source-resolved service class tokens: SessionService (/src/services/session.ts:2; service decorator: declared)',
  );
});

it('resolves service tokens through a namespace re-export', async () => {
  await write('src/services/session.ts', "import { Service } from '@cossackframework/core'; @Service() export class SessionService {}");
  await write('src/services/index.ts', "export * as tokens from './session.js';");
  await write('src/pages/layout.ts', `import { tokens as serviceTokens } from '../services/index.js';
    @Page({ services: [serviceTokens.SessionService] }) export default class Layout {}`);
  await write('src/pages/index.ts', '@Page() export default class Home {}');

  const model = await buildEffectiveRouteModel(root);
  expect(model.layouts[0].serviceOwnership).toMatchObject({
    method: 'typescript-source', status: 'resolved', services: [
      { expression: 'serviceTokens.SessionService', className: 'SessionService', source: '/src/services/session.ts', line: 1, serviceDecorator: 'declared' },
    ],
  });
});

it('identifies a resolved class that lacks the required service decorator', async () => {
  await write('src/services/session.ts', 'export class SessionService {}');
  await write('src/pages/layout.ts', `import { SessionService } from '../services/session.js';
    @Page({ services: [SessionService] }) export default class Layout {}`);
  await write('src/pages/index.ts', '@Page() export default class Home {}');

  const model = await buildEffectiveRouteModel(root);
  expect(model.layouts[0].serviceOwnership.services[0].serviceDecorator).toBe('missing');
  const explanation = explainRoute(model, '/src/pages/index.ts');
  expect(explanation.reasons.join('\n')).toContain('service decorator: missing');
});

it('reports dynamic layout service tokens as unknown instead of guessing an owner', async () => {
  await write('src/pages/layout.ts', '@Page({ services: [selectService()] }) export default class Layout {}');
  await write('src/pages/index.ts', '@Page() export default class Home {}');

  const model = await buildEffectiveRouteModel(root);
  expect(model.layouts[0].serviceOwnership).toMatchObject({
    method: 'typescript-source', status: 'unknown',
    reason: expect.stringContaining('is dynamic'),
  });
});

it('reports cyclic source aliases as unknown without recursing indefinitely', async () => {
  await write('src/pages/layout.ts', `const first = second;
    const second = first;
    @Page({ services: [first] }) export default class Layout {}`);
  await write('src/pages/index.ts', '@Page() export default class Home {}');

  const model = await buildEffectiveRouteModel(root);
  expect(model.layouts[0].serviceOwnership).toMatchObject({
    method: 'typescript-source', status: 'unknown',
    reason: expect.stringContaining('does not resolve to one class declaration'),
  });
});

it('resolves layout service ownership inherited from an imported base layout', async () => {
  await write('src/services/session.ts', "import { Service } from '@cossackframework/core'; @Service() export class SessionService {}");
  await write('src/shared/base-layout.ts', `import { SessionService } from '../services/session.js';
    @Page({ services: [SessionService] }) export class BaseLayout {}`);
  await write('src/pages/layout.ts', `import { BaseLayout } from '../shared/base-layout.js';
    export default class Layout extends BaseLayout {}`);
  await write('src/pages/index.ts', '@Page() export default class Home {}');

  const model = await buildEffectiveRouteModel(root);
  expect(model.layouts[0].serviceOwnership).toMatchObject({
    method: 'typescript-source', status: 'resolved', services: [
      { expression: 'SessionService', className: 'SessionService', source: '/src/services/session.ts', line: 1, serviceDecorator: 'declared' },
    ],
  });
  const explanation = explainRoute(model, '/src/pages/index.ts');
  expect(explanation.reasons.join('\n')).toContain(
    'TypeScript-source-resolved service class tokens: SessionService (/src/services/session.ts:1; service decorator: declared)',
  );
  expect(explanation.reasons.join('\n')).not.toContain('Service ownership is unknown');
});
