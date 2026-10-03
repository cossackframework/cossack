import { input, Server, createTypedDecorators, type InputOf, type RawInputOf } from '@cossackframework/core';
const schema = input.object({
    count: input.number({coerce:true,integer:true}),
    enabled: input.boolean({coerce:true}),
    note: input.string().optional(),
    status: input.enum(['draft','published']),
    profile: input.object({email:input.string({email:true})}),
    attachments:input.array(input.file()),
    publishedAt:input.date({coerce:true}).nullable(),
});
type Data=InputOf<typeof schema>;
const output:Data={count:2,enabled:false,status:'draft',profile:{email:'a@b.test'},attachments:[],publishedAt:null};
const raw:RawInputOf<typeof schema>={count:'2',enabled:'false',status:'published',profile:{email:'a@b.test'},attachments:[],publishedAt:'2026-10-03T00:00:00.000Z'};
void raw; void output;
// @ts-expect-error Coerced server input is numeric.
const wrongCount:Data={...output,count:'2'};
// @ts-expect-error Unknown schema action/status is rejected.
const wrongStatus:Data={...output,status:'admin'};
// @ts-expect-error Missing required nested fields are rejected.
const wrongProfile:Data={...output,profile:{}};
// @ts-expect-error Unknown input fields are rejected.
const wrongField:Data={...output,canEdit:true};
// @ts-expect-error Optional is distinct from nullable.
const wrongOptional:Data={...output,note:null};
const strictNumber=input.number();
// @ts-expect-error Noncoercing numeric raw input remains numeric.
const wrongRaw:RawInputOf<typeof strictNumber>='3';
class Actions {
    @Server({input:schema})
    async save(value:Data):Promise<number> {return value.count;}
    // @ts-expect-error Method input must match the schema's output.
    @Server({input:schema})
    wrong(value:{count:string}) {return value.count;}
    // @ts-expect-error Typed input schema describes one argument.
    @Server({input:schema})
    extra(value:Data, extra:string) {return extra;}
}
const native:Promise<number>=new Actions().save(output);
void native;
class ProtectedActions {
    @Server({input:schema,authorize:(value,{context,signal})=>{
        const count:number=value.count; const aborted:boolean=signal.aborted;
        void context;void count;void aborted;
        // @ts-expect-error Authorizer sees parsed fields, never raw strings.
        value.count.toUpperCase();
        return true;
    }})
    save(value:Data){return value.count;}
    // @ts-expect-error A differently typed authorizer cannot escape via the legacy-map overload.
    @Server({input:schema,authorize:(value:{count:string})=>true})
    wrong(value:Data){return value.count;}
}
void ProtectedActions;
const channel=createTypedDecorators<{Channels:'team'}>();
class ChannelActions {
    @channel.Server({channel:'team',input:schema,authorize:value=>value.count>0})
    save(value:Data){return value.count;}
    // @ts-expect-error Channel factories preserve schema parameter validation.
    @channel.Server({input:schema}) wrong(value:{count:string}){return value.count;}
    // @ts-expect-error Channel factories preserve parsed authorizer input types.
    @channel.Server({input:schema,authorize:(value:{count:string})=>true}) invalidGuard(value:Data){return value.count;}
    // @ts-expect-error Unknown channel names remain invalid.
    @channel.Server({channel:'private',input:schema}) invalidChannel(value:Data){return value.count;}
}
void ChannelActions;
