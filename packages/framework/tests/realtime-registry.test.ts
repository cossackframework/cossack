import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findRealtimeComponents, realtimeIdAssignments, realtimeRegistryModule, scanRealtimeComponents } from '../src/realtime-registry';

// The build-time registry of realtime child components: exactly the classes
// decorated with `@Component({ transport: 'durable-object', ... })`. The server
// builds a realtime component only from this registry.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function project(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-realtime-registry-'));
  roots.push(root);
  for (const [file, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), source);
  }
  return root;
}

const perUser = `scope: (c: any) => 'user:' + c.get('user').id`;

describe('realtime component registry', () => {
  it('contains exactly the realtime components and never a non-realtime one', () => {
    const root = project({
      'src/components/CartBadge.ts': `
        import { Component, Cossack, State } from '@cossackframework/core';
        @Component({ transport: 'durable-object', ${perUser} })
        export class CartBadge extends Cossack { @State() count = 0; }
        // A sibling without the realtime transport stays out.
        @Component() export class Price extends Cossack {}
      `,
      'src/components/Feed.ts': `
        import { Component as Widget, Cossack } from '@cossackframework/core';
        @Widget({ transport: 'durable-object', ${perUser} })
        class Feed extends Cossack {}
        export default Feed;
      `,
      'src/components/Namespaced.ts': `
        import * as core from '@cossackframework/core';
        @core.Component({ transport: 'durable-object', ${perUser} })
        export default class Namespaced extends core.Cossack {}
      `,
      'src/components/Http.ts': `
        import { Component, Cossack } from '@cossackframework/core';
        @Component({ transport: 'http' }) export class Http extends Cossack {}
        @Component({ transport: 'sse' }) export class Sse extends Cossack {}
      `,
      // Text that merely mentions the transport is not a decorator.
      'src/components/Docs.ts': `export const note = "@Component({ transport: 'durable-object' })";`,
      // A Page or a decorator from another package is not a realtime component.
      'src/components/Other.ts': `
        import { Page, Cossack } from '@cossackframework/core';
        import { Component } from './local';
        @Page({ transport: 'durable-object' }) export class Room extends Cossack {}
        @Component({ transport: 'durable-object', ${perUser} }) export class Local extends Cossack {}
      `,
      'src/components/CartBadge.test.ts': `
        import { Component, Cossack } from '@cossackframework/core';
        @Component({ transport: 'durable-object', ${perUser} }) export class Fixture extends Cossack {}
      `,
    });
    const scan = scanRealtimeComponents(root);
    expect(scan.diagnostics).toEqual([]);
    expect(scan.components.map(component => component.id)).toEqual([
      '/src/components/CartBadge.ts#CartBadge',
      '/src/components/Feed.ts#default',
      '/src/components/Namespaced.ts#default',
    ]);

    const server = realtimeRegistryModule(scan.components, true);
    expect(server).toContain('import * as realtime0 from "/src/components/CartBadge.ts";');
    expect(server).toContain('"/src/components/CartBadge.ts#CartBadge": realtime0["CartBadge"]');
    expect(server).toContain('"/src/components/Feed.ts#default": realtime1["default"]');
    for (const excluded of ['Price', 'Http', 'Sse', 'Room', 'Local', 'Fixture', 'Docs.ts', 'Other.ts']) expect(server).not.toContain(excluded);
    // The browser never receives the registry.
    expect(realtimeRegistryModule(scan.components, false)).toBe('export default { components: {} };\n');
  });

  it('attaches each registry id to its class', () => {
    const { components } = findRealtimeComponents(`
      import { Component, Cossack } from '@cossackframework/core';
      @Component({ transport: 'durable-object', ${perUser} }) class Local extends Cossack {}
      export { Local as Widget };
    `, '/src/widget.ts');
    expect(components).toEqual([{ id: '/src/widget.ts#Widget', file: '/src/widget.ts', exportName: 'Widget', className: 'Local', line: 3 }]);
    const Local = class {};
    new Function('Local', realtimeIdAssignments(components))(Local);
    expect(Object.getOwnPropertyDescriptor(Local, '__cossackRealtimeId')).toMatchObject({ value: '/src/widget.ts#Widget', writable: false });
  });

  it('reports components the server could not build safely', () => {
    const { components, diagnostics } = findRealtimeComponents(`
      import { Component, Cossack } from '@cossackframework/core';
      @Component({ transport: 'durable-object' }) export class Unscoped extends Cossack {}
      @Component({ transport: 'durable-object', ${perUser} }) class Hidden extends Cossack {}
      @Component({ transport: 'durable-object', ...shared }) export class Spread extends Cossack {}
    `, '/src/bad.ts');
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'COSSACK_REALTIME_COMPONENT_SCOPE_REQUIRED', 'COSSACK_REALTIME_COMPONENT_UNEXPORTED',
    ]);
    // A spread may supply the scope; the server checks it again at runtime.
    expect(components.map(component => component.className)).toEqual(['Spread']);
  });
});
