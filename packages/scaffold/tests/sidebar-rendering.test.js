import { expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import { renderRecipe, resolveRecipe } from '../src/index.js';
import { html, component, renderToString } from '../../renderer/dist/index.js';
import { Sidebar, DropdownMenu, Avatar, Icon } from '../../ui/dist/index.js';
import { Image } from '../../core/dist/index.js';

it('renders the generated dashboard with named, stable sidebar items and group destinations', async () => {
 const files=await renderRecipe(resolveRecipe({adapter:'node',preset:'full-stack'}));
 const source=files.get('src/pages/dashboard/layout.ts').content.toString();
 const start=source.lastIndexOf('    render(): TemplateResult {');expect(start).toBeGreaterThan(0);
 // Execute the generated layout with real renderer/UI; module data, identity and
 // service callbacks are fixture inputs, not an authentication/runtime smoke test.
 const method=source.slice(start,source.lastIndexOf('}'));
 const {code}=transformSync(`const page = { ${method} };`,{loader:'ts',target:'es2022'});
 const icon={line:'<path d="M1 1h4v4H1z" />'};
 const modules=[{id:'projects',label:'Projects',href:'/dashboard/projects',icon,authorization:'authenticated',children:[{label:'Project one',href:'/dashboard/projects/one'}]}];
 const page=new Function('html','component','Sidebar','DropdownMenu','Avatar','Icon','Image','__','dashboardModules','dashboardIcon','sunIcon','moonIcon','chevronIcon','logoutIcon',code+'\nreturn page;')(html,component,Sidebar,DropdownMenu,Avatar,Icon,Image,value=>value,modules,icon,icon,icon,icon,icon);
 Object.assign(page,{appName:'Example',isAdmin:false,sidebarCollapsed:false,theme:'light',account:{name:'Alice',email:'alice@example.test',avatar:null},children:'Content',isActive:href=>href==='/dashboard/projects/one',onToggleSidebar:()=>{},toggleTheme:()=>{},doLogout:()=>{}});
 const output=renderToString(page.render());
 for(const part of ['id="dashboard-navigation"','aria-label="Dashboard navigation"','data-sidebar-value="dashboard"','data-sidebar-value="module:projects"','data-sidebar-value="module:projects:/dashboard/projects/one"','href="/dashboard/projects"','href="/dashboard/projects/one"'])expect(output).toContain(part);
 expect(output).toMatch(/<details[^>]*\sopen/);
 expect(output.match(/aria-current="page"/g)).toHaveLength(1);
 page.sidebarCollapsed=true;const rail=renderToString(page.render());expect(rail).toContain('is-collapsed');expect(rail).toContain('href="/dashboard/projects/one"');
});
