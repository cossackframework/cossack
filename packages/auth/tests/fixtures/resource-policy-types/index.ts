// Auth's published main is this source entry. Core uses its built public entry.
import { createResourcePolicy } from '../../../src/index';
import { input, Server, type InputOf } from '../../../../core/dist/index';
interface Actor {id:string;tenant:string;}
interface Post {id:number;owner:string;tenant:string;}
const policy=createResourcePolicy<Post,Actor>()({
    read:({user,resource})=>user.tenant===resource.tenant,
    edit:({user,resource})=>user.tenant===resource.tenant && user.id===resource.owner,
});
// @ts-expect-error Unknown resource actions do not widen to string.
policy.action('publish',()=>({id:1,owner:'u1',tenant:'t1'}));
// @ts-expect-error Permission booleans retain known action names.
policy.permissions(null as any,null).then(flags=>flags.publish);
// @ts-expect-error A lookup must return the declared resource shape.
policy.action('edit',()=>({id:1}));
const schema=input.object({id:input.number({coerce:true})});
type Data=InputOf<typeof schema>;
Server({input:schema,authorize:policy.action('edit',(value:Data)=>({id:value.id,owner:'u1',tenant:'t1'}))});
// @ts-expect-error Lookup input must match the parsed action contract.
Server({input:schema,authorize:policy.action('edit',(value:{id:string})=>({id:Number(value.id),owner:'u1',tenant:'t1'}))});
