import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BUILTIN_METHODS,
  cossackSecurityPlugin,
  findAutomaticRpcEndpoints,
  injectAutomaticServerMethodMetadata,
  isClientSafeMethod,
  transformCossackClass,
} from '../src/vite-security-plugin';

// Class discovery is fail closed. A class is stripped when it is a framework
// class, left alone when it is a plain class, and the client build fails when
// it extends a base that discovery cannot classify and stripping would change
// it. Imported bases are classified by reading the module they come from, the
// same way in the client and server builds.

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cossack-class-discovery-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

function file(relative: string, source: string): string {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, 'utf8');
  return path;
}

const client = (code: string, id: string, aliases: { find: string | RegExp; replacement: string }[] = []) =>
  transformCossackClass(code, id, isClientSafeMethod, BUILTIN_METHODS, true, { file: id, root, aliases });
const server = (code: string, id: string) =>
  injectAutomaticServerMethodMetadata(code, id, isClientSafeMethod, BUILTIN_METHODS, { file: id, root });

const core = `import { Cossack, Page, Server, Client, html } from '@cossackframework/core';\n`;
const frameworkBase = `${core}export class BasePage extends Cossack { render() { return ''; } }\n`;
const plainBase = `export class BasePage { greet() { return 'hi'; } }\n`;
/** A subclass whose `loadSecrets` would be stripped, and whose `remove` is an automatic RPC endpoint. */
const subclass = (importLine: string, base = 'BasePage') => `${importLine}
export default class ReportPage extends ${base} {
  render() { return html\`<button @click=\${() => this.remove()}>x</button>\`; }
  async loadSecrets() { return 'SECRET_REPORT'; }
  async remove() { return 'SECRET_REMOVE'; }
}
`;

describe('imported base classes', () => {
  it('strips a subclass of a framework base declared in another module', () => {
    file('src/lib/base-page.ts', frameworkBase);
    const id = file('src/pages/reports/index.ts', subclass(`import { BasePage } from '../../lib/base-page';`));
    const out = client(subclass(`import { BasePage } from '../../lib/base-page';`), id);
    expect(out).not.toContain('SECRET_REPORT');
    expect(out).not.toContain('SECRET_REMOVE');
  });

  it('registers the same automatic RPC endpoints in the server build', () => {
    file('src/lib/base-page.ts', frameworkBase);
    const source = subclass(`import { BasePage } from '../../lib/base-page';`);
    const id = file('src/pages/reports/index.ts', source);
    expect(server(source, id)).toContain('"remove"');
    expect(findAutomaticRpcEndpoints(source, id, { file: id, root })).toEqual([{ className: 'ReportPage', methods: ['remove'] }]);
  });

  it.each([
    ['a named re-export', `export { BasePage } from './impl';`, `import { BasePage } from '../../lib/base-page';`, 'BasePage'],
    ['an export star', `export * from './impl';`, `import { BasePage } from '../../lib/base-page';`, 'BasePage'],
    ['a renamed local export', `import { BasePage as Impl } from './impl';\nexport { Impl as BasePage };`, `import { BasePage } from '../../lib/base-page';`, 'BasePage'],
    ['a default export', `export { BasePage as default } from './impl';`, `import Base from '../../lib/base-page';`, 'Base'],
    ['a namespace import', `export * from './impl';`, `import * as lib from '../../lib/base-page';`, 'lib.BasePage'],
    ['an emitted .js specifier', `export * from './impl';`, `import { BasePage } from '../../lib/base-page.js';`, 'BasePage'],
  ])('follows %s', (_label, barrel, importLine, base) => {
    file('src/lib/impl.ts', frameworkBase);
    file('src/lib/base-page.ts', barrel);
    const source = subclass(importLine, base);
    expect(client(source, file('src/pages/reports/index.ts', source))).not.toContain('SECRET_REPORT');
  });

  it('follows an inheritance chain across modules', () => {
    file('src/lib/root.ts', frameworkBase);
    file('src/lib/admin.ts', `import { BasePage } from './root';\nexport class AdminPage extends BasePage {}\n`);
    const source = subclass(`import { AdminPage } from '../../lib/admin';`, 'AdminPage');
    expect(client(source, file('src/pages/reports/index.ts', source))).not.toContain('SECRET_REPORT');
  });

  it('resolves Vite aliases and root-relative imports', () => {
    file('src/lib/base-page.ts', frameworkBase);
    const aliased = subclass(`import { BasePage } from '~/lib/base-page';`);
    expect(client(aliased, file('src/pages/a.ts', aliased), [{ find: '~', replacement: join(root, 'src') }])).not.toContain('SECRET_REPORT');
    const rooted = subclass(`import { BasePage } from '/src/lib/base-page';`);
    expect(client(rooted, file('src/pages/b.ts', rooted))).not.toContain('SECRET_REPORT');
  });

  it('treats UI package components and CossackService as framework bases', () => {
    const ui = subclass(`import { Card } from '@cossackframework/ui';\nimport { html } from '@cossackframework/core';`, 'Card');
    expect(client(ui, '/src/components/card.ts')).not.toContain('SECRET_REPORT');
    const service = `import { CossackService } from '@cossackframework/core';
      export class Billing extends CossackService { async charge() { return 'SECRET_CHARGE'; } }`;
    expect(client(service, '/src/services/billing.ts')).not.toContain('SECRET_CHARGE');
  });

  it('leaves a subclass of a plain imported class untouched', () => {
    file('src/lib/base-page.ts', plainBase);
    const source = subclass(`import { BasePage } from '../../lib/base-page';\nimport { html } from '@cossackframework/core';`);
    expect(client(source, file('src/pages/reports/index.ts', source))).toContain('SECRET_REPORT');
  });

  it('leaves subclasses of installed packages, builtins and non-component framework classes untouched', () => {
    file('node_modules/eventemitter3/package.json', '{"name":"eventemitter3"}');
    const thirdParty = `import { EventEmitter } from 'eventemitter3';
      export class Bus extends EventEmitter { publish() { return 'CLIENT_BUS'; } }`;
    expect(client(thirdParty, file('src/components/bus.ts', thirdParty))).toContain('CLIENT_BUS');
    const builtin = `import { EventEmitter } from 'node:events';
      export class Local extends EventEmitter { publish() { return 'CLIENT_BUILTIN'; } }`;
    expect(client(builtin, '/src/components/local.ts')).toContain('CLIENT_BUILTIN');
    const directive = `import { Directive } from '@cossackframework/renderer';
      export class Tooltip extends Directive { update() { return 'CLIENT_DIRECTIVE'; } }`;
    expect(client(directive, '/src/components/tooltip.ts')).toContain('CLIENT_DIRECTIVE');
  });
});

describe('bases discovery cannot classify', () => {
  it('fails the client build for a missing module instead of shipping the methods', () => {
    const source = subclass(`import { BasePage } from '../../lib/missing';`);
    expect(() => client(source, '/src/pages/reports/index.ts')).toThrow(
      /cannot classify class ReportPage \(extends BasePage\): BasePage is imported from '\.\.\/\.\.\/lib\/missing'.*\(loadSecrets, remove\).*@Page\(\) or @Component\(\).*@Client\(\)/s,
    );
  });

  it('fails for an alias it cannot follow', () => {
    const source = subclass(`import { BasePage } from '@app/base-page';`);
    const id = file('src/pages/reports/index.ts', source);
    // Not a Vite alias and not an installed package: for example a TypeScript `paths` entry.
    expect(() => client(source, id)).toThrow(/cannot classify class ReportPage/);
    // A configured alias that names no module.
    expect(() => client(source, id, [{ find: '@app', replacement: join(root, 'missing') }])).toThrow(/cannot classify class ReportPage/);
  });

  it('fails for a base computed at runtime or by a mixin call', () => {
    expect(() => client(`const Base = makeBase();
      export class Page1 extends Base { load() { return 'SECRET'; } }`, '/src/pages/x.ts')).toThrow(/Base is a value computed at runtime/);
    expect(() => client(`export class Page2 extends withTracking(EventTarget) { load() { return 'SECRET'; } }`, '/src/pages/x.ts'))
      .toThrow(/computed by an expression/);
    expect(() => client(`const { Base } = makeBases();
      export class Page4 extends Base { load() { return 'SECRET'; } }`, '/src/pages/x.ts')).toThrow(/Base is a value computed at runtime/);
    expect(() => client(`const Base = makeBase(); class Middle extends Base {}
      export class Page3 extends Middle { load() { return 'SECRET'; } }`, '/src/pages/x.ts')).toThrow(/Middle extends a base/);
  });

  it('allows such a class when nothing in it would be stripped', () => {
    const source = `import { BasePage } from '../../lib/missing';
      import { Client } from '@cossackframework/core';
      export class Widget extends BasePage {
        render() { return this.label(); }
        label() { return 'kept by render'; }
        get title() { return 'Widget'; }
        @Client() open() { return 'browser'; }
        handler = () => 'field';
      }`;
    expect(client(source, '/src/components/widget.ts')).toContain('kept by render');
  });

  it('does not fail the server build', () => {
    const source = subclass(`import { BasePage } from '../../lib/missing';`);
    expect(server(source, '/src/pages/reports/index.ts')).toContain('SECRET_REPORT');
  });
});

describe('framework classes written in unusual forms', () => {
  it('strips a mixin over a framework base', () => {
    expect(client(`${core}export class Live extends WithTracking(Cossack) { async secret() { return 'SECRET_MIXIN'; } }`, '/src/pages/x.ts'))
      .not.toContain('SECRET_MIXIN');
    expect(client(`${core}export class Cast extends (Cossack as any) { async secret() { return 'SECRET_CAST'; } }`, '/src/pages/x.ts'))
      .not.toContain('SECRET_CAST');
  });

  it('strips classes decorated through a re-exported or namespaced decorator', () => {
    expect(client(`import { Page } from '~/framework';
      @Page() export class Local extends BasePage { async secret() { return 'SECRET_LOCAL_DECORATOR'; } }`, '/src/pages/x.ts'))
      .not.toContain('SECRET_LOCAL_DECORATOR');
    expect(client(`import * as fw from '~/framework';
      @fw.Component() export class Spaced { async secret() { return 'SECRET_NAMESPACED'; } }`, '/src/components/x.ts'))
      .not.toContain('SECRET_NAMESPACED');
    expect(client(`${core}@(Page as any)() export class Wrapped extends Base { async secret() { return 'SECRET_WRAPPED'; } }`, '/src/pages/x.ts'))
      .not.toContain('SECRET_WRAPPED');
  });

  it('ignores a type-only decorator import', () => {
    const out = client(`import type { Page } from '~/framework';
      export class Plain { helper() { return 'CLIENT_PLAIN'; } }`, '/src/lib/plain.ts');
    expect(out).toContain('CLIENT_PLAIN');
  });
});

describe('script modules the transform does not process', () => {
  const load = (path: string) => {
    const plugin = cossackSecurityPlugin();
    (plugin.configResolved as Function)({ root: join(root, 'app'), command: 'build', logger: { info() {} }, resolve: { alias: [] } });
    return (plugin.load as Function).call({ environment: { name: 'client' } }, path);
  };

  it('fails the client build for a component in a .js application module', async () => {
    const path = file('app/src/pages/legacy.js', `import { Cossack } from '@cossackframework/core';
      export default class Legacy extends Cossack { async load() { return 'SECRET_JS'; } }`);
    await expect(load(path)).rejects.toThrow(/framework classes must be written in \.ts or \.mts modules/);
  });

  it('loads plain .js application modules and dependencies outside the project', async () => {
    await expect(load(file('app/src/lib/plain.js', 'export class Plain { run() {} }'))).resolves.toBeUndefined();
    await expect(load(file('linked/component.js', `import { Cossack } from '@cossackframework/core';
      export class Linked extends Cossack {}`))).resolves.toBeUndefined();
  });
});

describe('dev-time automatic RPC endpoint log', () => {
  const page = (methods: string) => `${core}@Page() export class Todo extends Cossack {
    render() { return html\`${methods}\`; }
    async remove() { return 1; }
    async toggle() { return 2; }
    @Server() async save() { return 3; }
  }`;
  const run = (options: Parameters<typeof cossackSecurityPlugin>[0], command: 'serve' | 'build', sources: string[]) => {
    const info = vi.fn();
    const plugin = cossackSecurityPlugin(options);
    (plugin.configResolved as Function)({ root, command, logger: { info }, resolve: { alias: [] } });
    for (const source of sources) (plugin.transform as Function).call({ environment: { name: 'ssr' } }, source, `${root}/src/pages/todo/index.ts`);
    return info;
  };
  const oneHandler = page('<button @click=${() => this.remove()}>x</button>');
  const twoHandlers = page('<button @click=${() => this.remove()}>x</button><input @change=${this.toggle}>');

  it('lists automatic endpoints per module once, and again when they change', () => {
    const info = run({ logRpcEndpoints: true }, 'serve', [oneHandler, oneHandler, twoHandlers]);
    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls[0][0]).toContain('src/pages/todo/index.ts: automatic RPC endpoints Todo.remove ');
    expect(info.mock.calls[1][0]).toContain('automatic RPC endpoints Todo.remove, Todo.toggle ');
    // Explicit @Server methods are not automatic endpoints.
    expect(info.mock.calls.flat().join('\n')).not.toContain('Todo.save');
  });

  it('is quiet in production builds, when disabled, and by default under Vitest', () => {
    expect(run({ logRpcEndpoints: true }, 'build', [twoHandlers])).not.toHaveBeenCalled();
    expect(run({ logRpcEndpoints: false }, 'serve', [twoHandlers])).not.toHaveBeenCalled();
    expect(run({}, 'serve', [twoHandlers])).not.toHaveBeenCalled();
  });
});
