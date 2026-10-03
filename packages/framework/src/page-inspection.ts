/**
 * AST-backed @Page option extraction (CLI-04/RT-07/RT-12).
 *
 * The regex heuristic in scan-routes misreports nested option objects,
 * comments, string text containing option-like content, trailing commas,
 * aliased decorators, and dynamic (identifier) option objects. This module
 * parses the real syntax tree through Vite's re-exported oxc parser
 * (`parseSync`) and reports `unknown` with a reason for options it cannot
 * resolve statically. When the parser is unavailable (for example the CLI
 * runs outside a project with vite installed), callers report unknown
 * options without attempting heuristic extraction.
 */

type AstNode = any; // Vite/Oxc nodes are narrowed by their type tags below.
let parseSyncLoader: Promise<typeof import('vite').parseSync | null> | undefined;

async function loadParseSync() {
  if (parseSyncLoader !== undefined) return parseSyncLoader;
  parseSyncLoader = import('vite')
    .then(vite => vite.parseSync)
    .catch(() => null);
  return parseSyncLoader;
}

function sourceText(node: AstNode, code: string) {
  return code.slice(node.start, node.end);
}

function lineNumberAt(code: string, index: number) {
  return code.slice(0, index).split('\n').length;
}

/** Identifier names the source imports as an alias of `Page` from core. */
function pageDecoratorAliases(program: AstNode) {
  const aliases = new Set(['Page']);
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    if (statement.source?.value !== '@cossackframework/core') continue;
    for (const specifier of statement.specifiers ?? []) {
      if (specifier.type === 'ImportSpecifier' && specifier.imported.name === 'Page') {
        aliases.add(specifier.local.name);
      }
    }
  }
  return aliases;
}

/** Extract scalar/array facts from one @Page options object literal. */
function readOptionsObject(objectExpression: AstNode, code: string) {
  const options: { transport: string | null; stateful: boolean | null; ssg: boolean | null; middlewares: number; services: string[] } = { transport: null, stateful: null, ssg: null, middlewares: 0, services: [] };
  const unresolved = [];
  for (const property of objectExpression.properties ?? []) {
    if (property.type !== 'Property' || property.computed) {
      unresolved.push('spread or computed options');
      continue;
    }
    const key = property.key.name ?? property.key.value;
    if (key === 'transport' && property.value.type === 'Literal' && typeof property.value.value === 'string') {
      options.transport = property.value.value;
    } else if (key === 'stateful' && property.value.type === 'Literal' && typeof property.value.value === 'boolean') {
      options.stateful = property.value.value;
    } else if (key === 'ssg' && property.value.type === 'Literal' && typeof property.value.value === 'boolean') {
      options.ssg = property.value.value;
    } else if (key === 'ssg' && property.value.type === 'ObjectExpression') {
      const properties = property.value.properties;
      // Spreads/computed keys may replace enabled. Never infer a default from
      // their apparent absence, and use the last static key like JavaScript.
      if (properties.some((p: AstNode) => p.type !== 'Property' || p.computed)) {
        unresolved.push('ssg spread or computed options');
      } else {
        const enabled = properties.filter((p: AstNode) => (p.key?.name ?? p.key?.value) === 'enabled').at(-1);
        if (!enabled) options.ssg = true;
        else if (enabled.value.type === 'Literal' && typeof enabled.value.value === 'boolean') options.ssg = enabled.value.value;
        else unresolved.push('ssg.enabled');
      }
    } else if (key === 'middlewares' && property.value.type === 'ArrayExpression' && !property.value.elements.some((e: AstNode) => !e || e.type === 'SpreadElement')) {
      options.middlewares = property.value.elements.length;
    } else if (key === 'services' && property.value.type === 'ArrayExpression') {
      options.services = (property.value.elements ?? [])
        .filter(Boolean).map((element: AstNode) => sourceText(element, code));
      const staticReference = (node: AstNode): boolean => node?.type === 'Identifier' ||
        node?.type === 'MemberExpression' && !node.computed && !node.optional &&
        node.property?.type === 'Identifier' && staticReference(node.object);
      if (property.value.elements.some((e: AstNode) => !staticReference(e))) unresolved.push('services');
    } else if (['transport', 'stateful', 'ssg', 'middlewares', 'services'].includes(key)) {
      unresolved.push(key);
    }
  }
  return { options, unresolved };
}

function parsedProgram(parseSync: typeof import('vite').parseSync, code: string): AstNode {
  try {
    const result = parseSync('page.ts', code);
    return result.errors?.length ? null : result.program;
  } catch { return null; }
}

/** Resolve only the module's default class declaration, without importing it. */
export async function inspectDefaultClassExport(code: string) {
  const parser = await loadParseSync();
  const program = parser && parsedProgram(parser, code);
  if (!program) return { status: 'unknown', reason: 'Module syntax could not be parsed.' };
  const direct = program.body.find((statement: AstNode) => statement.type === 'ExportDefaultDeclaration');
  const aliases = program.body.flatMap((statement: AstNode) => statement.type === 'ExportNamedDeclaration'
    ? (statement.specifiers ?? []).filter((specifier: AstNode) => (specifier.exported?.name ?? specifier.exported?.value) === 'default')
      .map((specifier: AstNode) => ({ statement, specifier })) : []);
  if (!direct && !aliases.length) return { status: 'missing', reason: 'The router requires a default-exported component class.' };
  let declaration = direct?.declaration;
  let name = declaration?.type === 'Identifier' ? declaration.name : null;
  if (!direct && aliases.length === 1 && !aliases[0].statement.source) name = aliases[0].specifier.local?.name;
  if (name) declaration = program.body.map((statement: AstNode) => statement.declaration ?? statement)
    .find((candidate: AstNode) => candidate.type === 'ClassDeclaration' && candidate.id?.name === name);
  if (declaration?.type === 'ClassDeclaration' || declaration?.type === 'ClassExpression') {
    return { status: 'resolved', className: declaration.id?.name ?? 'Anonymous', line: lineNumberAt(code, declaration.start),
      reason: 'Default export resolves to a local class declaration; component runtime validity is not checked.' };
  }
  return { status: 'unknown', reason: 'The default export does not resolve to a local class declaration.' };
}

function pageClass(program: AstNode, code: string) {
  const aliases = pageDecoratorAliases(program);
  const namespaces = new Set(program.body.filter((s: AstNode) => s.type === 'ImportDeclaration' &&
    s.source?.value === '@cossackframework/core').flatMap((s: AstNode) => s.specifiers
      .filter((p: AstNode) => p.type === 'ImportNamespaceSpecifier').map((p: AstNode) => p.local.name)));
  const candidates = [];
  for (const statement of program.body) {
    const cls = statement.declaration ?? statement;
    if (!['ClassDeclaration', 'ClassExpression'].includes(cls.type)) continue;
    const decorator = (cls.decorators ?? []).find((d: AstNode) => {
      const callee = d.expression?.type === 'CallExpression' ? d.expression.callee : d.expression;
      return callee?.type === 'Identifier' && aliases.has(callee.name) ||
        callee?.type === 'MemberExpression' && namespaces.has(callee.object?.name) && callee.property?.name === 'Page';
    });
    if (decorator) candidates.push({ cls, decorator, exported: statement.type.startsWith('Export') });
  }
  // The router loads the default export, not whichever decorated class appears
  // first. A helper's metadata must never stand in for an unresolved export.
  const defaultExport = program.body.find((statement: AstNode) => statement.type === 'ExportDefaultDeclaration');
  if (defaultExport) {
    const declaration = defaultExport.declaration;
    return candidates.find((candidate: AstNode) => candidate.cls === declaration ||
      declaration?.type === 'Identifier' && candidate.cls.id?.name === declaration.name);
  }
  const exportedDefault = program.body.flatMap((statement: AstNode) => statement.type === 'ExportNamedDeclaration'
    ? (statement.specifiers ?? []).filter((specifier: AstNode) => (specifier.exported?.name ?? specifier.exported?.value) === 'default')
      .map((specifier: AstNode) => ({ name: specifier.local?.name, external: Boolean(statement.source) })) : []);
  if (exportedDefault.length) {
    return exportedDefault.length === 1 && !exportedDefault[0].external
      ? candidates.find((candidate: AstNode) => candidate.cls.id?.name === exportedDefault[0].name) : undefined;
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Parse `code` and extract the exported @Page class's options. Returns
 * `{ options, method, reason }`: `method` is `ast` on success, `unknown`
 * when the options object is dynamic (an identifier or spread), and `null`
 * when no parser is available (the caller reports unknown options).
 */
export async function extractPageOptionsFromAst(code: string) {
  const parseSync = await loadParseSync();
  if (!parseSync) return null;
  const program = parsedProgram(parseSync, code);
  if (!program) {
    return { options: null, method: 'unknown', reason: 'The file could not be parsed as TypeScript.' };
  }
  const selected = pageClass(program, code);
  const decoratorCall = selected?.decorator.expression;
  const decoratorLine = decoratorCall ? lineNumberAt(code, decoratorCall.start) : null;
  if (!decoratorCall) return { options: null, method: 'unknown', reason: 'No @Page decorator found.' };

  const argument = decoratorCall.arguments?.[0]?.expression ?? decoratorCall.arguments?.[0];
  if (!argument) {
    return { options: readOptionsObject({ properties: [] }, code).options, method: 'ast', decoratorLine };
  }
  if (argument.type === 'ObjectExpression') {
    const { options, unresolved } = readOptionsObject(argument, code);
    return unresolved.length ? { options: null, method: 'unknown', decoratorLine,
      reason: `The @Page options contain ${unresolved.join(', ')} and cannot be resolved statically.` } :
      { options, method: 'ast', decoratorLine };
  }
  return {
    options: null,
    method: 'unknown',
    decoratorLine,
    reason: `The @Page options are ${argument.type === 'Identifier' ? `the identifier ${argument.name}` : 'a dynamic expression'} and cannot be resolved statically.`,
  };
}

/** Own-method classification from the same analysis used by the compiler. */
export async function extractMethodClassificationsFromAst(code: string, file = 'page.ts', compilerId = file) {
  const parseSync = await loadParseSync();
  if (!parseSync) return null;
  const program = parsedProgram(parseSync, code);
  if (!program) return { methods: [], reason: 'The file could not be parsed as TypeScript.' };
  const selected = pageClass(program, code);
  if (!selected) return { methods: [], reason: 'No @Page class found; method classification is unavailable.' };
  let inspectCompilerMethods;
  try {
    ({ inspectCompilerMethods } = await import('./vite-security-plugin.js'));
  } catch {
    return { methods: [], reason: 'Compiler inspection metadata is unavailable; build or update the framework package.' };
  }
  if (typeof inspectCompilerMethods !== 'function') {
    return { methods: [], reason: 'The framework package does not expose compiler inspection metadata.' };
  }
  const result = inspectCompilerMethods(code, compilerId);
  if (result.diagnostics.length) {
    return { methods: [], reason: result.diagnostics.map((d: AstNode) => d.message).join(' ') };
  }
  const facts = result.classes.find(cls => cls.name === (selected.cls.id?.name ?? 'Anonymous'));
  if (!facts) return { methods: [], reason: 'The compiler did not identify the selected page class.' };
  return {
    method: 'compiler',
    className: facts.name,
    inheritance: facts.inheritance,
    members: facts.members,
    membersComplete: facts.membersComplete,
    inheritedDeclarations: facts.inheritance.bases.flatMap(name => {
      const base = result.classes.find(cls => cls.name === name);
      return base ? [{ className: name, source: file, members: base.members, membersComplete: base.membersComplete, methods: base.methods.map(fact => ({ ...fact, source: { ...fact.source, file } })) }] : [];
    }),
    methods: facts.methods.map(fact => ({
      ...fact,
      source: { ...fact.source, file },
      kind: fact.rpc ? 'server' : fact.clientBody === 'retained' ? 'client' : 'stripped',
      line: fact.source.line,
    })),
    reason: 'Own methods classified by the compiler; inherited declarations require project resolution.',
  };
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);
/** Resolve local const aliases and TS wrappers without executing initializers. */
function apiSyntax(program: AstNode) {
  const locals = new Map<string, AstNode>();
  const factories = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration' && statement.importKind !== 'type' && statement.source?.value === '@cossackframework/framework/api') {
      for (const specifier of statement.specifiers ?? []) {
        if (specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type' && specifier.imported?.name === 'defineApi') factories.add(specifier.local.name);
        if (specifier.type === 'ImportNamespaceSpecifier') namespaces.add(specifier.local.name);
      }
    }
    const declaration = statement.declaration ?? statement;
    if (['FunctionDeclaration', 'ClassDeclaration'].includes(declaration.type) && declaration.id) locals.set(declaration.id.name, declaration);
    if (declaration.type === 'VariableDeclaration' && declaration.kind === 'const') {
      for (const entry of declaration.declarations) if (entry.id?.type === 'Identifier') locals.set(entry.id.name, entry.init);
    }
  }
  const resolve = (node: AstNode) => {
    const seen = new Set();
    for (let count = 0; count < 32; count++) {
      if (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(node?.type)) { node = node.expression; continue; }
      if (node?.type !== 'Identifier' || !locals.has(node.name)) return node;
      if (seen.has(node.name)) return null;
      seen.add(node.name); node = locals.get(node.name);
    }
    return null;
  };
  const factory = (value: AstNode) => {
    const node = resolve(value);
    if (node?.type !== 'CallExpression' || node.optional) return null;
    const callee = resolve(node.callee);
    return callee?.type === 'Identifier' && factories.has(callee.name) ||
      callee?.type === 'MemberExpression' && !callee.computed && !callee.optional &&
      callee.object?.type === 'Identifier' && namespaces.has(callee.object.name) && callee.property?.name === 'defineApi' ? node : null;
  };
  const exports: { method: string; value: AstNode; source: AstNode }[] = [];
  for (const statement of program.body) {
    if (statement.type === 'ExportDefaultDeclaration') exports.push({ method: '*', value: statement.declaration, source: statement });
    if (statement.type !== 'ExportNamedDeclaration' || statement.exportKind === 'type') continue;
    const declaration = statement.declaration;
    if (declaration?.type === 'FunctionDeclaration' && HTTP_METHODS.has(declaration.id?.name)) exports.push({ method: declaration.id.name, value: declaration, source: declaration });
    if (declaration?.type === 'VariableDeclaration') for (const entry of declaration.declarations) {
      if (HTTP_METHODS.has(entry.id?.name)) exports.push({ method: entry.id.name,
        value: declaration.kind === 'const' ? entry.init : null, source: entry });
    }
    for (const specifier of statement.specifiers ?? []) {
      if (specifier.exportKind === 'type') continue;
      const name = specifier.exported?.name ?? specifier.exported?.value;
      if (name === 'default' || HTTP_METHODS.has(name)) exports.push({ method: name === 'default' ? '*' : name,
        value: statement.source ? null : specifier.local, source: specifier });
    }
  }
  const defaultExport = exports.find(entry => entry.method === '*');
  const isFunction = (value: AstNode) => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(resolve(value)?.type) || Boolean(factory(value));
  const http = defaultExport ? isFunction(defaultExport.value) : exports.length > 0;
  return { resolve, factory, http, exports: defaultExport ? [defaultExport] : exports };
}

/** Statically identifiable functional APIs need HTTP, not component metadata. */
export async function isHttpHandlerModule(code: string): Promise<boolean> {
  const parser = await loadParseSync();
  const program = parser && parsedProgram(parser, code);
  return Boolean(program && apiSyntax(program).http);
}

export interface ApiContractFact {
  method: string;
  declaration: 'defineApi' | 'unvalidated' | 'unknown';
  inputLocations: string[] | null;
  output: 'json' | 'response' | 'unknown';
  authorization: 'declared' | 'none' | 'unknown';
  source: { file: string; line: number };
  reason: string;
}
/** Structural contracts only: the compiler never imports schemas, guards or handlers. */
export async function inspectApiContractsFromAst(code: string, file = 'page.ts') {
  const parser = await loadParseSync();
  const program = parser && parsedProgram(parser, code);
  if (!program) return { status: 'unknown' as const, methods: [] as ApiContractFact[], reason: 'Module syntax could not be parsed.' };
  const syntax = apiSyntax(program);
  if (!syntax.http) return { status: 'unknown' as const, methods: [] as ApiContractFact[], reason: 'The module is not a statically identifiable native HTTP API.' };
  const object = (node: AstNode) => {
    const value = syntax.resolve(node);
    if (value?.type !== 'ObjectExpression' || value.properties.some((p: AstNode) => p.type !== 'Property' || p.computed || p.kind !== 'init')) return null;
    return new Map<string, AstNode>(value.properties.map((p: AstNode) => [p.key.name ?? p.key.value, p.value]));
  };
  const methods: ApiContractFact[] = syntax.exports.map(entry => {
    const call = syntax.factory(entry.value);
    const options = call?.arguments?.length === 1 && object(call.arguments[0]);
    const input = options && options.has('input') ? object(options.get('input')) : new Map();
    const resolved = Boolean(options && input && [...input.keys()].every(key => ['params', 'query', 'body'].includes(key)));
    return { method: entry.method, declaration: call ? 'defineApi' : syntax.resolve(entry.value) ? 'unvalidated' : 'unknown',
      inputLocations: call && resolved ? [...input!.keys()] : null,
      output: call && options ? options.has('output') ? 'json' : 'response' : 'unknown',
      authorization: call && options ? options.has('authorize') ? 'declared' : 'none' : 'unknown',
      source: { file, line: lineNumberAt(code, entry.source.start) },
      reason: resolved ? 'Declared locations; schema behavior and callback authorization require runtime validation.'
        : call ? 'Dynamic or spread API declaration; contract details are unknown.' : 'No defineApi declaration; runtime validation is not asserted.' };
  });
  return { status: 'resolved' as const, methods, reason: 'Effective exports follow native router precedence; schema values are not evaluated.' };
}

/** Compiler-backed cache declarations. Never evaluate config modules or callbacks. */
export async function inspectCacheConfigFromAst(code: string, variables?: Record<string, string>) {
    if (code.length > 512 * 1024) return { status: 'unknown' as const, reason: 'Cache configuration exceeds inspection limits.', stores: [] };
    const parser = await loadParseSync();
    const program = parser && parsedProgram(parser, code);
    const unknown = (reason: string) => ({ status: 'unknown' as const, reason });
    if (!program || code.length > 512 * 1024) return { ...unknown('Cache configuration could not be parsed within inspection limits.'), stores: [] };
    const constants = new Map<string, AstNode>();
    for (const statement of program.body) {
        const declaration = statement.declaration ?? statement;
        if (declaration.type === 'VariableDeclaration' && declaration.kind === 'const') {
            for (const entry of declaration.declarations) if (entry.id?.type === 'Identifier') constants.set(entry.id.name, entry.init);
        }
    }
    const unwrap = (node: AstNode) => {
        for (let count = 0; count < 16 && ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(node?.type); count++) node = node.expression;
        return node;
    };
    const isPureInitializer = (node: AstNode): boolean => {
        if (!node || typeof node !== 'object') return true;
        if (['ArrowFunctionExpression', 'FunctionExpression'].includes(node.type)) return true;
        if (['CallExpression', 'NewExpression', 'AssignmentExpression', 'UpdateExpression', 'AwaitExpression',
            'TaggedTemplateExpression', 'SpreadElement', 'MemberExpression', 'BinaryExpression',
            'UnaryExpression', 'LogicalExpression', 'ConditionalExpression'].includes(node.type)) return false;
        return Object.values(node).every(value => Array.isArray(value)
            ? value.every(isPureInitializer) : isPureInitializer(value));
    };
    const constantsStable = program.body.every((entry: AstNode) => {
        if (entry.type === 'ImportDeclaration') return true;
        const declaration = entry.declaration ?? entry;
        if (declaration.type === 'VariableDeclaration') return declaration.kind === 'const' &&
            declaration.declarations.every((value: AstNode) => value.id?.type === 'Identifier' && isPureInitializer(value.init));
        if (entry.type === 'ExportDefaultDeclaration') return isPureInitializer(declaration);
        return ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'FunctionDeclaration'].includes(declaration.type) ||
            declaration.type === 'TSModuleDeclaration' && declaration.declare === true;
    });
    const resolve = (input: AstNode, names = new Set<string>()): AstNode => {
        const node = unwrap(input);
        if (node?.type !== 'Identifier' || node.name === 'undefined') return node;
        if (names.has(node.name) || !constants.has(node.name)) return null;
        // A later top-level mutation/call can invalidate a const object's initial value.
        if (!constantsStable) return null;
        return resolve(constants.get(node.name), new Set([...names, node.name]));
    };
    let root = resolve(program.body.find((entry: AstNode) => entry.type === 'ExportDefaultDeclaration')?.declaration);
    let envName: string | undefined;
    if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(root?.type)) {
        const first = root.params?.[0];
        const envProperty = first?.type === 'ObjectPattern' ? first.properties.find((p: AstNode) => !p.computed && (p.key?.name ?? p.key?.value) === 'env') : undefined;
        if (envProperty?.value?.type === 'Identifier') envName = envProperty.value.name;
        if (root.body.type === 'BlockStatement') {
            root = root.body.body.length === 1 && root.body.body[0].type === 'ReturnStatement' ? resolve(root.body.body[0].argument) : null;
        } else root = resolve(root.body);
    }
    const objectFields = (input: AstNode): Map<string, AstNode> | null => {
        const node = resolve(input);
        if (node?.type !== 'ObjectExpression' || node.properties.some((p: AstNode) => p.type !== 'Property' || p.computed || p.method || p.kind !== 'init')) return null;
        const entries: Array<[string, AstNode]> = [];
        for (const property of node.properties) {
            const key = property.key.name ?? property.key.value;
            if (typeof key !== 'string' || key === '__proto__') return null;
            entries.push([key, property.value]);
        }
        return new Map(entries); // Last literal declaration wins, like JavaScript.
    };
    const fields = objectFields(root);
    const stores = fields && objectFields(fields.get('stores'));
    if (!fields || !stores) return { ...unknown('Cache default/stores must be statically resolvable object declarations; spreads, mutations and dynamic helpers remain unknown.'), stores: [] };
    let nodes = 0;
    const read = (input: AstNode, depth = 0): { status: 'resolved'; value: any } | { status: 'unknown'; reason: string } => {
        if (++nodes > 4096 || depth > 16) return unknown('Inspection expression limits exceeded.');
        const node = resolve(input);
        if (node?.type === 'Literal') return { status: 'resolved', value: node.value };
        if (node?.type === 'Identifier' && node.name === 'undefined') return { status: 'resolved', value: undefined };
        if (node?.type === 'UnaryExpression' && ['-', '+'].includes(node.operator) && typeof node.argument.value === 'number') return { status: 'resolved', value: node.operator === '-' ? -node.argument.value : node.argument.value };
        if (node?.type === 'CallExpression' && envName && node.callee.type === 'Identifier' && node.callee.name === envName) {
            const key = node.arguments[0]?.value;
            // Only public selection settings are used; arbitrary secret lookups are unknown.
            if (!variables || !['CACHE_DRIVER', 'CACHE_BINDING', 'CACHE_DO_BINDING'].includes(key) || node.arguments.length > 2) return unknown('Environment selection is outside the inspected public variables.');
            return Object.hasOwn(variables, key) ? { status: 'resolved', value: variables[key] }
                : node.arguments.length === 2 ? (() => {
                    const fallback = read(node.arguments[1], depth + 1);
                    return fallback.status === 'resolved' ? { ...fallback, value: fallback.value ?? '' } : fallback;
                })() : { status: 'resolved', value: '' };
        }
        if (node?.type === 'ArrayExpression' && !node.elements.some((entry: AstNode) => !entry || entry.type === 'SpreadElement')) {
            const items = node.elements.map((entry: AstNode) => read(entry, depth + 1));
            return items.every((item: any) => item.status === 'resolved') ? { status: 'resolved', value: items.map((item: any) => item.value) } : unknown('Array values are dynamic.');
        }
        const object = objectFields(node);
        if (object) {
            const result = Object.create(null);
            for (const [key, expression] of object) {
                const item = read(expression, depth + 1); if (item.status !== 'resolved') return item;
                result[key] = item.value;
            }
            return { status: 'resolved', value: result };
        }
        return unknown('Expression cannot be resolved without executing application code.');
    };
    const selection = read(fields.get('default'));
    return { status: 'resolved' as const, selection, stores: [...stores].map(([name, expression]) => {
        const declaration = objectFields(expression);
        const location = { line: lineNumberAt(code, expression.start) };
        if (!declaration) return { name, location, status: 'unknown' as const, reason: 'Store declaration is dynamic.' };
        return { name, location, status: 'resolved' as const, driver: read(declaration.get('driver')),
            binding: declaration.has('binding') ? read(declaration.get('binding')) : { status: 'resolved' as const, value: undefined },
            requires: declaration.has('requires') ? read(declaration.get('requires')) : { status: 'resolved' as const, value: undefined } };
    }) };
}

/** Conservative candidates: registration calls may occur only at runtime or in unused modules. */
export async function inspectStorageOverridesFromAst(code: string) {
    if (code.length > 512 * 1024) return { status: 'unknown' as const, cache: ['*'], rateLimit: true, cacheDefault: true };
    const parser = await loadParseSync(); const program = parser && parsedProgram(parser, code);
    if (!program || code.length > 512 * 1024) return { status: 'unknown' as const, cache: ['*'], rateLimit: true, cacheDefault: true };
    const aliases = new Map<string, 'cache' | 'rate-limit'>(); const namespaces = new Map<string, string>();
    const cacheAliases = new Set<string>();
    for (const statement of program.body) {
        if (statement.type !== 'ImportDeclaration') continue;
        const source = statement.source.value;
        for (const specifier of statement.specifiers) {
            if (specifier.type === 'ImportNamespaceSpecifier') namespaces.set(specifier.local.name, source);
            const name = specifier.imported?.name ?? specifier.imported?.value;
            if (['@cossackframework/framework', '@cossackframework/framework/cache'].includes(source) && name === 'extendCacheDriver') aliases.set(specifier.local.name, 'cache');
            if (['@cossackframework/framework', '@cossackframework/framework/cache'].includes(source) && name === 'cache') cacheAliases.add(specifier.local.name);
            if (source === '@cossackframework/core' && name === 'setRateLimitStore') aliases.set(specifier.local.name, 'rate-limit');
        }
    }
    const cache = new Set<string>(); let rateLimit = false, cacheDefault = false;
    const isCache = (node: AstNode): boolean => node?.type === 'Identifier' ? cacheAliases.has(node.name)
        : node?.type === 'MemberExpression' && (node.computed ? node.property?.value : node.property?.name) === 'cache'
            && ['@cossackframework/framework', '@cossackframework/framework/cache'].includes(namespaces.get(node.object?.name) ?? '');
    const kind = (node: AstNode) => {
        if (node?.type === 'Identifier') return aliases.get(node.name);
        if (node?.type !== 'MemberExpression' || !namespaces.has(node.object?.name)) return undefined;
        const property = node.computed ? node.property?.value : node.property?.name;
        const source = namespaces.get(node.object.name);
        return property === 'extendCacheDriver' && ['@cossackframework/framework', '@cossackframework/framework/cache'].includes(source ?? '') ? 'cache'
            : property === 'setRateLimitStore' && source === '@cossackframework/core' ? 'rate-limit' : undefined;
    };
    const visit = (node: AstNode) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'ImportDeclaration') return;
        const markNamespace = (source: string) => {
            if (['@cossackframework/framework', '@cossackframework/framework/cache'].includes(source)) {
                cache.add('*'); cacheDefault = true;
            } else if (source === '@cossackframework/core') rateLimit = true;
        };
        if (node.type === 'Identifier' && namespaces.has(node.name)) { markNamespace(namespaces.get(node.name)!); return; }
        if (node.type === 'MemberExpression' && namespaces.has(node.object?.name) && !kind(node) && !isCache(node)) {
            if (node.computed && typeof node.property?.value !== 'string') {
                markNamespace(namespaces.get(node.object.name)!); visit(node.property);
            }
            return;
        }
        if (node.type === 'MemberExpression' && isCache(node.object)) {
            const property = node.computed ? node.property?.value : node.property?.name;
            if (property === 'setDefaultStore' || property === undefined) cacheDefault = true;
            // Reading ordinary cache operations is not a default-store override.
            return;
        }
        // An escaped cache facade can be mutated by a helper; keep selection unknown.
        if (isCache(node)) { cacheDefault = true; return; }
        if (node.type === 'CallExpression' && kind(node.callee)) {
            if (kind(node.callee) === 'rate-limit') rateLimit = true;
            else cache.add(node.arguments[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string' ? node.arguments[0].value : '*');
            for (const argument of node.arguments) visit(argument);
            return;
        }
        const reference = kind(node);
        if (reference) { if (reference === 'cache') cache.add('*'); else rateLimit = true; return; }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) for (const item of value) visit(item);
            else if (value && typeof value === 'object') visit(value);
        }
    };
    visit(program);
    return { status: 'resolved' as const, cache: [...cache], rateLimit, cacheDefault };
}
