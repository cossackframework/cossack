/**
 * AST-backed @Page option extraction (CLI-04/RT-07/RT-12).
 *
 * The regex heuristic in scan-routes misreports nested option objects,
 * comments, string text containing option-like content, trailing commas,
 * aliased decorators, and dynamic (identifier) option objects. This module
 * parses the real syntax tree through Vite's re-exported oxc parser
 * (`parseSync`) and reports `unknown` with a reason for options it cannot
 * resolve statically. When the parser is unavailable (for example the CLI
 * runs outside a project with vite installed), callers fall back to the
 * regex heuristic and the extraction records its method.
 */

let parseSyncLoader;

async function loadParseSync() {
  if (parseSyncLoader !== undefined) return parseSyncLoader;
  parseSyncLoader = import('vite')
    .then(vite => vite.parseSync)
    .catch(() => null);
  return parseSyncLoader;
}

function sourceText(node, code) {
  return code.slice(node.start, node.end);
}

function lineNumberAt(code, index) {
  return code.slice(0, index).split('\n').length;
}

/** Identifier names the source imports as an alias of `Page` from core. */
function pageDecoratorAliases(program) {
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
function readOptionsObject(objectExpression, code) {
  const options = { transport: null, ssg: null, middlewares: 0, services: [] };
  const unresolved = [];
  for (const property of objectExpression.properties ?? []) {
    if (property.type !== 'Property' || property.computed) {
      unresolved.push('spread or computed options');
      continue;
    }
    const key = property.key.name ?? property.key.value;
    if (key === 'transport' && property.value.type === 'Literal') {
      options.transport = property.value.value;
    } else if (key === 'ssg' && (property.value.type === 'Literal')) {
      options.ssg = property.value.value === true;
    } else if (key === 'ssg' && property.value.type === 'ObjectExpression') {
      const enabled = property.value.properties.find(p => (p.key?.name ?? p.key?.value) === 'enabled');
      if (!enabled) options.ssg = true;
      else if (enabled.value.type === 'Literal') options.ssg = enabled.value.value === true;
      else unresolved.push('ssg.enabled');
    } else if (key === 'middlewares' && property.value.type === 'ArrayExpression' && !property.value.elements.some(e => e?.type === 'SpreadElement')) {
      options.middlewares = (property.value.elements ?? []).filter(Boolean).length;
    } else if (key === 'services' && property.value.type === 'ArrayExpression') {
      options.services = (property.value.elements ?? [])
        .filter(Boolean).map(element => sourceText(element, code));
      if (property.value.elements.some(e => e?.type === 'SpreadElement' || !['Identifier', 'MemberExpression'].includes(e?.type))) unresolved.push('services');
    } else if (['transport', 'ssg', 'middlewares', 'services'].includes(key)) {
      unresolved.push(key);
    }
  }
  return { options, unresolved };
}

function parsedProgram(parseSync, code) {
  try {
    const result = parseSync('page.ts', code);
    return result.errors?.length ? null : result.program;
  } catch { return null; }
}

function pageClass(program, code) {
  const aliases = pageDecoratorAliases(program);
  const namespaces = new Set(program.body.filter(s => s.type === 'ImportDeclaration' &&
    s.source?.value === '@cossackframework/core').flatMap(s => s.specifiers
      .filter(p => p.type === 'ImportNamespaceSpecifier').map(p => p.local.name)));
  const candidates = [];
  for (const statement of program.body) {
    const cls = statement.declaration ?? statement;
    if (!['ClassDeclaration', 'ClassExpression'].includes(cls.type)) continue;
    const decorator = (cls.decorators ?? []).find(d => {
      const callee = d.expression?.type === 'CallExpression' ? d.expression.callee : d.expression;
      return callee?.type === 'Identifier' && aliases.has(callee.name) ||
        callee?.type === 'MemberExpression' && namespaces.has(callee.object?.name) && callee.property?.name === 'Page';
    });
    if (decorator) candidates.push({ cls, decorator, exported: statement.type.startsWith('Export') });
  }
  return candidates.find(c => c.exported) ?? candidates[0];
}

/**
 * Parse `code` and extract the exported @Page class's options. Returns
 * `{ options, method, reason }`: `method` is `ast` on success, `unknown`
 * when the options object is dynamic (an identifier or spread), and `null`
 * when no parser is available (the caller falls back to regex).
 */
export async function extractPageOptionsFromAst(code) {
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

/**
 * Per-method RPC classification (CLI-04): list each decorated method with
 * the reason it becomes a server proxy, client method, or shared method on
 * this page. Purely syntactic — no module execution.
 */
export async function extractMethodClassificationsFromAst(code) {
  const parseSync = await loadParseSync();
  if (!parseSync) return null;
  const program = parsedProgram(parseSync, code);
  if (!program) {
    return { methods: [], reason: 'The file could not be parsed as TypeScript.' };
  }
  const aliases = new Map();
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    if (statement.source?.value !== '@cossackframework/core') continue;
    for (const specifier of statement.specifiers ?? []) {
      if (specifier.type === 'ImportSpecifier' && specifier.imported?.name) {
        aliases.set(specifier.local.name, specifier.imported.name);
      }
    }
  }
  const methods = [];
  const selected = pageClass(program, code);
  if (!selected) return { methods: [], reason: 'No @Page class found; method classification is unavailable.' };
  for (const node of selected.cls.body.body) {
    if (node.type !== 'MethodDefinition' && node.type !== 'PropertyDefinition') continue;
    const decorators = node.decorators ?? [];
    if (!decorators.length) continue;
    const names = decorators
      .map(decorator => {
        const expression = decorator.expression?.type === 'CallExpression' ? decorator.expression.callee : decorator.expression;
        return expression?.type === 'Identifier' ? (aliases.get(expression.name) ?? expression.name) : null;
      })
      .filter(Boolean);
    const kind = names.includes('Shared') ? 'shared'
      : names.some(n => ['Client', 'ClientTask', 'Optimistic', 'Computed', 'On', 'OnEvent', 'OnWindow', 'OnDocument', 'PreventNavigation', 'Validate', 'VisibleTask', 'Task'].includes(n)) ? 'client'
      : names.includes('Server') ? 'server'
      : null;
    if (!kind) continue;
    const key = node.key?.type === 'Identifier' ? node.key.name
      : node.key?.type === 'Literal' ? String(node.key.value) : '(computed)';
    methods.push({
      name: key,
      kind,
      reason: kind === 'server'
        ? '@Server() methods execute on the server; the client calls an RPC proxy.'
        : kind === 'client'
          ? 'A client-safe decorator preserves this method in the browser instead of installing a server proxy.'
          : '@Shared() methods execute on both sides without transport.',
      line: lineNumberAt(code, node.start),
    });
  }
  return { methods, reason: 'Decorated methods only; automatic RPC and transitive preservation require compiler metadata.' };
}
