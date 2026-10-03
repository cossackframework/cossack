import { expect, it } from 'vitest';
import { transformWithOxc } from 'vite';
import { transformCossackClass, inspectCompilerMethods, isClientSafeMethod, stripClientServerOnlyImports } from '../src/vite-security-plugin';

const transform = (source: string) => stripClientServerOnlyImports(
    transformCossackClass(source, '/src/policy.ts', isClientSafeMethod, new Set(['render']), false), '/src/policy.ts');
const policy = `import {createResourcePolicy} from '@cossackframework/auth';
const token = 'PRIVATE_POLICY_TOKEN';
function lookup(value: {id:number}) { return {id:value.id, owner:token}; }
const postPolicy = createResourcePolicy<{id:number;owner:string},{id:string}>()({edit:({user,resource})=>user.id===resource.owner});`;

it.each([
    ['import {Server, Page} from "@cossackframework/core";', '', 'Server'],
    ['import {createTypedDecorators as typed, Page} from "@cossackframework/core";', 'const channel = typed<{count:number}>();', 'channel.Server'],
    ['import {createTypedDecorators, Page} from "@cossackframework/core";', 'const {Server: ChannelServer, State} = createTypedDecorators<{count:number}>();', 'ChannelServer'],
    ['import * as Core from "@cossackframework/core"; import {Page} from "@cossackframework/core";', 'const channel = Core.createTypedDecorators<{count:number}>();', 'channel.Server'],
    ['import {createTypedDecorators, Page} from "@cossackframework/core";', 'const ChannelServer = createTypedDecorators<{count:number}>().Server;', 'ChannelServer'],
])('strips private policies through decorator aliases (%#)', async (imports, declaration, decorator) => {
    const source = `${imports}\n${policy}\n${declaration}\n@Page() class Demo {
      @${decorator}({authorize:postPolicy.action('edit',lookup)}) async *save(value:{id:number}):AsyncGenerator<number,number,unknown>{yield value.id;return value.id;}
      render(){return 'public';}
    }`;
    const client = transform(source);
    expect(client).not.toContain('PRIVATE_POLICY_TOKEN');
    expect(client).not.toContain('@cossackframework/auth');
    expect(client).not.toContain('postPolicy');
    expect(client).toContain("__cossack_proxies?.get('save')");
    expect(inspectCompilerMethods(source, '/src/policy.ts').classes[0].methods.find(method=>method.name==='save')).toMatchObject({clientBody:'stripped',rpc:'explicit'});
    const emitted = await transformWithOxc(client, 'policy.ts', { target:'es2022' });
    expect(emitted.code).not.toContain('PRIVATE_POLICY_TOKEN');
});

it('removes private policy dependencies used solely by server read loaders', () => {
    const client = transform(`import {Page} from '@cossackframework/core';\n${policy}
      @Page() class Demo { async init(){await postPolicy.authorize(this.c,'edit',lookup({id:1}));} render(){return 'public';} }`);
    expect(client).not.toContain('PRIVATE_POLICY_TOKEN'); expect(client).not.toContain('postPolicy');
    expect(client).not.toContain('@cossackframework/auth');
});

it('preserves a helper shared between a stripped action and client render', () => {
    const client = transform(`import {Page,Server} from '@cossackframework/core';
      function label(value:number){return 'public-'+value;}
      @Page() class Demo { @Server() save(value:number){return label(value);} render(){return label(1);} }`);
    expect(client).toContain('function label'); expect(client).toContain('return label(1)');
});

it.each(['export const gate=()=>true;', 'const gate=()=>true; export {gate};', 'const gate=()=>true;'])('rejects client-reachable policy metadata (%#)', declaration => {
    expect(()=>transform(`import {Page,Server} from '@cossackframework/core'; ${declaration}
      @Page() class Demo { @Server({authorize:gate}) save(){} render(){return gate;} }`)).toThrow(/Server input binding/);
});
it('rejects a foreign policy module kept alive by client imports', () => {
    expect(()=>transform(`import {Page,Server} from '@cossackframework/core';
      import {gate, label} from './private-policy';
      @Page() class Demo { @Server({authorize:gate}) save(){} render(){return label;} }`)).toThrow(/Server input module/);
});
