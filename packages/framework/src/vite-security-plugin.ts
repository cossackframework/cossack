import type { Plugin } from 'vite';
import { parseSync } from 'vite';
import { readFileSync } from 'node:fs';

export interface CossackSecurityPluginOptions {
  devWarning?: boolean;
}

/**
 * Vite plugin that strips server-only code from client bundles.
 *
 * This plugin transforms component source code during client builds by:
 * 1. Keeping methods decorated with @Client, @Optimistic, @Computed, @Shared
 * 2. Keeping built-in lifecycle methods: render, head, onMount, onCleanup, escapeHtml
 * 3. Keeping property getters/setters
 * 4. Replacing all other method bodies with stub functions that throw at development time
 *
 * The goal is to ensure server-only code (database queries, API keys, business logic)
 * is not exposed in the client bundle.
 *
 * Discovery and the transitive-preservation closure are driven by the Oxc AST
 * (re-exported by Vite as `parseSync`), which parses TypeScript + legacy
 * decorators + class fields natively. Byte-offset spans from the AST are spliced
 * directly into the source string.
 *
 * Uses the Vite Environment API to detect the current environment automatically.
 * Only applies stripping in the 'client' environment.
 */
export function cossackSecurityPlugin(options: CossackSecurityPluginOptions = {}): Plugin {
  const {
    devWarning = true,
  } = options;

  // Built-in methods that should always be kept in client bundles
  // Note: init() and get() are intentionally NOT included - they are server-only by default
  const BUILTIN_METHODS = new Set([
    'render',
    'head',
    'onMount',
    'onCleanup',
    'escapeHtml',
    'loadingTemplate',
    'toString',
    'valueOf',
    'clientInit', // Client-side initialization method for fake loading
    // Validation methods
    'getError',
    'hasError',
    'validateProperty',
    'validateAll',
    'clearErrors',
    'onNavigateComplete', // Lifecycle hook (called on the App instance after SPA navigation)
    'startViewTransition', // View Transitions API wrapper (runs on client)
  ]);

  /**
   * Check if the file should be processed.
   * Only process user application code, not framework/library code.
   */
  function shouldProcessFile(id: string): boolean {
    // Skip node_modules
    if (id.includes('node_modules')) return false;
    // Never transform the plugin's Node-only implementation when Vite/Vitest
    // loads it as part of the build configuration.
    if (/(^|\/)vite-security-plugin\.m?ts(?:$|[?#])/.test(id)) return false;

    // Skip framework packages. Use path-aware matching (surrounding path
    // separators) so a user path like `/src/@cossackframework/core-utils/x.ts`
    // doesn't accidentally match.
    const fwkPrefixes = ['core', 'renderer', 'auth', 'database'];
    if (fwkPrefixes.some((pkg) => {
      const needle = `@cossackframework/${pkg}`;
      // Match either `/@cossackframework/pkg/` or `\@cossackframework\pkg\`
      // (path-delimited), not a bare substring.
      return id.includes(`/${needle}/`) || id.includes(`\\${needle}\\`);
    })) return false;

    // Only process TypeScript files in user code
    return id.endsWith('.ts') || id.endsWith('.mts');
  }

  return {
    name: 'cossack-security',
    enforce: 'pre', // Run before other plugins to ensure we process raw source

    /**
     * Server-only config files (`src/config/*.ts`) must never reach the client
     * bundle — they call `env()` to read secrets and bindings. The only server
     * entry point to them is `virtual:cossack-config` (which stubs to `{}` on
     * the client). This guard catches the case where user code accidentally
     * imports a config file directly (e.g. `import { dbConfig } from
     * '../config/database'`) — on the client such an import resolves to an
     * empty default export instead of leaking the file's contents.
     *
     * The same treatment applies to `src/auth.ts`: it imports ORM values (which
     * pulls `node:async_hooks`) and is only ever called from `@Server` method
     * bodies (stripped on the client) or server middleware. Its named exports
     * are stubbed here so the import resolves on the client without leaking
     * server code or Node built-ins.
     */
    load(id) {
      const isClientEnvironment = this.environment?.name === 'client';
      if (id.includes('node_modules')) return;

      // Vite module ids frequently include query strings (e.g. `src/auth.ts?import`
      // or `?v=abc123`). Strip `?…` / `#…` before matching or reading the file so
      // the regex anchors ($>) and readFileSync both see the real path.
      const cleanId = id.split('?')[0].split('#')[0];
      if (/(^|\/)vite-security-plugin\.m?ts$/.test(cleanId)) return;

      // Browser-only modules are loaded verbatim by the client build. Every
      // server environment receives a shape-compatible, lazy throwing stub so
      // shared components can import them without executing browser globals at
      // module evaluation time.
      if (isClientOnlyModuleId(cleanId)) {
        if (isClientEnvironment) return;
        return generateClientOnlyServerStub(cleanId, moduleLabelFromId(cleanId));
      }

      if (!isClientEnvironment) return;

      // Match files in the project's `src/config/` directory. Anchored to
      // `/src/config/` so it doesn't catch unrelated `/config/` paths in
      // dependencies or other project subdirectories.
      if (/(^|\/)src\/config\/[^/]+\.m?ts$/.test(cleanId)) {
        return `export default {};\n`;
      }

      // `src/auth.ts` (generated by `cossack add auth`) is server-only — it
      // imports the ORM and `@cossackframework/auth`, neither of which belongs
      // in the browser. The page components import `loginUser`, `registerUser`,
      // `auth`, etc. from it, but those calls live inside stripped `@Server`
      // bodies, so stubbing every named export to a throwing placeholder keeps
      // the client graph clean. A dev-time throw surfaces accidental client use.
      //
      // The export list is derived dynamically from the real `src/auth.ts` (via
      // the Oxc AST) so it tracks the generator exactly — including conditional
      // OAuth exports (`oauth`, `handleOAuthUser`) — and never drifts.
      if (/(^|\/)src\/auth\.m?ts$/.test(cleanId)) {
        return generateAuthClientStub(cleanId);
      }

      // General server-only detection: any other user module that imports from
      // `@cossackframework/database`, `@cossackframework/auth`, or a `node:`
      // builtin is server-only (the import transitively pulls
      // `node:async_hooks`). This catches service/data-access modules (e.g.
      // `src/services/users.ts`, `src/db/config.ts`) that aren't `src/auth.ts`
      // but still leak server code into the client bundle. Page components import
      // from these, but the real calls live inside stripped `@Server` bodies, so
      // stubbing named exports to throwing placeholders keeps the graph clean.
      // `src/config/*` is already handled above and `src/auth.ts` above that.
      if (isServerOnlyModule(cleanId)) {
        // Component modules must reach transform() first: @Server bodies and
        // server$ loaders are removed there, after which their now-unused
        // server-only imports can be tree-shaken. Stubbing the whole module in
        // load() would erase the component before the AST security pass.
        try {
          const source = readFileSync(cleanId, 'utf8');
          if (/extends\s+(?:Cossack|CossackElement)\b/.test(source)) return;
        } catch { /* generate the conservative stub below */ }
        return generateServerOnlyStub(cleanId, moduleLabelFromId(cleanId));
      }
    },

    transform(code, id) {
      const isClientEnvironment = this.environment?.name === 'client';
      if (!shouldProcessFile(id)) {
        return { code, map: null };
      }

      // server$ is a compiler macro in both environments. On the server its
      // generated method retains the loader; the normal client pass below
      // replaces that method with the existing RPC proxy stub.
      if (code.includes('server$')) code = transformServerResources(code, id);

      // Check if this file contains a Cossack class or a @Service decorated class
      if (!code.includes('extends Cossack') && !code.includes('extends CossackElement') && !code.includes('@Service')) {
        return { code, map: null };
      }

      // Undecorated methods are server-only by default. When one is exposed in
      // a render event slot (for example `@click=${this.increment}`), register
      // it in both the server and client class metadata. The server registration
      // makes the RPC allowlist accept it; the client registration lets
      // bootstrap replace its stripped stub with the normal transport proxy.
      if (!isClientEnvironment) {
        return {
          code: injectAutomaticServerMethodMetadata(
            code,
            id,
            isClientSafeMethod,
            BUILTIN_METHODS,
          ),
          map: null,
        };
      }

      try {
        const stripped = transformCossackClass(code, id, isClientSafeMethod, BUILTIN_METHODS, devWarning);
        const transformed = stripClientServerOnlyImports(stripped, id);
        if (transformed !== code) {
          return { code: transformed, map: null };
        }
      } catch (error) {
        throw error;
      }

      return { code, map: null };
    },
  };
}

function isServerOnlyImportSource(source: string): boolean {
  return source === '@cossackframework/database' ||
    source.startsWith('@cossackframework/database/') ||
    source === '@cossackframework/framework/session' ||
    source === '@cossackframework/auth' ||
    source.startsWith('@cossackframework/auth/') ||
    source.startsWith('node:');
}

/**
 * Remove direct server-only imports after method/resource bodies have been
 * stripped. If a binding remains referenced, it escaped into client-safe code
 * and the client build must fail instead of loading a Node/server module.
 */
export function stripClientServerOnlyImports(code: string, id: string): string {
  const program = parseProgram(code);
  if (!program) throw new Error(`[Cossack Security] Could not validate server-only imports in ${id}.`);

  const candidates: Array<{ node: any; source: string; bindings: string[] }> = [];
  for (const statement of program.body ?? []) {
    if (statement.type !== 'ImportDeclaration') continue;
    const source = String(statement.source?.value ?? '');
    if (!isServerOnlyImportSource(source)) continue;
    candidates.push({
      node: statement,
      source,
      bindings: (statement.specifiers ?? []).map((specifier: any) => specifier.local?.name).filter(Boolean),
    });
  }
  if (!candidates.length) return code;

  const referenced = new Set<string>();
  const visit = (node: any, parent?: any, parentKey?: string) => {
    if (!node || typeof node.type !== 'string' || node.type === 'ImportDeclaration') return;
    if (node.type === 'Identifier') {
      const isStaticKey =
        ((parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') && parentKey === 'key' && !parent.computed) ||
        (parent?.type === 'MemberExpression' && parentKey === 'property' && !parent.computed) ||
        (parent?.type === 'Property' && parentKey === 'key' && !parent.computed && !parent.shorthand);
      if (!isStaticKey) referenced.add(node.name);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value)) value.forEach((child) => visit(child, node, key));
      else if (value && typeof (value as any).type === 'string') visit(value, node, key);
    }
  };
  for (const statement of program.body ?? []) visit(statement);

  for (const candidate of candidates) {
    const leaked = candidate.bindings.filter((binding) => referenced.has(binding));
    if (leaked.length) {
      throw new Error(
        `[Cossack Security] ${id} references server-only import ${JSON.stringify(candidate.source)} ` +
        `from client-safe code (${leaked.join(', ')}). Move the reference into a server$ loader or @Server() method.`,
      );
    }
  }

  let result = code;
  for (const candidate of [...candidates].sort((a, b) => b.node.start - a.node.start)) {
    result = result.slice(0, candidate.node.start) + result.slice(candidate.node.end);
  }
  return result;
}

type MacroReplacement = { start: number; end: number; replacement: string };

function stableResourceHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Transform imported server$ bindings into generated @Server RPC methods. */
export function transformServerResources(code: string, id: string): string {
  const program = parseProgram(code);
  if (!program) throw new Error(`[Cossack server$] Could not parse ${id}.`);
  const bindings = new Set<string>();
  for (const statement of program.body ?? []) {
    if (statement.type !== 'ImportDeclaration' || statement.source?.value !== '@cossackframework/core') continue;
    for (const specifier of statement.specifiers ?? []) {
      if (specifier.type === 'ImportSpecifier' && (specifier.imported?.name ?? specifier.imported?.value) === 'server$') {
        bindings.add(specifier.local?.name ?? 'server$');
      }
    }
  }
  if (!bindings.size) return code;

  const replacements: MacroReplacement[] = [];
  let hasGeneratedResources = false;
  for (const cls of findClasses(program)) {
    if (superclassName(cls) !== 'Cossack' && superclassName(cls) !== 'CossackElement') continue;
    const className = cls.id?.name ?? 'Anonymous';
    let inlineOrdinal = 0;
    const generated: string[] = [];
    const allowedCalls = new Set<number>();

    const compileCall = (call: any, name: string): string => {
      if (call.arguments?.length < 1 || call.arguments.length > 2) {
        throw new Error(`[Cossack server$] ${id}: ${name} expects a loader and one optional options object.`);
      }
      const loader = call.arguments[0];
      allowedCalls.add(call.start);
      if (loader.type !== 'ArrowFunctionExpression' && loader.type !== 'FunctionExpression') {
        throw new Error(`[Cossack server$] ${id}: ${name} loader must be an inline function.`);
      }
      const options = call.arguments[1] ? sourceSlice(code, call.arguments[1]) : '{}';
      const method = `__cossack_server_resource_${stableResourceHash(`${id}:${className}:${name}`)}`;
      const args = (loader.params ?? []).map((p: any) => sourceSlice(code, p)).join(', ');
      const body = loader.body.type === 'BlockStatement'
        ? sourceSlice(code, loader.body)
        : `{ return ${sourceSlice(code, loader.body)}; }`;
      generated.push(`\n    @__CossackServerResource({ serverResource: true })\n    async ${method}(${args}) ${body}\n`);
      hasGeneratedResources = true;
      return `this.__serverResource(${JSON.stringify(name)}, this.${method}.bind(this), ${options})`;
    };

    for (const member of cls.body?.body ?? []) {
      if (member.type === 'PropertyDefinition' && member.value?.type === 'CallExpression' &&
          member.value.callee?.type === 'Identifier' && bindings.has(member.value.callee.name)) {
        const name = memberKeyName(member.key);
        if (!name) throw new Error(`[Cossack server$] ${id}: resource fields require a static name.`);
        const optionsNode = member.value.arguments?.[1];
        const hasInitial = optionsNode?.type === 'ObjectExpression' && (optionsNode.properties ?? []).some((p: any) =>
          !p.computed && (p.key?.name ?? p.key?.value) === 'initial');
        if (!hasInitial) throw new Error(`[Cossack server$] ${id}: class field "${name}" requires { initial }.`);
        const expression = compileCall(member.value, name);
        const type = member.typeAnnotation ? sourceSlice(code, member.typeAnnotation) : '';
        replacements.push({ start: member.start, end: member.end, replacement: `get ${sourceSlice(code, member.key)}()${type} { return ${expression}; }` });
      }
    }

    const render = (cls.body?.body ?? []).find((m: any) => m.type === 'MethodDefinition' && memberKeyName(m.key) === 'render');
    const visitRender = (node: any) => {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && bindings.has(node.callee.name)) {
        const name = `render:${inlineOrdinal++}`;
        replacements.push({ start: node.start, end: node.end, replacement: compileCall(node, name) });
        return;
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visitRender);
        else if (value && typeof (value as any).type === 'string') visitRender(value);
      }
    };
    if (render) visitRender(render.value.body);

    // Any remaining macro call in this class is in an unsupported location.
    const scan = (node: any) => {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && bindings.has(node.callee.name) && !allowedCalls.has(node.start)) {
        throw new Error(`[Cossack server$] ${id}: server$ is only valid as a class-field initializer or a direct call inside render().`);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(scan);
        else if (value && typeof (value as any).type === 'string') scan(value);
      }
    };
    scan(cls.body);

    if (generated.length) replacements.push({ start: cls.body.end - 1, end: cls.body.end - 1, replacement: generated.join('') });
  }
  let result = code;
  for (const item of replacements.sort((a, b) => b.start - a.start)) result = result.slice(0, item.start) + item.replacement + result.slice(item.end);
  if (hasGeneratedResources) {
    result = `import { Server as __CossackServerResource } from '@cossackframework/core';\n${result}`;
  }
  return result;
}

// ============================================================================
// AST helpers (Oxc, via Vite's re-export of rolldown/utils → parseSync)
// ============================================================================

/**
 * Parse `code` as TypeScript and return the ESTree-ish `Program`, or `null` if
 * the source does not parse.
 *
 * Uses `parseSync` (the non-deprecated Oxc entry point re-exported by Vite).
 * Unlike `parseAst`, `parseSync` does not throw on parse errors — it returns a
 * `ParseResult` with an `.errors` array. On failure we return `null`; the
 * caller decides whether to warn.
 *
 * The filename passed to `parseSync` is a fixed placeholder (not the Vite
 * module `id`, which can carry query strings like `?import` and is not a valid
 * path for Oxc's filename handling).
 */
function parseProgram(code: string): any | null {
  try {
    const result = parseSync('cossack-security.ts', code, { lang: 'ts' });
    if (result.errors && result.errors.length > 0) return null;
    return result.program;
  } catch {
    return null;
  }
}

/** Whether a Vite module id uses the browser-only module filename convention. */
export function isClientOnlyModuleId(id: string): boolean {
  const cleanId = id.split('?')[0].split('#')[0];
  return /(?:^|[/\\])[^/\\]+\.client\.m?ts$/.test(cleanId);
}

type ClientOnlyExports = { named: string[]; hasDefault: boolean };

/**
 * Generate an SSR-safe interface for a browser-only module. Importing a stub
 * is harmless; any runtime interaction with one of its exports fails close to
 * the misuse with lifecycle guidance.
 */
export function generateClientOnlyServerStub(id: string, moduleName = moduleLabelFromId(id)): string {
  const cleanId = id.split('?')[0].split('#')[0];
  let source: string;
  try {
    source = readFileSync(cleanId, 'utf8');
  } catch {
    throw new Error(`[Cossack Security] Could not read client-only module ${cleanId}.`);
  }
  const exports = readClientOnlyExports(source, cleanId);
  const label = JSON.stringify(moduleName);
  const prelude =
    `// [cossack-security] ${moduleName} is client-only — stubbed during SSR.\n` +
    `const __clientOnly = (name) => {\n` +
    `  const fail = () => { throw new Error('[Cossack] Client-only export "' + name + '" from "' + ${label} + '" was accessed during SSR. Use it only in onMount(), clientInit(), or an @Client() method.'); };\n` +
    `  return new Proxy(function () {}, { get: fail, set: fail, apply: fail, construct: fail });\n` +
    `};\n`;
  const lines = exports.named.map((name) => `export const ${name} = __clientOnly(${JSON.stringify(name)});\n`);
  if (exports.hasDefault) lines.push(`export default __clientOnly('default');\n`);
  return prelude + lines.join('');
}

function readClientOnlyExports(source: string, id: string): ClientOnlyExports {
  const program = parseProgram(source);
  if (!program) throw new Error(`[Cossack Security] Could not parse client-only module ${id}.`);
  const named = new Set<string>();
  let hasDefault = false;
  for (const stmt of program.body ?? []) {
    if (stmt.type === 'ExportAllDeclaration') {
      if (stmt.exportKind !== 'type') {
        throw new Error(
          `[Cossack Security] Client-only module ${id} uses runtime "export *", ` +
          `whose SSR stub interface cannot be determined locally. Replace it with explicit named exports.`,
        );
      }
      continue;
    }
    if (stmt.type === 'ExportDefaultDeclaration') {
      hasDefault = true;
      continue;
    }
    if (stmt.type !== 'ExportNamedDeclaration' || stmt.exportKind === 'type') continue;
    if (stmt.declaration) collectDeclarationNames(stmt.declaration, named);
    for (const specifier of stmt.specifiers ?? []) {
      if (specifier.exportKind === 'type') continue;
      const exported = specifier.exported;
      const name = exported?.name ?? exported?.value;
      if (name === 'default') hasDefault = true;
      else if (typeof name === 'string') named.add(name);
    }
  }
  return { named: [...named], hasDefault };
}

/**
 * Generate a client-side stub module for a server-only user module.
 *
 * A server-only module is one that imports from `@cossackframework/database`
 * (which pulls `node:async_hooks`), `@cossackframework/auth`, or a `node:`
 * builtin — none of which belong in the browser. Other modules (e.g. page
 * components) import named exports from it, but every real call lives inside a
 * stripped `@Server` body — so on the client each named export is replaced with
 * a throwing placeholder that keeps the module graph clean and surfaces
 * accidental client use loudly in dev.
 *
 * The set of exports is parsed from the real file on disk (not hard-coded) so
 * it tracks the source exactly. `export type` declarations are skipped (types
 * are erased and never become runtime bindings).
 *
 * `moduleName` is the short label used in the generated error message and the
 * header comment (e.g. `'auth'`, `'services/users'`).
 *
 * Falls back to a throwing Proxy stub if the file can't be read or parsed (so
 * a build never hard-fails, but accidental client use is still loud).
 */
export function generateServerOnlyStub(id: string, moduleName: string): string {
  const namedExports = readNamedExports(id);
  const header =
    `// [cossack-security] ${moduleName} is server-only — stubbed on the client.\n` +
    `const stub = (name) => () => { throw new Error('${moduleName}.' + name + ' is server-only and was called on the client. Move the call into a @Server method.'); };\n`;

  if (namedExports.length === 0) {
    // Couldn't read/parse the real file. Emit a throwing Proxy so any named
    // import resolves to a loud error rather than `undefined` (which fails far
    // from the cause). A build never hard-fails, but accidental client use is
    // still surfaced in dev.
    return (
      header +
      `// [cossack-security] Could not parse ${moduleName} exports — using a throwing Proxy fallback.\n` +
      `export default new Proxy({}, { get: (_, name) => stub(String(name)) });\n`
    );
  }

  const lines: string[] = [];
  for (const name of namedExports) {
    lines.push(`export const ${name} = stub('${name}');\n`);
  }
  return header + lines.join('');
}

/**
 * Generate the client-side stub module for `src/auth.ts`.
 *
 * Specialized wrapper over {@link generateServerOnlyStub} that preserves the
 * `auth` export's shape: client code (the login page) references
 * `auth.createSession` inside a stripped `@Server` body, but bootstrap code may
 * reference `auth.middleware` — so stub `auth` as `{ middleware: stub,
 * createSession: stub }` rather than a bare function. Other exports are stubbed
 * normally.
 */
function generateAuthClientStub(id: string): string {
  const namedExports = readNamedExports(id);
  const header =
    `// [cossack-security] src/auth.ts is server-only — stubbed on the client.\n` +
    `const stub = (name) => () => { throw new Error('auth.' + name + ' is server-only and was called on the client. Move the call into a @Server method.'); };\n`;

  if (namedExports.length === 0) {
    // Couldn't read/parse the real file. Fall back to a conservative set of
    // expected exports so named imports (`import { loginUser } from '../../../auth'`)
    // resolve to throwing stubs (loud in dev) rather than being `undefined`
    // (which fails far from the cause). The Proxy default catches anything else.
    const fallbackExports = [
      'auth', 'hashPassword', 'verifyPassword',
      'loginUser', 'registerUser',
      'requestPasswordReset', 'resetPassword',
      'oauth', 'handleOAuthUser',
    ];
    const lines: string[] = [];
    for (const name of fallbackExports) {
      if (name === 'auth') {
        lines.push(`export const auth = { middleware: stub('middleware') };\n`);
      } else {
        lines.push(`export const ${name} = stub('${name}');\n`);
      }
    }
    return (
      header +
      `// [cossack-security] Could not parse src/auth.ts exports — using a conservative fallback.\n` +
      lines.join('') +
      `export default new Proxy({}, { get: (_, name) => stub(String(name)) });\n`
    );
  }

  const lines: string[] = [];
  for (const name of namedExports) {
    // The `auth` kit object: client code only ever touches `auth.middleware`
    // (and only to register it, which is a server-bootstrap concern). Expose a
    // throwing middleware so accidental client invocation is loud, rather than
    // a bare `stub` that would mis-type as a function.
    if (name === 'auth') {
      lines.push(`export const auth = { middleware: stub('middleware') };\n`);
    } else {
      lines.push(`export const ${name} = stub('${name}');\n`);
    }
  }
  return header + lines.join('');
}

/**
 * Server-only import specifiers. A user module that imports from any of these
 * cannot run in the browser (they pull Node built-ins like `node:async_hooks`)
 * and must be stubbed on the client.
 *
 * NOTE: `@cossackframework/auth` is intentionally NOT in this set. The auth
 * package is pure TypeScript (only `hono` type imports, no Node built-ins) and
 * its `createAuthorizer` (the `guard` kit) must run on the client so that
 * `@Page({ middlewares: [guard.requireRole('admin')] })` can evaluate at module
 * load. A file that uses the server-only `createAuth` (sessions) typically also
 * imports ORM models (e.g. `src/auth.ts`) and is caught by the ORM rule — or
 * by the `src/auth.ts` filename special-case.
 */
const SERVER_ONLY_IMPORT_SOURCES = new Set([
  '@cossackframework/database',
  '@cossackframework/framework/session',
]);

/**
 * Read the import source specifiers from a TypeScript module on disk via the
 * Oxc AST. Covers static imports (`import x from 'y'`, `import { x } from 'y'`)
 * and dynamic `import('y')` calls. Returns the set of source strings (e.g.
 * `'@cossackframework/database'`, `'node:fs'`).
 */
export function readImportSources(id: string): string[] {
  const cleanId = id.split('?')[0].split('#')[0];
  let source: string;
  try {
    source = readFileSync(cleanId, 'utf-8');
  } catch {
    return [];
  }
  const program = parseProgram(source);
  if (!program) return [];

  const sources = new Set<string>();
  for (const stmt of program.body ?? []) {
    if (stmt.type === 'ImportDeclaration' && stmt.source?.value) {
      // `import type { X } from 'y'` erases at compile time and pulls no
      // runtime code — skip it so a type-only import from a server-only package
      // (e.g. a model file doing `import type { Generated }`) isn't misflagged.
      if (stmt.importKind === 'type') continue;
      sources.add(stmt.source.value);
    } else if (stmt.type === 'ExportNamedDeclaration' && stmt.source?.value) {
      // re-export `export { x } from 'y'`; skip type-only re-exports similarly.
      if (stmt.exportKind === 'type') continue;
      sources.add(stmt.source.value);
    } else if (stmt.type === 'ExportAllDeclaration' && stmt.source?.value) {
      if (stmt.exportKind === 'type') continue;
      sources.add(stmt.source.value);
    }
  }
  return [...sources];
}

/**
 * Determine whether a user module is server-only by inspecting its imports.
 *
 * A module is server-only if it imports from:
 *   - any `@cossackframework/database` / `@cossackframework/framework/session` specifier
 *     (these transitively pull `node:async_hooks` and other server-only code),
 *     OR
 *   - any `node:` builtin (these never exist in the browser).
 *
 * Subpath imports are matched by their package prefix (e.g.
 * `@cossackframework/database` matches `@cossackframework/database` exactly;
 * `node:` matches by prefix). Type-only imports (`import type { X } from 'y'`)
 * are excluded by the AST walker — they erase at compile time and never pull
 * runtime code.
 *
 * Used by the `load` hook to auto-stub server-only modules on the client, so a
 * service file importing an ORM entity does not leak server code into the bundle.
 */
export function isServerOnlyModule(id: string): boolean {
  const sources = readImportSources(id);
  return sources.some((spec) => {
    if (spec.startsWith('node:')) return true;
    return [...SERVER_ONLY_IMPORT_SOURCES].some((source) =>
      spec === source || spec.startsWith(`${source}/`),
    );
  });
}

/**
 * A short, human-readable module label for stub error messages. Derives the
 * tail of the path (e.g. `src/services/users.ts` → `services/users`) so errors
 * read `'services/users.listUsers is server-only ...'`.
 */
export function moduleLabelFromId(id: string): string {
  const cleanId = id.split('?')[0].split('#')[0];
  const parts = cleanId.replace(/\\/g, '/').split('/src/').pop() || cleanId;
  return parts.replace(/\.m?ts$/, '');
}

/**
 * Read the named exports (runtime bindings only) from a TypeScript module on
 * disk via the Oxc AST. Covers `export const/let/var/function/class`, re-exports
 * (`export { x }`, `export { x } from './y'`), and `export *` (resolved to a
 * placeholder name is intentionally NOT attempted — the generated auth module
 * uses only direct exports). Type-only exports (`export type`, `export
 * interface`) are excluded because they produce no runtime binding.
 */
function readNamedExports(id: string): string[] {
  // Strip Vite query/hash suffixes (?import, ?v=…) so readFileSync sees the real path.
  const cleanId = id.split('?')[0].split('#')[0];
  let source: string;
  try {
    source = readFileSync(cleanId, 'utf-8');
  } catch {
    return [];
  }
  const program = parseProgram(source);
  if (!program) return [];

  const names = new Set<string>();
  for (const stmt of program.body ?? []) {
    switch (stmt.type) {
      case 'ExportNamedDeclaration': {
        // `export type { ... }` — skip entirely (no runtime binding).
        if (stmt.exportKind === 'type') break;
        if (stmt.declaration) {
          // `export const foo = ...`, `export function foo() {}`, `export class Foo {}`
          collectDeclarationNames(stmt.declaration, names);
        }
        // `export { foo, bar }` / `export { foo } from './y'`
        for (const spec of stmt.specifiers ?? []) {
          if (spec.exported?.type === 'Identifier') names.add(spec.exported.name);
        }
        break;
      }
      case 'ExportAllDeclaration': {
        // `export * from './y'` — can't resolve statically without following the
        // module; the generated auth module doesn't use this, so skip.
        break;
      }
      default:
        break;
    }
  }
  return [...names];
}

/** Add the names introduced by a declaration node (`const`, `function`, `class`, ...). */
function collectDeclarationNames(decl: any, names: Set<string>): void {
  if (!decl) return;
  switch (decl.type) {
    case 'VariableDeclaration':
      for (const d of decl.declarations ?? []) {
        addBindingName(d.id, names);
      }
      break;
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
    case 'TSEnumDeclaration':
      if (decl.id?.type === 'Identifier') names.add(decl.id.name);
      break;
    default:
      break;
  }
}

/** Add one or more binding names from a pattern (Identifier / ObjectPattern / ArrayPattern). */
function addBindingName(pattern: any, names: Set<string>): void {
  if (!pattern) return;
  if (pattern.type === 'Identifier') {
    names.add(pattern.name);
  } else if (pattern.type === 'ObjectPattern') {
    for (const prop of pattern.properties ?? []) {
      if (prop.type === 'Property') addBindingName(prop.value, names);
      else if (prop.type === 'RestElement') addBindingName(prop.argument, names);
    }
  } else if (pattern.type === 'ArrayPattern') {
    for (const el of pattern.elements ?? []) addBindingName(el, names);
  } else if (pattern.type === 'RestElement') {
    addBindingName(pattern.argument, names);
  }
}

/** True if `node` is a `ClassDeclaration` or `ClassExpression`. */
function isClassNode(node: any): boolean {
  return node?.type === 'ClassDeclaration' || node?.type === 'ClassExpression';
}

/**
 * Yield every class node anywhere in `program`. A class may be the
 * `declaration` of an `ExportNamedDeclaration`/`ExportDefaultDeclaration`, or a
 * top-level/`Program`-body class, or nested in an `ExportDefaultDeclaration`
 * (anonymous default class). We walk the top level + one level of export
 * wrappers; deeply-nested classes are not currently processed.
 */
function* findClasses(program: any): Generator<any> {
  for (const stmt of program?.body ?? []) {
    if (isClassNode(stmt)) yield stmt;
    else if (
      (stmt?.type === 'ExportNamedDeclaration' || stmt?.type === 'ExportDefaultDeclaration') &&
      isClassNode(stmt.declaration)
    ) {
      yield stmt.declaration;
    }
  }
}

/** The static name of a class's `superClass` (e.g. `Cossack`), or null. */
function superclassName(cls: any): string | null {
  const sc = cls?.superClass;
  if (!sc) return null;
  if (sc.type === 'Identifier') return sc.name;
  return null;
}

/**
 * The name of a member's `key`: identifier names, string/literal keys, and
 * private names (`#foo`) are returned as strings; computed keys that aren't a
 * simple literal return null (we can't match them by name, so we leave them
 * alone — preserving them, the safe default).
 */
function memberKeyName(key: any): string | null {
  if (!key) return null;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'PrivateIdentifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}

/** Slice the source text spanned by `node`'s `start`/`end`. */
function sourceSlice(code: string, node: any): string {
  return code.slice(node.start, node.end);
}

/**
 * Description of a single class member relevant to stripping. Mirrors the
 * information the old `CollectedMethod` carried, but now derived from AST nodes
 * with authoritative byte offsets.
 */
interface AstMethod {
  name: string;
  /** Raw decorator source slices, e.g. `['@Server()', '@RateLimit(...)']`. */
  decorators: string[];
  hasServerDecorator: boolean;
  /** `MethodDefinition.value.body` span (the `{...}`) for methods; null for
   *  fields without a function value. Offsets are into the FILE source. */
  bodyStart: number; // index of opening `{`
  bodyEnd: number;   // index of closing `}` (exclusive+1)
  /** For class fields whose value is a function: the offset where the function
   *  value begins, so we can replace the whole value. Undefined otherwise. */
  fieldValueStart?: number;
  fieldKind?: 'arrow' | 'function';
  fieldIsAsync?: boolean;
}

/**
 * Collect every method/field-function in a class body as {@link AstMethod}s.
 * Getters/setters (`MethodDefinition.kind === 'get' | 'set'`) are intentionally
 * SKIPPED — they are read as bare property accesses inside preserved methods
 * like `render()`, and the transitive-preservation pass only sees parenthesised
 * calls, so stripping them would break client rendering.
 */
function collectAstMethods(cls: any, code: string): AstMethod[] {
  const methods: AstMethod[] = [];
  for (const member of cls?.body?.body ?? []) {
    if (member.type === 'MethodDefinition') {
      // Skip accessors (preserved by policy — see comment above).
      if (member.kind === 'get' || member.kind === 'set') continue;
      // The constructor is never a stub candidate — it is preserved verbatim
      // (the metadata-injection pass may splice a registration call into it,
      // but its body must survive so `super()` and any field initialisation run).
      if (member.kind === 'constructor') continue;
      const name = memberKeyName(member.key);
      if (name === null) continue;
      const fn = member.value; // FunctionExpression / ArrowFunctionExpression
      const body = fn?.body;
      if (!body || body.type !== 'BlockStatement') continue;
      const decorators = (member.decorators ?? []).map((d: any) => sourceSlice(code, d));
      methods.push({
        name,
        decorators,
        hasServerDecorator: decorators.some((d: string) => /@(?:Server|__CossackServerResource)\b/.test(d)),
        bodyStart: body.start,
        bodyEnd: body.end,
      });
    } else if (member.type === 'PropertyDefinition') {
      const name = memberKeyName(member.key);
      if (name === null) continue;
      const value = member.value;
      if (!value) continue; // non-function data field — leave as-is
      const kind = value.type === 'ArrowFunctionExpression' ? 'arrow'
        : value.type === 'FunctionExpression' ? 'function'
        : null;
      if (!kind) continue; // non-function field value
      const body = value.body;
      // Arrow concise-body has no block; treat the whole value as the span to
      // replace (fieldValueStart..value.end).
      const decorators = (member.decorators ?? []).map((d: any) => sourceSlice(code, d));
      methods.push({
        name,
        decorators,
        hasServerDecorator: decorators.some((d: string) => /@(?:Server|__CossackServerResource)\b/.test(d)),
        bodyStart: body.type === 'BlockStatement' ? body.start : value.start,
        bodyEnd: body.type === 'BlockStatement' ? body.end : value.end,
        fieldValueStart: value.start,
        fieldKind: kind,
        fieldIsAsync: !!value.async,
      });
    }
  }
  return methods;
}

/**
 * Walk `node`'s subtree and collect every `this.<name>(...)` call's `<name>`.
 * Used by the transitive-preservation closure: a preserved method that calls
 * `this.foo(...)` preserves `foo`. Only static member names are considered
 * (`this[dyn]()` is ignored — we can't match it by name).
 */
function collectThisCalls(node: any): string[] {
  const names: string[] = [];
  const visit = (n: any) => {
    if (!n || typeof n.type !== 'string') return;
    if (
      n.type === 'CallExpression' &&
      n.callee?.type === 'MemberExpression' &&
      n.callee.object?.type === 'ThisExpression' &&
      !n.callee.computed &&
      n.callee.property?.type === 'Identifier'
    ) {
      names.push(n.callee.property.name);
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) {
        for (const c of v) visit(c);
      } else if (v && typeof v.type === 'string') {
        visit(v);
      }
    }
  };
  visit(node);
  return names;
}

/** Helpers for recognizing bare method values in render event-handler slots. */
function propertyName(node: any): string | null {
  if (node?.type === 'Identifier' || node?.type === 'PrivateIdentifier') return node.name;
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

function isHandlerProperty(node: any): boolean {
  const name = propertyName(node);
  return name !== null && (name.startsWith('@') || /^on[A-Z]/.test(name));
}

function isTemplateEventBinding(quasi: any): boolean {
  const raw = quasi?.value?.raw;
  return typeof raw === 'string' && /@[A-Za-z0-9_.:-]+\s*=\s*["']?$/.test(raw);
}

/** Collect method values used in event slots, excluding unrelated bare references. */
function collectRenderHandlerReferences(node: any): string[] {
  const names: string[] = [];
  const visit = (n: any, parent?: any, handlerPosition = false) => {
    if (!n || typeof n.type !== 'string') return;
    if (
      handlerPosition &&
      n.type === 'MemberExpression' &&
      n.object?.type === 'ThisExpression' &&
      !n.computed &&
      n.property?.type === 'Identifier'
    ) {
      const isDirectCall = parent?.type === 'CallExpression' && parent.callee === n;
      if (!isDirectCall) names.push(n.property.name);
    }

    if (n.type === 'TaggedTemplateExpression' && n.quasi?.type === 'TemplateLiteral') {
      visit(n.tag, n, false);
      for (let index = 0; index < n.quasi.expressions.length; index++) {
        visit(
          n.quasi.expressions[index],
          n.quasi,
          isTemplateEventBinding(n.quasi.quasis[index]),
        );
      }
      return;
    }

    if (n.type === 'Property') {
      if (n.computed) visit(n.key, n, false);
      visit(n.value, n, isHandlerProperty(n.key));
      return;
    }

    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) {
        for (const c of v) visit(c, n, handlerPosition);
      } else if (v && typeof v.type === 'string') {
        visit(v, n, handlerPosition);
      }
    }
  };
  visit(node);
  return names;
}

/** Undecorated methods exposed as render event handlers become automatic RPC endpoints. */
function computeAutomaticRpcSet(
  cls: any,
  methods: AstMethod[],
  preserved: Set<string>,
): Set<string> {
  const byName = new Map(methods.map((method) => [method.name, method]));
  const automatic = new Set<string>();

  for (const member of cls?.body?.body ?? []) {
    const name = memberKeyName(member.key);
    if (name !== 'render' || !preserved.has(name)) continue;
    const body = member.type === 'MethodDefinition'
      ? member.value?.body
      : member.type === 'PropertyDefinition'
        ? member.value?.body ?? member.value
        : undefined;
    if (!body) continue;

    for (const reference of collectRenderHandlerReferences(body)) {
      const target = byName.get(reference);
      if (target && !preserved.has(reference) && !target.hasServerDecorator) {
        automatic.add(reference);
      }
    }
  }

  return automatic;
}

/**
 * Compute the preserved set: methods that must retain their full implementation
 * in the client bundle. Seeds with client-safe methods (by decorator or builtin
 * name) and then iterates a transitive closure to a fixed point (capped at 3
 * rounds) — any `this.foo(...)` call from a preserved method to another method
 * on the same class preserves `foo` as well.
 *
 * AST-driven: call edges come from {@link collectThisCalls} walking each
 * preserved method's body node, so string/comment content is naturally ignored
 * and computed `this[dyn]()` calls can't fool the closure.
 */
function computePreservedSet(
  cls: any,
  methods: AstMethod[],
  isClientSafeMethodFn: (decorators: string[], methodName: string, builtinMethods: Set<string>) => boolean,
  builtinMethods: Set<string>,
): Set<string> {
  const byName = new Map<string, AstMethod>();
  for (const m of methods) {
    if (!byName.has(m.name)) byName.set(m.name, m);
  }

  const preserved = new Set<string>();
  for (const m of methods) {
    if (isClientSafeMethodFn(m.decorators, m.name, builtinMethods)) {
      preserved.add(m.name);
    }
  }

  // Map method/field-function name → its AST body node, for call-edge
  // traversal. A function-valued class field (`@Client handler = () => {...}`)
  // can also be preserved and call helpers, so its body must be walked too —
  // otherwise helpers it reaches via `this.foo()` would be incorrectly stubbed.
  const bodyByName = new Map<string, any>();
  for (const member of cls?.body?.body ?? []) {
    if (member.type === 'MethodDefinition') {
      const name = memberKeyName(member.key);
      if (name !== null && member.value?.body) bodyByName.set(name, member.value.body);
      continue;
    }
    if (member.type === 'PropertyDefinition') {
      const name = memberKeyName(member.key);
      const value = member.value;
      if (
        name !== null &&
        value &&
        (value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression')
      ) {
        // Arrow concise-body is an Expression (no BlockStatement); use the
        // value body if present, else the value itself so `collectThisCalls`
        // walks the expression.
        bodyByName.set(name, value.body ?? value);
      }
    }
  }

  // Fixed-point iteration, capped at 3 rounds. Depth 3 covers the common
  // onMount -> setupReveal -> wireObserver -> addListener chain.
  for (let round = 0; round < 3; round++) {
    const before = preserved.size;
    for (const name of [...preserved]) {
      const body = bodyByName.get(name);
      if (!body) continue;
      for (const callee of collectThisCalls(body)) {
        const target = byName.get(callee);
        // A client-safe method can call an explicit @Server method through its
        // generated RPC proxy. Keeping that body would ship server-only code
        // (and any native imports it uses) to the browser.
        if (target && !target.hasServerDecorator) preserved.add(callee);
      }
    }
    if (preserved.size === before) break;
  }

  return preserved;
}

// ============================================================================
// Stub generation
// ============================================================================

/**
 * Create a stub function body for a server-only method.
 *
 * The stub checks if a runtime proxy exists and calls it. `@Server` methods
 * receive an RPC proxy at bootstrap, so the stub transparently forwards.
 * Undecorated helpers that were stripped (no `@Server`, not reachable from a
 * client-safe method) have no proxy and therefore throw with guidance.
 *
 * The leading render-phase guard (`this.__cossackAssertNotRendering?.(...)`)
 * makes a stripped server method invoked during `render()` fail loudly instead
 * of returning a Promise that the synchronous renderer would stringify as
 * "[object Promise]".
 */
function createStub(
  methodName: string,
  className: string,
  devWarning: boolean
): string {
  const renderGuard = `this.__cossackAssertNotRendering?.('${methodName}');`;
  if (devWarning) {
    return `{
      ${renderGuard}
      // Check if a proxy has been set up for this server-only method
      const proxy = this.__cossack_proxies?.get('${methodName}');
      if (proxy) {
        return proxy.apply(this, arguments);
      }
      // No proxy - this method was stripped because it has no client-safe
      // decorator and is not reachable from a client-safe method.
      throw new Error(
        '[Cossack] ${className}.${methodName} was stripped from the client bundle ' +
        'because it has no client-safe decorator and is not reachable from a ' +
        'client-safe method. Add @Client, @On, @OnWindow, @OnDocument, @Computed, ' +
        '@Shared, @Task, or @VisibleTask; ensure it is called (directly or ' +
        'transitively) from a preserved method; or avoid calling it from client code.'
      );
    }`;
  }
  // Production: minimal stub that still checks for proxy
  return `{
    ${renderGuard}
    const proxy = this.__cossack_proxies?.get('${methodName}');
    if (proxy) return proxy.apply(this, arguments);
    throw new Error('[Cossack] ${className}.${methodName} was stripped from the client bundle.');
  }`;
}

/**
 * Stub for a class field whose value is a function (`name = (...) => {...}` or
 * `name = function(...) {...}`). Class field initializers forbid `arguments`,
 * so unlike {@link createStub} this replaces the whole value and forwards
 * arguments via a rest parameter (`...args`). The result is a complete value
 * (an arrow or function expression), inserted at the field's value start.
 */
function createFieldStub(
  methodName: string,
  className: string,
  devWarning: boolean,
  isAsync: boolean,
  isFunction: boolean,
): string {
  const asyncPrefix = isAsync ? 'async ' : '';
  // arrow: `async (...args) =>` ; function: `async function (...args)`
  const sig = isFunction
    ? `${asyncPrefix}function (...args)`
    : `${asyncPrefix}(...args) =>`;
  const renderGuard = `this.__cossackAssertNotRendering?.('${methodName}');`;
  if (devWarning) {
    return `${sig} {
      ${renderGuard}
      const proxy = this.__cossack_proxies?.get('${methodName}');
      if (proxy) {
        return proxy.apply(this, args);
      }
      throw new Error('[Cossack] ${className}.${methodName} was stripped from the client bundle.');
    }`;
  }
  return `${sig} {
    ${renderGuard}
    const proxy = this.__cossack_proxies?.get('${methodName}');
    if (proxy) return proxy.apply(this, args);
    throw new Error('[Cossack] ${className}.${methodName} was stripped from the client bundle.');
  }`;
}

// ============================================================================
// Server-method metadata injection
// ============================================================================

/**
 * Extract the names of server-only methods that will be stubbed, along with
 * whether each one carries an explicit `@Server` decorator or is exposed as an
 * automatic handler RPC. Unreachable undecorated helpers remain unregistered.
 */
function extractServerOnlyMethodNames(
  methods: AstMethod[],
  preserved: Set<string>,
  automaticRpc: Set<string>,
): Array<{ name: string; registerForRpc: boolean }> {
  const result: Array<{ name: string; registerForRpc: boolean }> = [];
  for (const m of methods) {
    if (!preserved.has(m.name)) {
      result.push({
        name: m.name,
        registerForRpc: m.hasServerDecorator || automaticRpc.has(m.name),
      });
    }
  }
  return result;
}

/**
 * Create metadata injection code that registers server-only methods for RPC
 * proxying. Explicit `@Server` methods and compiler-discovered handler methods
 * are registered. Other stripped helpers receive no proxy and throw loudly.
 *
 * Returns an empty string when no method qualifies, so no constructor is
 * injected. This is injected at the end of the class body.
 */
function createMetadataInjection(
  methods: Array<{ name: string; registerForRpc: boolean }>,
): string {
  const serverMethodNames = methods
    .filter((m) => m.registerForRpc)
    .map((m) => m.name);
  if (serverMethodNames.length === 0) return '';

  const methodList = JSON.stringify(serverMethodNames);
  return `
    // Register server-only methods for RPC proxying
    static __registerServerOnlyMethods() {
      if (typeof Reflect === 'undefined' || !Reflect.hasMetadata) return;
      const serverMethods = Reflect.getOwnMetadata('cossack:server-methods', this) || {};
      const methods = ${methodList};
      for (const name of methods) {
        if (!serverMethods[name]) {
          serverMethods[name] = { channel: 'global', provider: 'page', __serverOnly: true };
        }
      }
      Reflect.defineMetadata('cossack:server-methods', serverMethods, this);
    }
`;
}

/** The statement injected into a constructor to register server-only methods. */
const REGISTER_SERVER_METHODS_CALL =
  '      (this.constructor as any).__registerServerOnlyMethods?.();\n';

function appendMetadataRegistration(
  cls: any,
  metadataInjection: string,
): Array<{ start: number; end: number; replacement: string }> {
  if (!metadataInjection) return [];
  const closeBrace = cls.body.end - 1;
  const ctor = findConstructor(cls);
  if (ctor) {
    const openBrace = ctor.value.body.start;
    return [
      { start: openBrace + 1, end: openBrace + 1, replacement: '\n' + REGISTER_SERVER_METHODS_CALL },
      { start: closeBrace, end: closeBrace, replacement: metadataInjection },
    ];
  }

  const superCall = cls.superClass != null ? '      super();\n' : '';
  return [{
    start: closeBrace,
    end: closeBrace,
    replacement: metadataInjection + `    constructor() {
${superCall}${REGISTER_SERVER_METHODS_CALL}    }
`,
  }];
}

/**
 * Add compiler-owned RPC metadata to the server build while retaining method
 * bodies. This mirrors the client transform's handler discovery.
 */
export function injectAutomaticServerMethodMetadata(
  code: string,
  _id: string,
  isClientSafeMethodFn: (decorators: string[], methodName: string, builtinMethods: Set<string>) => boolean,
  builtinMethods: Set<string>,
): string {
  const program = parseProgram(code);
  if (!program) return code;
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];

  for (const cls of findClasses(program)) {
    const isCossackSubclass = superclassName(cls) === 'Cossack' || superclassName(cls) === 'CossackElement';
    const hasServiceDecorator = (cls.decorators ?? []).some((d: any) => /@Service\b/.test(sourceSlice(code, d)));
    if (!isCossackSubclass && !hasServiceDecorator) continue;

    const methods = collectAstMethods(cls, code);
    const preserved = computePreservedSet(cls, methods, isClientSafeMethodFn, builtinMethods);
    const automaticRpc = computeAutomaticRpcSet(cls, methods, preserved);
    if (automaticRpc.size === 0) continue;
    const registrations = [...automaticRpc].map((name) => ({ name, registerForRpc: true }));
    replacements.push(...appendMetadataRegistration(cls, createMetadataInjection(registrations)));
  }

  let result = code;
  for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, replacement.start) + replacement.replacement + result.slice(replacement.end);
  }
  return result;
}

// ============================================================================
// Main transform
// ============================================================================

/**
 * Transform a source string by stubbing server-only methods of every Cossack /
 * CossackElement subclass and every `@Service`-decorated class. Discovery,
 * preservation, and stub spans are all derived from the Oxc AST, so the
 * transform is robust to formatting, single-statement bodies, and field/method
 * ordering — cases the previous regex/brace scanner mishandled.
 *
 * Exported for unit testing.
 */
export function transformCossackClass(
  code: string,
  id: string,
  isClientSafeMethodFn: (decorators: string[], methodName: string, builtinMethods: Set<string>) => boolean,
  builtinMethods: Set<string>,
  devWarning: boolean
): string {
  // Strip SSG generateStaticParams bodies from @Page(...) / @Component(...)
  // decorator arguments first, so method-stripping operates on sanitized source.
  code = stripSsgGenerateStaticParams(code);

  const program = parseProgram(code);
  if (!program) {
    // Fail-open on parse errors (we can't strip what we can't parse), but warn
    // loudly so a parse failure never silently ships server-only code in the
    // client bundle. This is a security plugin — silent skip is the wrong default.
    console.warn(
      `[Cossack Security] Could not parse ${id} with Oxc; server-only code ` +
        `stripping was SKIPPED for this file. If it contains @Server methods, ` +
        `their bodies may leak into the client bundle. Check the syntax or ` +
        `report a parser bug.`
    );
    return code;
  }

  // Collect, per class, the splices to apply. We record replacements as
  // file-relative offsets and apply them in reverse order at the end.
  type Replacement = { start: number; end: number; replacement: string };
  const replacements: Replacement[] = [];

  for (const cls of findClasses(program)) {
    const isCossackSubclass = superclassName(cls) === 'Cossack' || superclassName(cls) === 'CossackElement';
    const hasServiceDecorator = (cls.decorators ?? []).some((d: any) => /@Service\b/.test(sourceSlice(code, d)));
    if (!isCossackSubclass && !hasServiceDecorator) continue;

    const className = cls.id?.name ?? 'Anonymous';

    const methods = collectAstMethods(cls, code);
    const preserved = computePreservedSet(cls, methods, isClientSafeMethodFn, builtinMethods);
    const automaticRpc = computeAutomaticRpcSet(cls, methods, preserved);
    const serverOnlyMethods = extractServerOnlyMethodNames(methods, preserved, automaticRpc);

    // 1. Stub the body of every non-preserved method, and the value of every
    //    non-preserved @Server function field.
    for (const m of methods) {
      if (preserved.has(m.name)) continue;

      if (m.fieldValueStart !== undefined) {
        // Class field with a function value. Only strip fields explicitly
        // marked @Server — undecorated arrow fields are commonly used as event
        // handlers (e.g. @click=${this.handler}) and the transitive-preservation
        // pass can't see bare template references, so stripping them by default
        // would break apps.
        if (!m.hasServerDecorator) continue;
        const stub = createFieldStub(m.name, className, devWarning, !!m.fieldIsAsync, m.fieldKind === 'function');
        replacements.push({ start: m.fieldValueStart, end: m.bodyEnd, replacement: stub });
      } else {
        const stub = createStub(m.name, className, devWarning);
        // Splice the stub between the body braces (exclusive of the braces).
        replacements.push({
          start: m.bodyStart + 1,
          end: m.bodyEnd - 1,
          replacement: stub.slice(1, -1), // drop the stub's outer braces
        });
      }
    }

    // 2. Inject the __registerServerOnlyMethods static + constructor wiring.
    //    The static method definition is ALWAYS appended (just before the
    //    class's closing brace) when there is at least one @Server method;
    //    separately, the registration CALL is spliced into an existing
    //    constructor or a freshly-appended one. Appending the static method
    //    unconditionally here is safe — only the constructor must avoid
    //    duplication, and that is handled below.
    const metadataInjection = createMetadataInjection(serverOnlyMethods);
    if (metadataInjection) {
      replacements.push(...appendMetadataRegistration(cls, metadataInjection));
    }
  }

  if (replacements.length === 0) return code;

  // Apply in reverse offset order so earlier offsets stay valid.
  let result = code;
  for (const r of [...replacements].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, r.start) + r.replacement + result.slice(r.end);
  }
  return result;
}

/**
 * Find the `constructor` `MethodDefinition` of `cls`, or null if the class
 * declares none. Used to splice the server-method registration call into an
 * existing constructor instead of appending a duplicate.
 */
function findConstructor(cls: any): any | null {
  for (const member of cls?.body?.body ?? []) {
    if (member.type === 'MethodDefinition' && member.kind === 'constructor') {
      return member;
    }
  }
  return null;
}

// ============================================================================
// SSG generateStaticParams stripping (AST-driven)
// ============================================================================

/**
 * Strip the body of `generateStaticParams` from `@Page(...)` / `@Component(...)`
 * decorator arguments. The function is only ever invoked at SSG build time
 * (see `getStaticParams` in ssg-renderer.ts) — never on the client — so its
 * body is pure leak risk in the client bundle (database queries, API keys,
 * business logic). Each occurrence is replaced with `async () => []`, which
 * preserves the declared type and acts as a defensive no-op.
 *
 * Exported for unit testing.
 */
export function stripSsgGenerateStaticParams(code: string): string {
  if (!code.includes('generateStaticParams')) return code;
  const program = parseProgram(code);
  if (!program) return code;

  const replacements: Array<{ start: number; end: number; replacement: string }> = [];

  for (const cls of findClasses(program)) {
    const decos = cls.decorators ?? [];
    for (const deco of decos) {
      const decoText = sourceSlice(code, deco);
      if (!/@(Page|Component)\b/.test(decoText)) continue;
      // The decorator argument is an ObjectExpression inside the call.
      const value = findGenerateStaticParamsValueNode(deco, code);
      if (value) {
        replacements.push({
          start: value.start,
          end: value.end,
          replacement: 'async () => []',
        });
      }
    }
  }

  if (replacements.length === 0) return code;
  let result = code;
  for (const r of [...replacements].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, r.start) + r.replacement + result.slice(r.end);
  }
  return result;
}

/**
 * Within a `@Page(...)` / `@Component(...)` decorator call's argument object,
 * find the `generateStaticParams` property's VALUE node (the function), but only
 * if it lives under an `ssg: { ... }` object literal. Returns the value node or
 * null. Mirrors the old `findSsgObjectLiteral` + `findGenerateStaticParamsValue`
 * pair, but via AST.
 */
function findGenerateStaticParamsValueNode(decoratorNode: any, code: string): any | null {
  const expr = decoratorNode.expression;
  // @Page / @Component are call decorators: `@Page({ ... })`.
  if (!expr || expr.type !== 'CallExpression') return null;
  const arg = expr.arguments?.[0];
  if (!arg || arg.type !== 'ObjectExpression') return null;

  for (const prop of arg.properties) {
    if (prop.type !== 'Property') continue;
    if (memberKeyName(prop.key) !== 'ssg') continue;
    const ssgVal = prop.value;
    if (!ssgVal || ssgVal.type !== 'ObjectExpression') return null; // boolean form
    for (const ssgProp of ssgVal.properties) {
      if (ssgProp.type !== 'Property') continue;
      if (memberKeyName(ssgProp.key) === 'generateStaticParams') {
        return ssgProp.value;
      }
    }
  }
  return null;
}

// ============================================================================
// Client-safe classification (pure logic, exported + tested)
// ============================================================================

/**
 * Check if a method is decorated with a client-safe decorator.
 * Exported for testing purposes.
 */
export function isClientSafeMethod(
  decorators: string[],
  methodName: string,
  builtinMethods: Set<string>
): boolean {
  // Check for client-safe decorators
  const hasClientDecorator = decorators.some((d) =>
    /@(?:Client|ClientTask|Optimistic|Computed|Shared|On(?:Event|Document|Window)?|PreventNavigation|Validate|VisibleTask|Task)\b/.test(d)
  );
  if (hasClientDecorator) return true;

  // Check for built-in methods
  if (builtinMethods.has(methodName)) return true;

  // Check for @Server/@ServerTask decorator explicitly - these should be stubbed
  if (decorators.some((d) => /@(?:Server|ServerTask)\b/.test(d))) {
    return false;
  }

  // Default: methods without decorators are considered server-only (secure by default)
  return false;
}

export default cossackSecurityPlugin;
