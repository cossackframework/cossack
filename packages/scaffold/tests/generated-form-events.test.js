import { expect, it, vi } from 'vitest';
import { transformSync } from 'esbuild';
import { renderRecipe, resolveRecipe } from '../src/index.js';

async function renderedControls(file, state) {
  const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'full-stack' }));
  const source = files.get(file).content.toString();
  const start = source.lastIndexOf('    render() {');
  expect(start).toBeGreaterThan(0);
  const method = source.slice(start, source.lastIndexOf('}'));
  const { code } = transformSync(`const page = { ${method} };`, { loader: 'ts', target: 'es2022' });
  const controls = [];
  const component = (name, props) => { controls.push({ name, props }); return ''; };
  const html = () => '';
  const names = ['Card','CardBody','CardHeader','Avatar','Button','Badge','Input','NativeSelect','Pagination','Icon','AlertDialog','Field','Textarea'];
  // The dashboard's shared bulk helpers render nothing here; only the page's own controls are counted.
  const bulk = { bulkBar: () => '', selectAllBox: () => '', selectBox: () => '' };
  const page = new Function('html','component','__','searchIcon','editIcon','deleteIcon','PAGE_SIZE', ...names, ...Object.keys(bulk), code + '\nreturn page;')(
    html,component,value=>value,{},{},{},20,...names,...Object.values(bulk),
  );
  Object.assign(page,state); page.render();
  return controls;
}

it('generated contact button uses a boolean loading count and becomes usable after settlement', async () => {
  for (const [loading, disabled] of [[0,false],[1,true],[2,true]]) {
    const controls=await renderedControls('src/pages/(public)/contact.ts', {
      form:{name:'',email:'',message:''},success:'',error:'',loading:{submitContact:loading},
      getError:()=>undefined,hasError:()=>false,handleSubmit:()=>{},
    });
    expect(controls.find(control=>control.name==='Button' && control.props.type==='submit').props.disabled).toBe(disabled);
  }
});

it('generated dashboard role change submits its native GET form through a typed listener', async () => {
  const controls=await renderedControls('src/pages/dashboard/users/index.ts', {
    users:[],allRoles:[],total:0,page:1,error:'',appliedSearch:'',appliedRoleName:'',pendingDelete:null,canAssignRoles:false,selectable:[],selected:[],bulk:'',pendingBulk:null,message:'',bulkChoices:()=>[],
    pageHref:()=>'',user:{id:'admin'},
  });
  const props=controls.find(control=>control.name==='NativeSelect').props;
  expect(props).not.toHaveProperty('onchange');
  expect(props.name).toBe('role');
  const requestSubmit=vi.fn();
  props['@change']({currentTarget:{form:{requestSubmit}}});
  expect(requestSubmit).toHaveBeenCalledOnce();
  expect(()=>props['@change']({currentTarget:{form:null}})).not.toThrow();
});
