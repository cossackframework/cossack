import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const template = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../create-cossack-app/template');
const read = (relative) => fs.readFileSync(path.join(template, relative), 'utf8');

describe('create-cossack-app starter examples', () => {
  it('requires the auth release that exports createAuthorizer', () => {
    const packageJson = JSON.parse(read('package.json'));
    expect(packageJson.dependencies['@cossackframework/auth']).toBe('^0.7.1');
  });

  it('uses configuration-backed branding in every application layout', () => {
    for (const file of ['src/pages/(public)/layout.ts', 'src/pages/auth/layout.ts', 'src/pages/dashboard/layout.ts']) {
      const source = read(file);
      expect(source).toContain("server$(() => config('app.name'), { initial: 'My App' })");
      expect(source).not.toMatch(/>My App</);
    }
  });

  it('ships the SSE chat, blog, contact form, and public navigation', () => {
    const home = read('src/pages/(public)/index.ts');
    expect(home).toContain("@Page({ transport: 'sse', scope: () => 'home-chat-demo' })");
    expect(home).toContain('async *sendMessage');
    expect(home).toContain("from '../../components/Chat'");
    const chat = read('src/components/Chat.ts');
    expect(chat).toContain('interface ChatProps');
    expect(chat).not.toContain('[key: string]: unknown');
    expect(chat).toContain("role: 'user' | 'assistant'");
    expect(chat).toContain("from '@cossackframework/ui'");
    expect(chat).toContain("from '@cossackframework/solar-icons/arrow-up'");
    expect(chat).toContain('component(MessageScroller');
    expect(chat).toContain("size: 'icon'");
    expect(home).toContain("@ClientState() inputValue = 'What is Cossack framework?'");
    expect(home).toContain('A full-stack TypeScript framework for building edge first');
    expect(home).toContain('const chunks = [');
    expect(home).not.toContain('setTimeout(resolve, 120)');

    const blog = read('src/pages/(public)/blog/index.ts');
    expect(blog).toContain("description: 'Starter posts");
    expect(blog).toContain("href: '/blog/hello-world'");
    const markdown = read('src/pages/(public)/blog/hello-world.md');
    expect(markdown).toContain('title: Hello, world!');
    expect(markdown).toContain('description: Meet your new Cossack application');
    const blogLayout = read('src/pages/(public)/blog/layout.ts');
    expect(blogLayout).toContain('max-w-3xl px-4');
    expect(blogLayout).toContain('${this.children}');
    expect(blogLayout).toContain("import { Breadcrumb } from '@cossackframework/ui'");
    expect(blogLayout).toContain('component(Breadcrumb');
    expect(blogLayout).toContain("{ label: __('Blog'), href: postTitle ? '/blog' : undefined }");
    expect(blogLayout).toContain('const breadcrumb = breadcrumbFor(this.c.req.path)');
    expect(blogLayout).toContain('items: breadcrumb.items');
    expect(blogLayout).not.toContain('onNavigateComplete(pathname: string)');
    expect(blogLayout).not.toContain("@OnDocument('cossack:ready')");
    expect(blogLayout).toContain("pathname.replace(/\\/+$/, '')");
    expect(blogLayout).not.toContain('.at(-1)!');

    const contact = read('src/pages/(public)/contact.ts');
    expect(contact).toContain('interface ContactPayload');
    expect(contact).toContain('@ClientStore()');
    expect(contact).toContain('@Validate({');
    expect(contact).toContain('storeRules<ContactPayload>');
    expect(contact).toContain('await this.validateAll()');
    expect(contact).toContain("this.validateProperty(`form.${field}`");
    expect(contact).toContain('@Server()');
    expect(contact).toContain('this.loading.submitContact');
    expect(contact).toContain('await validateObject(payload, contactRules)');
    expect(contact).toContain('this.success =');

    const nav = read('src/pages/(public)/layout.ts');
    expect(nav).toContain("href: '/blog'");
    expect(nav).toContain("href: '/contact'");
  });
});
