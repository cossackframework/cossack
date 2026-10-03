// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { input } from '../src/shared/input-schema';
import { ActionValidationError } from '../src/shared/errors';
import { enforceActionInput } from '../src/shared/action-input';
import { Server } from '../src/shared/decorators';

async function fields(promise: Promise<unknown>) {
    const failure = await promise.catch(error => error);
    expect(failure).toBeInstanceOf(ActionValidationError);
    if (!(failure instanceof ActionValidationError)) throw new Error('Expected a typed validation failure.');
    return failure.fieldErrors;
}
it('infers and returns normalized input without mutating the original object', async () => {
    const schema = input.object({ title: input.string({required:true}), age: input.number({coerce:true,integer:true,min:0}),
        active: input.boolean({coerce:true}), note: input.string().optional(), tag: input.literal('post') });
    const source = {title:'Hello',age:'21',active:'false',tag:'post'};
    expect(await schema.parse(source)).toEqual({title:'Hello',age:21,active:false,tag:'post'});
    expect(source).toEqual({title:'Hello',age:'21',active:'false',tag:'post'});
});
it.each(['', ' ', 'abc', '0x10', Infinity, NaN, true, [], {}])('rejects invalid numeric coercion (%#)', async value => {
    expect(await fields(input.number({coerce:true}).parse(value))).toEqual({_: 'Expected a finite number.'});
});
it.each(['', 'maybe', 1, 0, {}, []])('rejects invalid boolean coercion rather than treating it as false (%#)', async value => {
    expect(await fields(input.boolean({coerce:true}).parse(value))).toEqual({_: 'Expected a boolean.'});
});
it('strict primitive fields reject missing/null/wrong types and validate empty string constraints', async () => {
    expect(await input.string().parse('')).toBe('');
    expect(await fields(input.string({minLength:1}).parse(''))).toEqual({_: 'Minimum length is 1 characters'});
    expect(await fields(input.string({required:true}).parse('  '))).toEqual({_: 'This field is required'});
    for (const value of [undefined,null,42,{}]) expect(await fields(input.string().parse(value))).toEqual({_: 'Expected a string.'});
    expect(await fields(input.number().parse('12'))).toEqual({_: 'Expected a finite number.'});
    expect(await fields(input.number({integer:true}).parse(Number.MAX_SAFE_INTEGER+1))).toEqual({_: 'Expected a safe integer.'});
});
it('optional and nullable are explicit; absent optional fields are omitted', async () => {
    const schema = input.object({alias:input.string().optional(), note:input.string().nullable()});
    expect(await schema.parse({note:null})).toEqual({note:null});
    expect(await fields(schema.parse({}))).toEqual({note:'Expected a string.'});
    expect(await fields(schema.parse({alias:null,note:''}))).toEqual({alias:'Expected a string.'});
    expect(await input.string().nullable().optional().parse(undefined)).toBeUndefined();
});
it('captures enum choices and rejects values outside the declared literals', async () => {
    const choices: ['draft', 'published'] = ['draft', 'published'];
    const status = input.enum(choices); choices[0] = 'published' as any;
    expect(await status.parse('draft')).toBe('draft');
    expect(await fields(status.parse('admin'))).toEqual({_: 'Unexpected value.'});
    expect(() => input.enum([] as any)).toThrow(/configuration/);
});
it('copies dates and accepts only canonical UTC strings when coercion is explicit', async () => {
    const original = new Date('2026-10-03T00:00:00.000Z');
    const parsed = await input.date().parse(original); expect(parsed).toEqual(original); expect(parsed).not.toBe(original);
    expect(await input.date({coerce:true}).parse(original.toISOString())).toEqual(original);
    for (const value of [original.toISOString(), 'invalid', null]) {
        expect(await fields(input.date().parse(value))).toEqual({_: 'Expected a valid date.'});
    }
    for (const value of ['2026-02-30T00:00:00.000Z', '2026-10-03', '2026-10-03T00:00:00Z', '2026-10-03T01:00:00.000+01:00', new Date(NaN)]) {
        expect(await fields(input.date({coerce:true}).parse(value))).toEqual({_: 'Expected a valid date.'});
    }
});
it('rejects unknown keys recursively unless the object explicitly strips them', async () => {
    const schema = input.object({profile:input.object({name:input.string()})});
    expect(await fields(schema.parse({profile:{name:'name',canEdit:true},tenant:'other'})))
        .toEqual({tenant:'Unknown field.',profile:{canEdit:'Unknown field.'}});
    const source = {name:'name',canEdit:true};
    expect(await input.object({name:input.string()},{unknownKeys:'strip'}).parse(source)).toEqual({name:'name'});
    expect(source.canEdit).toBe(true);
});
it('maps array failures to stable nested form fields and preserves valid array values', async () => {
    const schema = input.object({items:input.array(input.object({count:input.number({coerce:true,min:1})}),{minItems:1,maxItems:3})});
    expect(await fields(schema.parse({items:[{count:'0'},{count:'bad'}]}))).toEqual({items:{0:{count:'Minimum value is 1'},1:{count:'Expected a finite number.'}}});
    expect(await schema.parse({items:[{count:'2'}]})).toEqual({items:[{count:2}]});
    expect(await fields(schema.parse({items:[]}))).toEqual({items:'Array length is outside its limits.'});
});
it('rejects sparse arrays, array accessors and unexpected array properties', async () => {
    const schema = input.array(input.string().optional());
    expect(await fields(schema.parse(new Array(1)))).toEqual({0:'Expected an array item.'});
    const getter = vi.fn(()=>'secret'); const source = ['x']; Object.defineProperty(source,'0',{get:getter});
    expect(await fields(schema.parse(source))).toEqual({0:'Expected an array item.'}); expect(getter).not.toHaveBeenCalled();
    const extra = Object.assign(['x'],{permissions:true});
    expect(await fields(schema.parse(extra))).toEqual({_: 'Unexpected array properties.'});
});
it('rejects prototype keys/accessors without executing getters or polluting error prototypes', async () => {
    const schema = input.object({name:input.string()}); const getter = vi.fn(()=>{throw Error('PRIVATE');});
    const source = Object.defineProperty({},'name',{enumerable:true,get:getter});
    expect(await fields(schema.parse(source))).toEqual({_: 'Input accessors are not supported.'}); expect(getter).not.toHaveBeenCalled();
    const evil = JSON.parse('{"name":"ok","__proto__":{"polluted":true}}');
    expect(await fields(schema.parse(evil))).toEqual({_: 'Unknown field.'}); expect(({} as any).polluted).toBeUndefined();
});
it('bounds deep, cyclic, oversized and numerous invalid input', async () => {
    const leaf = input.object({name:input.string()}); const cyclic:any={}; cyclic.name=cyclic;
    expect(await fields(input.object({child:leaf}).parse({child:cyclic}))).toEqual({child:{name:'Expected a string.'}});
    const source:any={}; source.child=source;
    expect(await fields(input.object({child:input.object({})}).parse(source))).toEqual({child:'Cyclic input is not supported.'});
    expect(await fields(input.array(input.string()).parse(Array(1025).fill('x')))).toEqual({_: 'Array length is outside its limits.'});
    let node:any=input.string(), value:any='x'; for(let i=0;i<34;i++){ node=input.object({child:node}); value={child:value}; }
    expect(JSON.stringify(await fields(node.parse(value)))).toContain('validation limits');
    const bad = Object.fromEntries(Array.from({length:200},(_,i)=>['field'+i,true]));
    expect(Object.keys(await fields(input.object({}).parse(bad))).length).toBeLessThanOrEqual(128);
});
it('validates actual uploaded files and their declared size/media constraints', async () => {
    const file = new File(['data'],'a.txt',{type:'text/plain'});
    expect(await input.file({maxBytes:4,mediaTypes:['text/plain']}).parse(file)).toBe(file);
    expect(await fields(input.file({maxBytes:3}).parse(file))).toEqual({_: 'File exceeds its size limit.'});
    expect(await fields(input.file({mediaTypes:['image/png']}).parse(file))).toEqual({_: 'File media type is not allowed.'});
    expect(await fields(input.file().parse({name:'fake',size:0,type:'text/plain'}))).toEqual({_: 'Expected an uploaded file.'});
});
it('returns refinement field failures but keeps thrown/rejected/nonboolean callbacks internal', async () => {
    expect(await fields(input.object({name:input.string().refine(v=>v==='ok','Not allowed.')}).parse({name:'no'}))).toEqual({name:'Not allowed.'});
    const failure = Error('PRIVATE');
    await expect(input.string().refine(()=>{throw failure;}).parse('value')).rejects.toMatchObject({message:'[Cossack] Input refinement failed.',cause:failure});
    await expect(input.string().refine(async()=>{throw failure;}).parse('value')).rejects.toMatchObject({message:'[Cossack] Input refinement failed.',cause:failure});
    await expect(input.string().refine((()=>1) as any).parse('value')).rejects.toThrow(/boolean/);
});
it('does not start callbacks after abort and refuses aborted async refinement completion', async () => {
    const controller = new AbortController(); const check = vi.fn(async()=>true); const schema=input.string().refine(check);
    controller.abort(); await expect(schema.parse('x',{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'}); expect(check).not.toHaveBeenCalled();
    let release!:(value:boolean)=>void; const waiting=input.string().refine(()=>new Promise<boolean>(resolve=>{release=resolve;}));
    const next=new AbortController(); const result=waiting.parse('x',{signal:next.signal});
    await vi.waitFor(()=>expect(release).toBeTypeOf('function')); next.abort(); release(true);
    await expect(result).rejects.toMatchObject({name:'AbortError'});
});
it('releases cancelled refinements before an uncooperative callback settles', async () => {
    const controller = new AbortController(); let reject!: (error: Error) => void; let observed!: AbortSignal;
    const schema = input.string().refine((_value, options) => {
        observed = options.signal!; return new Promise<boolean>((_resolve, failure) => {reject=failure;});
    });
    const pending = schema.parse('x', {signal: controller.signal});
    const rejection = expect(pending).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(() => expect(reject).toBeTypeOf('function')); controller.abort(); await rejection;
    expect(observed.aborted).toBe(true);
    reject(new Error('LATE_PRIVATE_FAILURE')); await Promise.resolve(); await Promise.resolve();
});
it('snapshots shape, options and stateful regexes', async () => {
    const pattern = /^ok$/gy; const rules={pattern}; const shape={name:input.string(rules)};
    const schema=input.object(shape); (shape as any).name=input.boolean(); pattern.compile('evil');
    expect(await schema.parse({name:'ok'})).toEqual({name:'ok'}); expect(await schema.parse({name:'ok'})).toEqual({name:'ok'});
    expect(await fields(schema.parse({name:'xok'}))).toEqual({name:'Invalid format'});
    const options={unknownKeys:'reject' as 'reject'|'strip'}; const snapshot=input.object({},options); options.unknownKeys='strip';
    expect(await fields(snapshot.parse({unknown:true}))).toEqual({unknown:'Unknown field.'});
});
it.each([()=>input.array(input.string(),{maxItems:null as any}),()=>input.object({},{unknownKeys:null as any}),
    ()=>input.number({coerce:'yes' as any}),()=>input.string({typo:1} as any),()=>input.object({'_':input.string()}),
    ()=>input.file({maxBytes:-1}),()=>input.object({x:null as any})])('rejects invalid schema declarations (%#)', create => {
    expect(create).toThrow(/configuration/);
});
it('enforces typed single-argument contracts and rejects malformed decorator metadata', async () => {
    const schema=input.object({age:input.number({coerce:true})});
    class Actions { @Server({input:schema}) save(value: {age:number}) {return value;} }
    expect(await enforceActionInput(Actions,'save',[{age:'3'}])).toEqual([{age:3}]);
    expect(await fields(enforceActionInput(Actions,'save',[{age:3},'forged']))).toEqual({_: 'This action accepts one input argument.'});
    expect(await fields(enforceActionInput(Actions,'save',[{age:3,canEdit:true}]))).toEqual({canEdit:'Unknown field.'});
    for(const input of [null,false,undefined]) {
        class Invalid {save() {}}
        Server({input:input as any})(Invalid.prototype,'save', Object.getOwnPropertyDescriptor(Invalid.prototype,'save')!);
        await expect(enforceActionInput(Invalid,'save',[{}])).rejects.toThrow(/contract/);
    }
});
it('maps cancellation to the RPC contract and skips later validation callbacks', async () => {
    const controller = new AbortController(); let release!: (value:boolean) => void;
    const after = vi.fn(() => true);
    class Actions { @Server({input: input.string().refine(() => new Promise<boolean>(resolve => { release=resolve; })).refine(after)}) save(value:string) {return value;} }
    const pending = enforceActionInput(Actions, 'save', ['x'], {signal:controller.signal});
    const rejection = expect(pending).rejects.toMatchObject({code:'COSSACK_RPC_CANCELLED'});
    await vi.waitFor(() => expect(release).toBeTypeOf('function')); controller.abort(); await rejection;
    release(true); await Promise.resolve(); await Promise.resolve(); expect(after).not.toHaveBeenCalled();
});
it('rejects unmigrated rule maps without running legacy coercion or callbacks', async () => {
    const callback=vi.fn(()=>true);
    class Legacy {save(value:unknown, extra:unknown) {return [value,extra];} }
    // Simulate stale JavaScript metadata, bypassing both new TypeScript guards.
    (Server as any)({input:{age:{coerce:'number',min:1,custom:callback}}})(Legacy.prototype,'save');
    await expect(enforceActionInput(Legacy,'save',[{age:'3',unlisted:true},'extra'])).rejects.toThrow(/rule maps must migrate/);
    expect(callback).not.toHaveBeenCalled();
});
