import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';

export const MARKDOWN_SITE='https://markdown-release.test';

export async function writeMarkdownReleaseAcceptance(root,{failure}={}) {
  await fs.rm(path.join(root,'src/pages'),{recursive:true,force:true});
  await fs.rm(path.join(root,'src/lang'),{recursive:true,force:true});
  const write=async(file,source)=>{const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,source);};
  await write('src/markdown-processor.ts',`import {createMarkdownProcessor} from '@cossackframework/framework/markdown-processor';
    export const processMarkdown=createMarkdownProcessor<{readingMinutes:number}>({extensions:{readingMinutes:(value):value is number=>typeof value==='number'&&Number.isFinite(value)}});
  `);
  let vite=await fs.readFile(path.join(root,'vite.config.ts'),'utf8');
  vite=vite.replace('cossackSsg()',`cossackSsg({baseUrl:${JSON.stringify(MARKDOWN_SITE)}})`);
  await write('vite.config.ts',vite);
  await write('src/lang/en.json',JSON.stringify({greeting:'English catalog sentinel',typedTitle:'English typed title'}));
  await write('src/lang/fr.json',JSON.stringify({greeting:'French catalog sentinel',typedTitle:'French typed title'}));
  await write('src/bootstrap/middlewares.ts',`import {createLocaleMiddleware} from '@cossackframework/framework/locale';
    export default [createLocaleMiddleware({resolveLocale:(context)=>{const locale=context.req.path.split('/')[1];return locale==='en'||locale==='fr'?locale:undefined;}})];
  `);
  await write('src/pages/layout.ts',`import {Cossack,Page,__} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
    @Page({transport:'http'})export default class ContentLayout extends Cossack {
      head(){return {links:[{tag:'link',attributes:{rel:'canonical',href:new URL(new URL(this.isServer?this.c.req.url:globalThis.location.href).pathname,${JSON.stringify(MARKDOWN_SITE)}).href}}]};}
      render(){return html\`<aside id="localized-shell">\${__('greeting')}</aside>\${this.children}\`;}
    }
  `);
  await write('src/pages/en/article.md',`---\ntitle: English article title\ndescription: English article description\nlocale: en\ncanonical: ${MARKDOWN_SITE}/en/article\naliases:\n  - /en/docs\nreadingMinutes: 3\n---\n\n# English article body\n\n[French article](/fr/article)\n`);
  await write('src/pages/fr/article.md',`---\ntitle: French article title\ndescription: French article description\nlocale: fr\ncanonical: ${MARKDOWN_SITE}/fr/article\n---\n\n# French article body\n\n[English article](/en/article)\n`);
  const typed=`import {Cossack,Page,__,getLocale} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
    @Page({transport:'http',ssg:{generateStaticParams:async()=>[{lang:'en'},{lang:'fr'}]}})
    export default class TypedContent extends Cossack {head(){return {title:__('typedTitle'),description:__('greeting')};}render(){return html\`<main>\${__('greeting')}<a href=\${'/'+getLocale()+'/article'}>Article</a></main>\`;}}
  `;
  await write('src/pages/[lang]/typed.ts',typed);
  if(failure==='metadata')await write('src/pages/en/invalid.md','---\ntitle:\n  private: PRIVATE_MARKDOWN_METADATA_VALUE\n---\nInvalid\n');
  if(failure==='mixed')await write('src/pages/en/article.ts',`import {Cossack,Page} from '@cossackframework/core';@Page({transport:'http',ssg:true})export default class Duplicate extends Cossack {}`);
  if(failure==='parameters')await write('src/pages/[lang]/article.ts',typed);
  if(failure==='alias')await write('src/pages/en/docs.ts',`import {Cossack,Page} from '@cossackframework/core';@Page({transport:'http',ssg:true})export default class AliasCollision extends Cossack {}`);
  await write('frontmatter-contract.ts',`import {type MarkdownFrontmatter,createMarkdownProcessor} from '@cossackframework/framework/markdown-processor';
    const accepted:MarkdownFrontmatter<{readingMinutes:number}>={title:'Typed',locale:'en',aliases:['/docs'],readingMinutes:3};
    // @ts-expect-error standard title requires a string
    const badTitle:MarkdownFrontmatter={title:7};
    // @ts-expect-error aliases require string entries
    const badAlias:MarkdownFrontmatter={aliases:[false]};
    // @ts-expect-error unsupported extension must be declared explicitly
    const badExtension:MarkdownFrontmatter={readingMinutes:3};
    // @ts-expect-error explicit extension retains its declared type
    const badReading:MarkdownFrontmatter<{readingMinutes:number}>={readingMinutes:'slow'};
    createMarkdownProcessor<{readingMinutes:number}>({extensions:{readingMinutes:(value):value is number=>typeof value==='number'}});
    void accepted;void badTitle;void badAlias;void badExtension;void badReading;
  `);
}

export async function checkMarkdownReleaseOutputs(root) {
  const directory=path.join(root,'dist/client');
  for(const [locale,other] of [['en','fr'],['fr','en']]) {
    for(const kind of ['article','typed']) {
      const html=await fs.readFile(path.join(directory,locale,kind,'index.html'),'utf8');
      const title=locale==='en'?'English':'French',opposite=other==='en'?'English':'French';
      expect(html).toMatch(new RegExp(`<html\\s+lang=(?:"${locale}"|${locale}(?=[\\s>]))`));
      expect(html).toContain(`${title} ${kind==='article'?'article':'typed'} title`);
      expect(html).toContain(`${title} ${kind==='article'?'article description':'catalog sentinel'}`);
      expect(html).toContain(`${title} catalog sentinel`);
      const body=html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]??'';
      expect(body).not.toContain(`${opposite} catalog sentinel`);
      const serialized=html.match(/window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/)?.[1];
      expect(serialized,'SSG hydration must be present').toBeTruthy();
      const hydration=JSON.parse(serialized);
      expect(hydration.__cossackLang.locale).toBe(locale);
      expect(hydration.__cossackLang.messages.greeting).toBe(`${title} catalog sentinel`);
      expect(html).toMatch(new RegExp(`rel=(?:"canonical"|canonical)[^>]*href="${MARKDOWN_SITE}/${locale}/${kind}"|href="${MARKDOWN_SITE}/${locale}/${kind}"[^>]*rel=(?:"canonical"|canonical)`));
      expect(html).toContain(kind==='article'?`href="/${other}/article"`:`href="/${locale}/article"`);
    }
  }
  const alias=await fs.readFile(path.join(directory,'en/docs/index.html'),'utf8');
  expect(alias).toContain('English article title');
  const aliasCanonicals=[...alias.matchAll(/<link\b[^>]*rel=(?:"canonical"|canonical(?=[\s>]))[^>]*>/g)];
  expect(aliasCanonicals).toHaveLength(1);
  expect(aliasCanonicals[0][0]).toContain(`href="${MARKDOWN_SITE}/en/article"`);
  expect(aliasCanonicals[0][0]).not.toContain(`${MARKDOWN_SITE}/en/docs`);
  expect(alias).not.toContain('French catalog sentinel');
  const sitemap=await fs.readFile(path.join(directory,'sitemap.xml'),'utf8');
  for(const route of ['/en/article','/fr/article','/en/typed','/fr/typed'])expect(sitemap).toContain(`<loc>${MARKDOWN_SITE}${route}</loc>`);
  expect(sitemap).not.toContain(`<loc>${MARKDOWN_SITE}/en/docs</loc>`);
  expect((sitemap.match(/<loc>/g)??[]).length).toBe(4);
}
