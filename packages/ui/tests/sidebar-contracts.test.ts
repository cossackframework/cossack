import { expect, it } from 'vitest';
import { component, renderToString, html, ifDefined } from '@cossackframework/renderer';
import { Sidebar, type SidebarProps, type SidebarItem } from '../src/components/Sidebar';
const items: readonly SidebarItem[]=[{value:'home',label:'Home',href:'/',active:true},{value:'group',label:'Projects',href:'/projects',children:[{value:'project',label:'Current project',href:'/projects/one',active:true}]}];
const props:SidebarProps={id:'nav',label:'Application',items};
it('renders named navigation, stable groups, current links and independent native props',()=>{
 const out=renderToString(component(Sidebar,{...props,'data-root':'aside',navProps:{'data-nav':'links'},onCollapsedChange:()=>{},style:ifDefined('height:200px;')}));
 for(const attr of ['<aside','<nav','aria-label="Application"','data-root="aside"','data-nav="links"','aria-current="page"','aria-controls="nav-group-group"','id="nav-group-group"','href="/projects"','href="/projects/one"','height:200px;'])expect(out).toContain(attr);
 expect(out).toMatch(/<details[^>]*\sopen/);expect(out).toContain('<summary');expect(out).not.toContain('role="menu"');
 expect(out).not.toMatch(/\s(?:items|collapsed|collapsible|navProps|onCollapsedChange)=/);
});
it('keeps group destinations and child links in the icon rail with readable names',()=>{
 const out=renderToString(component(Sidebar,{...props,collapsed:true}));
 expect(out).toContain('width:72px');expect(out).toContain('is-collapsed');expect(out).toContain('href="/projects/one"');expect(out).toContain('Current project');expect(out).toContain('sr-only');expect(out).not.toContain('cs-sidebar__toggle');
});
it.each([false,true])('propagates icon rail state to the slotted footer (collapsed=%s)',collapsed=>{
 const out=renderToString(component(Sidebar,{...props,collapsed,footer:html`<span class="group-[.is-collapsed]:hidden">Account details</span>`}));
 const footer=out.match(/class="([^"]*cs-sidebar__footer[^"]*)"/)?.[1];
 expect(footer).toBeDefined();expect(footer!.split(/\s+/).includes('is-collapsed')).toBe(collapsed);
 expect(out).toContain('Account details');
});
it('renders offcanvas content hidden and inert instead of merely translating it',()=>{
 const out=renderToString(component(Sidebar,{...props,collapsible:'offcanvas',restoreFocusTo:'opener',collapsed:true}));
 expect(out).toContain('display:none!important');expect(out).toMatch(/\sinert(?:\s|=|>)/);expect(out).toMatch(/\shidden(?:\s|=|>)/);expect(out).toContain('aria-hidden="true"');
});
it('keeps nested active ancestors open at their initial render',()=>{
 const tree:SidebarItem[]=[{value:'a',label:'A',children:[{value:'b',label:'B',children:[{value:'c',label:'C',href:'/c',active:true}]}]}];
 const out=renderToString(component(Sidebar,{...props,items:tree}));expect(out.match(/<details[^>]*\sopen/g)).toHaveLength(2);
});
it.each([{id:''},{label:' '},{collapsed:'false'},{collapsible:'invalid'},{collapsible:'offcanvas'},{collapsible:'offcanvas',restoreFocusTo:'nav'},{width:''},{expandLabel:''},{onCollapsedChange:4},{items:null},{items:[{value:'x',label:'X'}]},{items:[{value:'x',label:'',href:'/'}]},{items:[{value:'x',label:'X',href:''}]},{items:[{value:'x',label:'X',children:[]}]},{items:[{value:'x',label:'X',children:null}]}])('rejects invalid Sidebar contracts %j',patch=>{
 expect(()=>renderToString(component(Sidebar,{...props,...patch} as any))).toThrow('Sidebar');
});
it('rejects duplicate identities and cycles before rendering',()=>{
 expect(()=>renderToString(component(Sidebar,{...props,items:[items[0],items[0]]}))).toThrow('globally unique');
 const cycle:any={value:'cycle',label:'Cycle',children:[]};cycle.children.push(cycle);
 expect(()=>renderToString(component(Sidebar,{...props,items:[cycle]}))).toThrow('globally unique');
});
it('rejects children rather than silently dropping content',()=>{
 expect(()=>renderToString(component(Sidebar,props,html`<p>Lost content</p>`))).toThrow('not children');
});

it('follows active descendants until a group has an explicit user choice',()=>{
 const instance=new Sidebar();instance.props={...props,items:[{value:'group',label:'Group',children:[{value:'child',label:'Child',href:'/child'}]}]};
 expect(renderToString(instance.render())).not.toMatch(/<details[^>]*\sopen/);
 instance.props={...props,items:[{value:'group',label:'Group',children:[{value:'child',label:'Child',href:'/child',active:true}]}]};
 expect(renderToString(instance.render())).toMatch(/<details[^>]*\sopen/);
});
