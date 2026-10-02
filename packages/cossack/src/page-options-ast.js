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
    if (key === 'transport' && property.value.type === 'Literal' && typeof property.value.value === 'string') {
      options.transport = property.value.value;
    } else if (key === 'ssg' && property.value.type === 'Literal' && typeof property.value.value === 'boolean') {
      options.ssg = property.value.value;
    } else if (key === 'ssg' && property.value.type === 'ObjectExpression') {
      const properties = property.value.properties;
      // Spreads/computed keys may replace enabled. Never infer a default from
      // their apparent absence, and use the last static key like JavaScript.
      if (properties.some(p => p.type !== 'Property' || p.computed)) {
        unresolved.push('ssg spread or computed options');
      } else {
        const enabled = properties.filter(p => (p.key?.name ?? p.key?.value) === 'enabled').at(-1);
        if (!enabled) options.ssg = true;
        else if (enabled.value.type === 'Literal' && typeof enabled.value.value === 'boolean') options.ssg = enabled.value.value;
        else unresolved.push('ssg.enabled');
      }
    } else if (key === 'middlewares' && property.value.type === 'ArrayExpression' && !property.value.elements.some(e => !e || e.type === 'SpreadElement')) {
      options.middlewares = property.value.elements.length;
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

/** Own-method classification from the same analysis used by the compiler. */
export async function extractMethodClassificationsFromAst(code, file = 'page.ts') {
  const parseSync = await loadParseSync();
  if (!parseSync) return null;
  const program = parsedProgram(parseSync, code);
  if (!program) return { methods: [], reason: 'The file could not be parsed as TypeScript.' };
  const selected = pageClass(program, code);
  if (!selected) return { methods: [], reason: 'No @Page class found; method classification is unavailable.' };
  let inspectCompilerMethods;
  try {
    ({ inspectCompilerMethods } = await import('@cossackframework/framework/vite-security-plugin'));
  } catch {
    return { methods: [], reason: 'Compiler inspection metadata is unavailable; build or update the framework package.' };
  }
  if (typeof inspectCompilerMethods !== 'function') {
    return { methods: [], reason: 'The framework package does not expose compiler inspection metadata.' };
  }
  const result = inspectCompilerMethods(code, file);
  if (result.diagnostics.length) {
    return { methods: [], reason: result.diagnostics.map(d => d.message).join(' ') };
  }
  const facts = result.classes.find(cls => cls.name === (selected.cls.id?.name ?? 'Anonymous'));
  if (!facts) return { methods: [], reason: 'The compiler did not identify the selected page class.' };
  return {
    method: 'compiler',
    methods: facts.methods.map(fact => ({
      ...fact,
      kind: fact.rpc ? 'server' : fact.clientBody === 'retained' ? 'client' : 'stripped',
      line: fact.source.line,
    })),
    reason: 'Own methods classified by the compiler; inherited declarations require project resolution.',
  };
}
