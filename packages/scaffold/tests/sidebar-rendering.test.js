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
 const page=new Function('html','component','Sidebar','DropdownMenu','Avatar','Icon','Image','__','dashboardIcon','sunIcon','moonIcon','chevronIcon','logoutIcon',code+'\nreturn page;')(html,component,Sidebar,DropdownMenu,Avatar,Icon,Image,value=>value,icon,icon,icon,icon,icon);
 // The layout shows the modules src/dashboard/access.ts resolved for the user.
 Object.assign(page,{appName:'Example',appLogo:'/logo.svg',modules,sidebarCollapsed:false,theme:'light',account:{name:'Alice',email:'alice@example.test',avatar:null},children:'Content',isActive:href=>href==='/dashboard/projects/one',onToggleSidebar:()=>{},toggleTheme:()=>{},doLogout:()=>{}});
 const output=renderToString(page.render());
 for(const part of ['id="dashboard-navigation"','aria-label="Dashboard navigation"','data-sidebar-value="dashboard"','data-sidebar-value="module:projects"','data-sidebar-value="module:projects:/dashboard/projects/one"','href="/dashboard/projects"','href="/dashboard/projects/one"'])expect(output).toContain(part);
 // The generated layout wires the built-in collapse toggle through onCollapsedChange.
 expect(output).toContain('cs-sidebar__toggle');
 expect(output).toMatch(/<details[^>]*\sopen/);
 expect(output.match(/aria-current="page"/g)).toHaveLength(1);
 page.sidebarCollapsed=true;const rail=renderToString(page.render());expect(rail).toContain('is-collapsed');expect(rail).toContain('href="/dashboard/projects/one"');
 // A group whose first child opens the group's own page lists it once, not as "Settings > Settings".
 Object.assign(page,{sidebarCollapsed:false,modules:[{id:'settings',label:'Settings',href:'/dashboard/settings/general',icon,authorization:'authenticated',children:[{label:'General',href:'/dashboard/settings/general'},{label:'Reading',href:'/dashboard/settings/reading'}]}],isActive:href=>href==='/dashboard/settings/general'});
 const grouped=renderToString(page.render());
 expect(grouped.match(/href="\/dashboard\/settings\/general"/g)).toHaveLength(1);
 expect(grouped.match(/>Settings</g)).toHaveLength(1);
 expect(grouped).toMatch(/<details[^>]*\sopen/);
});
