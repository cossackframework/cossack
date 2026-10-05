import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeRpcDisconnectAcceptance(root) {
  const write = async (name, source) => { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, source); };
  await write('src/disconnect-audit.ts', `
export const records=new Map<string,any>();
export function record(key:string){let entry=records.get(key);if(!entry){entry={starts:0,mutations:0,nativeAborts:0,actionAborts:0,settled:0,timeouts:0,pageDisposed:0,serviceDisposed:0,middlewareDisposed:0,cleanupContext:[]};records.set(key,entry);}return entry;}
export async function action(key:string,mode:string,signal:AbortSignal){const entry=record(key);entry.starts++;
if(mode==='fast'){entry.mutations++;entry.settled++;return 'saved';}
await new Promise<void>(resolve=>{let finished=false;const finish=(aborted:boolean)=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abortedHandler);if(aborted)entry.actionAborts++;else entry.timeouts++;resolve();};const abortedHandler=()=>finish(true);const timer=setTimeout(()=>finish(false),5000);signal.addEventListener('abort',abortedHandler,{once:true});if(signal.aborted)finish(true);});
entry.settled++;return signal.aborted?'cancelled':'timed-out';}
`);
  await write('src/bootstrap/middlewares.ts', `import {record} from '../disconnect-audit';
export default [async(c:any,next:any)=>{const key=c.req.header('X-Disconnect-Case');if(!key)return next();const entry=record(key);const signal=c.req.raw.signal;const aborted=()=>{entry.nativeAborts++;};signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();try{await next();}finally{signal.removeEventListener('abort',aborted);entry.middlewareDisposed++;}}];`);
  await write('src/services/DisconnectService.ts', `import {CossackService,Service,Server,getRequestContext} from '@cossackframework/core';import {record,action} from '../disconnect-audit';
@Service()export class DisconnectService extends CossackService{
@Server()async hold(key:string,mode='hold'){return action(key,mode,getRequestContext()!.req.raw.signal);}
onDispose(){const c=getRequestContext();const key=c?.req.header('X-Disconnect-Case');if(key){record(key).serviceDisposed++;record(key).cleanupContext.push({kind:'service',key,path:c!.req.path,aborted:c!.req.raw.signal.aborted});}}
}`);
  await write('src/pages/disconnect/layout.ts', `import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';import {DisconnectService} from '../../services/DisconnectService';
@Page({services:[DisconnectService]})export default class DisconnectLayout extends Cossack{render(){return html\`\${this.children}\`;}}`);
  for (const transport of ['http', 'sse']) await write(`src/pages/disconnect/${transport}/index.ts`, `import {Cossack,Page,Server,Inject,getRequestContext} from '@cossackframework/core';import {html} from '@cossackframework/renderer';import {DisconnectService} from '../../../services/DisconnectService';import {record,action} from '../../../disconnect-audit';
@Page({transport:'${transport}'})export default class DisconnectPage extends Cossack{
@Inject(DisconnectService)service!:DisconnectService;private key='';
@Server()async hold(key:string,mode='hold'){this.key=key;return action(key,mode,getRequestContext()!.req.raw.signal);}
onCleanup(){if(typeof window==='undefined'&&this.key){const c=getRequestContext();record(this.key).pageDisposed++;record(this.key).cleanupContext.push({kind:'page',key:c?.req.header('X-Disconnect-Case'),path:c?.req.path,aborted:c?.req.raw.signal.aborted});}}
render(){return html\`<main>Disconnect acceptance</main>\`;}}`);
  await write('src/pages/api/disconnect-audit.ts', `import {records} from '../../disconnect-audit';export const GET=(c:any)=>c.json(records.get(c.req.query('key'))??null);`);
}
