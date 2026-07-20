import { describe, expect, it } from 'vitest';
import * as catalog from '../src/templates.js';
import {
  authModuleTemplate, authMiddlewareTemplate, loginPageTemplate,
} from '../src/templates/auth.js';
import { loadStub } from '../src/templates/load-stub.js';

describe('template catalog', () => {
  it('keeps representative compatibility exports', () => {
    for (const name of ['pageTemplate', 'authModuleTemplate', 'userModelTemplate', 'langJsonTemplate', 'UI_COMPONENTS']) {
      expect(catalog[name]).toBeDefined();
    }
    expect(catalog.oauthImports).toBeUndefined();
  });

  it('loads stubs and substitutes placeholders', () => {
    expect(loadStub('component.ts.stub', { className: 'Example', propsName: 'ExampleProps' }))
      .toContain('class Example');
  });

  it('generates auth with zero, one, and multiple OAuth providers', () => {
    const plain = authModuleTemplate({ loginPath: '/auth/login' });
    expect(plain).not.toContain('createOAuth');
    const github = authModuleTemplate({ loginPath: '/auth/login', oauthProviders: ['github'] });
    expect(github).toContain('GITHUB_CLIENT_ID');
    expect(github).toContain('/auth/github/callback');
    const multiple = authModuleTemplate({ loginPath: '/admin/auth/login', oauthProviders: ['github', 'google'] });
    expect(multiple).toContain('GOOGLE_CLIENT_SECRET');
    expect(multiple).toContain('/admin/auth/reset-password');
  });

  it('uses exact guest paths and modern page bindings', () => {
    const middleware = authMiddlewareTemplate({ publicPaths: ['/admin/auth/login', '/admin/auth/register'] });
    expect(middleware).toContain('new Set(["/admin/auth/login","/admin/auth/register"])');
    expect(middleware).not.toContain("startsWith('/auth/')");
    const login = loginPageTemplate({ loginPath: '/auth/login', registerPath: '/auth/register', oauthProviders: [] });
    expect(login).not.toContain('requestUpdate()');
    expect(login).toContain("bind(this, 'email')");
    expect(login).toContain('@submit="${this.handleSubmit}"');
  });
});
