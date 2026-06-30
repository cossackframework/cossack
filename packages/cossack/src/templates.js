/**
 * Stub content generators for `cossack generate` and `cossack add`.
 * Kept as pure functions (string in, string out) so they are trivially testable.
 *
 * Conventions mirror the framework's own source:
 *   pages    : @Page() class extends Cossack, default export
 *   layouts  : @Page({ transport: 'http' }) class extends Cossack, default export
 *   components: @Component() class extends Cossack, named export
 *   services : @Service() class (no extends)
 *   middleware: defineServerMiddleware, named camelCase export
 */

export function pageTemplate({ className, title }) {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class ${className} extends Cossack {
  render() {
    return html\`
      <div class="p-8">
        <h1 class="text-2xl font-bold">${title}</h1>
      </div>
    \`;
  }
}
`;
}

export function pageMdxTemplate({ title }) {
  return `---
title: ${title}
---

# ${title}

Edit this page at \`src/pages/<name>/index.mdx\`.
`;
}

export function componentTemplate({ className, propsName }) {
  return `import { html } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';

interface ${propsName} {
  [key: string]: any;
}

@Component()
export class ${className} extends Cossack {
  declare props: ${propsName};

  render() {
    return html\`
      <div>
        \${this.children}
      </div>
    \`;
  }
}
`;
}

export function layoutTemplate({ className, kebab }) {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class ${className} extends Cossack {
  render() {
    return html\`
      <div class="${kebab}-layout">
        \${this.children}
      </div>
    \`;
  }
}
`;
}

export function middlewareTemplate({ exportName }) {
  return `import { defineServerMiddleware } from '@cossackframework/core';

export const ${exportName} = defineServerMiddleware(async (c, next) => {
  // TODO: implement your middleware here.
  await next();
});
`;
}

export function serviceTemplate({ className }) {
  return `import { Service, State, Server } from '@cossackframework/core';

@Service()
export class ${className} {
  @State() count = 0;

  @Server()
  increment() {
    this.count++;
  }
}
`;
}

// --- auth feature stubs -----------------------------------------------------

export function authLayoutTemplate() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class AuthLayout extends Cossack {
  render() {
    return html\`
      <div class="auth-layout flex justify-center items-center min-h-[80vh] bg-gray-100">
        <div class="bg-white p-8 rounded-lg shadow-md w-full max-w-[400px]">
          <h2 class="text-center text-gray-800 mb-6">Cossack Auth</h2>
          \${this.children}
          <div class="mt-6 text-center text-sm">
            <a href="/" class="text-gray-500">&larr; Back to Home</a>
          </div>
        </div>
      </div>
    \`;
  }
}
`;
}

export function loginPageTemplate() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class LoginPage extends Cossack {
  render() {
    return html\`
      <h3 class="mb-4">Login</h3>
      <form method="post">
        <div class="mb-4">
          <label class="block mb-2">Email</label>
          <input type="email" name="email" class="w-full p-2 border rounded" placeholder="user@example.com" />
        </div>
        <div class="mb-4">
          <label class="block mb-2">Password</label>
          <input type="password" name="password" class="w-full p-2 border rounded" />
        </div>
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded">
          Sign In
        </button>
      </form>
      <p class="mt-4 text-center">
        Don't have an account? <a href="/register" class="text-blue-600">Register</a>
      </p>
    \`;
  }
}
`;
}

export function registerPageTemplate() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class RegisterPage extends Cossack {
  render() {
    return html\`
      <h3 class="mb-4">Register</h3>
      <form method="post">
        <div class="mb-4">
          <label class="block mb-2">Name</label>
          <input type="text" name="name" class="w-full p-2 border rounded" />
        </div>
        <div class="mb-4">
          <label class="block mb-2">Email</label>
          <input type="email" name="email" class="w-full p-2 border rounded" />
        </div>
        <div class="mb-4">
          <label class="block mb-2">Password</label>
          <input type="password" name="password" class="w-full p-2 border rounded" />
        </div>
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded">
          Create Account
        </button>
      </form>
      <p class="mt-4 text-center">
        Already have an account? <a href="/login" class="text-blue-600">Login</a>
      </p>
    \`;
  }
}
`;
}

export function forgotPasswordPageTemplate() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class ForgotPasswordPage extends Cossack {
  render() {
    return html\`
      <h3 class="mb-4">Forgot Password</h3>
      <form method="post">
        <div class="mb-4">
          <label class="block mb-2">Email</label>
          <input type="email" name="email" class="w-full p-2 border rounded" />
        </div>
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded">
          Send Reset Link
        </button>
      </form>
      <p class="mt-4 text-center">
        <a href="/login" class="text-blue-600">&larr; Back to Login</a>
      </p>
    \`;
  }
}
`;
}

export function authMiddlewareTemplate() {
  return `import { defineServerMiddleware } from '@cossackframework/core';

/**
 * Auth middleware (STUB).
 * TODO: replace with real session verification using @cossackframework/auth.
 * Currently passes every request through. The public paths below are skipped
 * so login/register/forgot-password remain reachable.
 */
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password'];

export const authMiddleware = defineServerMiddleware(async (c, next) => {
  const { path } = c.req;
  if (PUBLIC_PATHS.includes(path)) {
    return next();
  }
  // TODO: verify session/cookie here; e.g.:
  //   const session = await verifySession(c);
  //   if (!session) return c.redirect('/login');
  await next();
});
`;
}

/** Minimal root layout that applies the auth middleware (created by `add auth`). */
export function rootLayoutWithAuthTemplate() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { authMiddleware } from '../middlewares/auth';

@Page({ transport: 'http', middlewares: [authMiddleware] })
export default class RootLayout extends Cossack {
  render() {
    return html\`
      <div class="min-h-screen">
        \${this.children}
      </div>
    \`;
  }
}
`;
}

/**
 * Default English catalog shipped by `cossack lang publish`. Demonstrates
 * placeholder replacement and pluralization so the feature is immediately
 * useful; users edit/extend freely.
 */
export function defaultLangCatalog() {
  return {
    welcome: 'Welcome to :name',
    goodbye: 'Goodbye, :Name',
    apples: 'You have :count apple|You have :count apples',
    'I love programming.': 'I love programming.',
  };
}

/**
 * Starter catalog JSON for a locale. `publish` uses the populated English
 * template; `add <locale>` reuses this with empty strings so translators can
 * fill in values while keeping the key set in sync.
 *
 * @param entries  key → value map (values may be '' for the `add` stub)
 */
export function langJsonTemplate(entries) {
  return JSON.stringify(entries, null, 2) + '\n';
}
