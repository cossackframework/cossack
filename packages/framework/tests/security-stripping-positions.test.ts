import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_METHODS,
  injectAutomaticServerMethodMetadata,
  isClientSafeMethod,
  stripSsgGenerateStaticParams,
  transformCossackClass,
  transformServerResources,
} from '../src/vite-security-plugin';

/** Client transform as the plugin runs it. */
const client = (code: string) => transformCossackClass(code, '/src/pages/x/index.ts', isClientSafeMethod, BUILTIN_METHODS, true);
const server = (code: string) => injectAutomaticServerMethodMetadata(code, '/src/pages/x/index.ts', isClientSafeMethod, BUILTIN_METHODS);
const imports = `import { Cossack, Page, Server, Client } from '@cossackframework/core';\n`;

describe('framework classes are stripped wherever they are written', () => {
  it('strips a class expression assigned to a variable', () => {
    const out = client(`${imports}export const Page1 = class extends Cossack {
      @Server() async secret() { return 'SECRET_A'; }
      render() { return ''; }
    };`);
    expect(out).not.toContain('SECRET_A');
  });

  it('strips a class expression passed to a wrapper call', () => {
    const out = client(`${imports}export default wrap(class Wrapped extends Cossack {
      @Server() async secret() { return 'SECRET_B'; }
      render() { return ''; }
    });`);
    expect(out).not.toContain('SECRET_B');
  });

  it('strips a class declared inside a function body', () => {
    const out = client(`${imports}export function make() {
      class Inner extends Cossack {
        @Server() async secret() { return 'SECRET_C'; }
        render() { return ''; }
      }
      return Inner;
    }`);
    expect(out).not.toContain('SECRET_C');
  });

  it('follows inheritance from a class expression bound to a name', () => {
    const out = client(`${imports}const Base = class extends Cossack {};
      export class Child extends Base {
        async loadUsers() { return 'SECRET_F'; }
        render() { return ''; }
      }`);
    expect(out).not.toContain('SECRET_F');
  });

  it('allows a component subclass inside a server-only class on the server build', () => {
    const source = `${imports}@Page() export class Live extends Cossack { @Server() async count() { return 1; } render() { return ''; } }
      export class FixtureDO extends CossackDurableObject {
        async getComponentRegistry() { class RegisteredLive extends Live { constructor() { super(); } } return new Map([['/live.ts', RegisteredLive]]); }
      }`;
    expect(() => server(source)).not.toThrow();
  });

  it('refuses a framework class nested inside another class member', () => {
    expect(() => client(`${imports}@Page() export class Outer extends Cossack {
      @Client() build() {
        return class Inner extends Cossack { @Server() async secret() { return 'SECRET_G'; } };
      }
      render() { return ''; }
    }`)).toThrow(/declared inside another class/);
  });
});

describe('event handler closures are RPC boundaries', () => {
  const source = `${imports}@Page() export class List extends Cossack {
    async remove(id: string) { return fetch('https://api', { headers: { Authorization: 'SECRET_M' } }); }
    render() { return html\`<button @click=\${() => this.remove('1')}>x</button>\`; }
  }`;

  it('does not keep an undecorated method called from an inline arrow handler', () => {
    expect(client(source)).not.toContain('SECRET_M');
  });

  it('registers that method as an automatic RPC endpoint on both builds', () => {
    expect(client(source)).toContain('"remove"');
    expect(server(source)).toContain('"remove"');
  });

  it('treats object handler properties the same way', () => {
    const out = client(`${imports}@Page() export class Dialogs extends Cossack {
      async destroy() { return 'SECRET_N'; }
      render() { return component(Dialog, { onAction: () => this.destroy() }); }
    }`);
    expect(out).not.toContain('SECRET_N');
  });

  it('still keeps helpers that render() calls directly, including inside map callbacks', () => {
    const out = client(`${imports}@Page() export class Rows extends Cossack {
      renderRow(row: string) { return 'ROW_MARKUP_' + row; }
      render() { return html\`\${this.rows.map(row => this.renderRow(row))}\`; }
    }`);
    expect(out).toContain('ROW_MARKUP_');
  });

  it('keeps a helper passed to a library as an onX callback outside render()', () => {
    const out = client(`${imports}@Page() export class Chart extends Cossack {
      showTooltip() { return 'TOOLTIP_BODY'; }
      onMount() { createChart({ onHover: () => this.showTooltip() }); }
      render() { return ''; }
    }`);
    expect(out).toContain('TOOLTIP_BODY');
  });

  it('keeps a handler-called method that is also reachable from client code', () => {
    const out = client(`${imports}@Page() export class Toggle extends Cossack {
      flip() { this.open = !this.open; return 'FLIP_BODY'; }
      onMount() { this.flip(); }
      render() { return html\`<button @click=\${() => this.flip()}>t</button>\`; }
    }`);
    expect(out).toContain('FLIP_BODY');
  });
});

describe('aliased page decorators', () => {
  it('strips a class marked only by an aliased @Page', () => {
    const out = client(`import { Page as Route } from '@cossackframework/core';
      class Base {}
      @Route() export default class Report extends Base {
        async loadSecrets() { return 'SECRET_ALIASED_PAGE'; }
        render() { return ''; }
      }`);
    expect(out).not.toContain('SECRET_ALIASED_PAGE');
  });

  it('strips a class marked by a namespaced @Component', () => {
    const out = client(`import * as core from '@cossackframework/core';
      @core.Component() export class Card { async loadSecrets() { return 'SECRET_NAMESPACED_COMPONENT'; } }`);
    expect(out).not.toContain('SECRET_NAMESPACED_COMPONENT');
  });
});

describe('import type', () => {
  it('erases nothing the client needs and keeps no server-only runtime import', () => {
    const out = client(`import type { Generated } from '@cossackframework/database';
      import { type User, Cossack, Page, Server } from '@cossackframework/core';
      @Page() export class Rows extends Cossack {
        owner?: User;
        rows: Generated<number>[] = [];
        @Server() async load(): Promise<Generated<number>[]> { return query('SECRET_TYPED_SQL'); }
        render() { return ''; }
      }`);
    expect(out).not.toContain('SECRET_TYPED_SQL');
    expect(out).not.toMatch(/^import \{[^}]*\} from '@cossackframework\/database'/m);
    expect(out).toContain("import type { Generated } from '@cossackframework/database'");
  });

  it('does not treat type-only Server or Page names as decorators', () => {
    const out = client(`import type { Page, Server } from './types';
      export class Plain { helper() { return 'CLIENT_HELPER'; } }`);
    expect(out).toContain('CLIENT_HELPER');
  });
});

describe('private members', () => {
  it('does not keep a private server method because a public method shares its name', () => {
    const out = client(`${imports}@Page() export class Loader extends Cossack {
      @Client() async load() { return 'PUBLIC_LOAD'; }
      async #load() { return 'SECRET_PRIVATE_C'; }
      render() { return ''; }
    }`);
    expect(out).toContain('PUBLIC_LOAD');
    expect(out).not.toContain('SECRET_PRIVATE_C');
  });

  it('keeps a private helper called from client code', () => {
    const out = client(`${imports}@Page() export class Widget extends Cossack {
      onMount() { this.#setup(); }
      #setup() { return 'PRIVATE_SETUP_BODY'; }
      render() { return ''; }
    }`);
    expect(out).toContain('PRIVATE_SETUP_BODY');
  });

  it('never registers a private member for RPC', () => {
    const out = client(`${imports}@Page() export class Secret extends Cossack {
      @Server() async #hidden() { return 'SECRET_H'; }
      @Server() async visible() { return 1; }
      render() { return ''; }
    }`);
    expect(out).not.toContain('SECRET_H');
    expect(out).toContain('["visible"]');
  });
});

describe('generateStaticParams stripping', () => {
  const loader = `async () => fetch('https://cms', { headers: { Authorization: 'SECRET_SSG' } })`;

  it('strips it under an aliased Page decorator', () => {
    const out = stripSsgGenerateStaticParams(`import { Page as P, Cossack } from '@cossackframework/core';
      @P({ ssg: { generateStaticParams: ${loader} } }) export default class A extends Cossack {}`);
    expect(out).not.toContain('SECRET_SSG');
  });

  it('strips it under a namespaced Page decorator', () => {
    const out = stripSsgGenerateStaticParams(`import * as core from '@cossackframework/core';
      @core.Page({ ssg: { generateStaticParams: ${loader} } }) export default class A extends core.Cossack {}`);
    expect(out).not.toContain('SECRET_SSG');
  });

  it('strips it when the options object is a module constant', () => {
    const out = stripSsgGenerateStaticParams(`import { Page, Cossack } from '@cossackframework/core';
      const options = { ssg: { generateStaticParams: ${loader} } };
      @Page(options) export default class A extends Cossack {}`);
    expect(out).not.toContain('SECRET_SSG');
  });

  it('removes a module-level loader referenced only by generateStaticParams', () => {
    const out = client(`${imports}const loadParams = async () => [{ id: 'SECRET_O' }];
      @Page({ ssg: { generateStaticParams: loadParams } }) export default class A extends Cossack {
        render() { return ''; }
      }`);
    expect(out).not.toContain('SECRET_O');
  });

  it.each([
    ['a method', `generateStaticParams() { return fetch('https://cms', { headers: { Authorization: 'SECRET_SSG' } }); }`],
    ['an async method', `async generateStaticParams() { return [{ id: 'SECRET_SSG' }]; }`],
    ['a quoted key', `'generateStaticParams': ${loader}`],
  ])('strips it when written as %s', (_label, property) => {
    const out = client(`${imports}@Page({ ssg: { ${property} } }) export default class A extends Cossack { render() { return ''; } }`);
    expect(out).not.toContain('SECRET_SSG');
    expect(out).toMatch(/generateStaticParams'?: async \(\) => \[\]/);
  });

  it('strips a shorthand property and removes its loader', () => {
    const out = client(`${imports}const generateStaticParams = ${loader};
      @Page({ ssg: { generateStaticParams } }) export default class A extends Cossack { render() { return ''; } }`);
    expect(out).not.toContain('SECRET_SSG');
  });

  it('follows ssg options stored in, or spread from, module constants', () => {
    const named = client(`${imports}const ssg = { enabled: true, generateStaticParams: ${loader} };
      @Page({ transport: 'http', ssg }) export default class A extends Cossack { render() { return ''; } }`);
    expect(named).not.toContain('SECRET_SSG');
    const spread = client(`${imports}const shared = { ssg: { generateStaticParams: ${loader} } };
      @Page({ ...shared, transport: 'http' }) export default class A extends Cossack { render() { return ''; } }`);
    expect(spread).not.toContain('SECRET_SSG');
  });

  it.each([
    ['options built by a function', `const options = () => ({ ssg: { generateStaticParams: ${loader} } });
      @Page(options()) export default class A extends Cossack { render() { return ''; } }`],
    ['options exported for another module', `export const pageOptions = { ssg: { generateStaticParams: ${loader} } };`],
    ['a later assignment', `const options: any = { ssg: {} };
      options.ssg.generateStaticParams = ${loader};
      @Page(options) export default class A extends Cossack { render() { return ''; } }`],
  ])('fails the client build for %s instead of shipping the loader', (_label, source) => {
    expect(() => client(`${imports}${source}`)).toThrow(/generateStaticParams is not inside the ssg options/);
  });

  it('ignores type declarations and destructuring', () => {
    expect(() => client(`${imports}interface Ssg { generateStaticParams?: () => Promise<unknown[]> }
      declare const external: Ssg;
      const { generateStaticParams } = external;
      @Page() export default class A extends Cossack { render() { return ''; } }`)).not.toThrow();
  });

  it('keeps a loader that client code still uses', () => {
    const out = client(`${imports}const loadParams = async () => [{ id: 'SHARED_PARAMS' }];
      @Page({ ssg: { generateStaticParams: loadParams } }) export default class A extends Cossack {
        @Client() params() { return loadParams(); }
        render() { return ''; }
      }`);
    expect(out).toContain('SHARED_PARAMS');
  });
});

describe('server$ placement', () => {
  const coreImport = `import { Cossack, Page, server$ } from '@cossackframework/core';\n`;

  it('rejects a module-level server$ instead of shipping its loader', () => {
    expect(() => transformServerResources(`${coreImport}const users = server$(async () => 'SECRET_G', { initial: [] });
      @Page() export default class A extends Cossack { render() { return ''; } }`, 'a.ts'))
      .toThrow(/only valid as a class-field initializer/);
  });

  it('rejects server$ in a class that is not a component', () => {
    expect(() => transformServerResources(`${coreImport}class Helper { data = server$(async () => 'SECRET_H', { initial: null }); }`, 'a.ts'))
      .toThrow(/only valid as a class-field initializer/);
  });

  it('compiles server$ on a class expression component', () => {
    const out = transformServerResources(`${coreImport}export const P = class extends Cossack {
      users = server$(async () => 'LOADER', { initial: [] });
    };`, 'a.ts');
    expect(out).toContain('__cossack_server_resource_');
  });
});
