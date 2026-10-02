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
      const staticReference = node => node?.type === 'Identifier' ||
        node?.type === 'MemberExpression' && !node.computed && !node.optional &&
        node.property?.type === 'Identifier' && staticReference(node.object);
      if (property.value.elements.some(e => !staticReference(e))) unresolved.push('services');
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

/** Resolve only the module's default class declaration, without importing it. */
export async function inspectDefaultClassExport(code) {
  const parser = await loadParseSync();
  const program = parser && parsedProgram(parser, code);
  if (!program) return { status: 'unknown', reason: 'Module syntax could not be parsed.' };
  const direct = program.body.find(statement => statement.type === 'ExportDefaultDeclaration');
  const aliases = program.body.flatMap(statement => statement.type === 'ExportNamedDeclaration'
    ? (statement.specifiers ?? []).filter(specifier => (specifier.exported?.name ?? specifier.exported?.value) === 'default')
      .map(specifier => ({ statement, specifier })) : []);
  if (!direct && !aliases.length) return { status: 'missing', reason: 'The router requires a default-exported component class.' };
  let declaration = direct?.declaration;
  let name = declaration?.type === 'Identifier' ? declaration.name : null;
  if (!direct && aliases.length === 1 && !aliases[0].statement.source) name = aliases[0].specifier.local?.name;
  if (name) declaration = program.body.map(statement => statement.declaration ?? statement)
    .find(candidate => candidate.type === 'ClassDeclaration' && candidate.id?.name === name);
  if (declaration?.type === 'ClassDeclaration' || declaration?.type === 'ClassExpression') {
    return { status: 'resolved', className: declaration.id?.name ?? 'Anonymous', line: lineNumberAt(code, declaration.start),
      reason: 'Default export resolves to a local class declaration; component runtime validity is not checked.' };
  }
  return { status: 'unknown', reason: 'The default export does not resolve to a local class declaration.' };
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
  // The router loads the default export, not whichever decorated class appears
  // first. A helper's metadata must never stand in for an unresolved export.
  const defaultExport = program.body.find(statement => statement.type === 'ExportDefaultDeclaration');
  if (defaultExport) {
    const declaration = defaultExport.declaration;
    return candidates.find(candidate => candidate.cls === declaration ||
      declaration?.type === 'Identifier' && candidate.cls.id?.name === declaration.name);
  }
  const exportedDefault = program.body.flatMap(statement => statement.type === 'ExportNamedDeclaration'
    ? (statement.specifiers ?? []).filter(specifier => (specifier.exported?.name ?? specifier.exported?.value) === 'default')
      .map(specifier => ({ name: specifier.local?.name, external: Boolean(statement.source) })) : []);
  if (exportedDefault.length) {
    return exportedDefault.length === 1 && !exportedDefault[0].external
      ? candidates.find(candidate => candidate.cls.id?.name === exportedDefault[0].name) : undefined;
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Parse `code` and extract the exported @Page class's options. Returns
 * `{ options, method, reason }`: `method` is `ast` on success, `unknown`
 * when the options object is dynamic (an identifier or spread), and `null`
 * when no parser is available (the caller reports unknown options).
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
export async function extractMethodClassificationsFromAst(code, file = 'page.ts', compilerId = file) {
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
  const result = inspectCompilerMethods(code, compilerId);
  if (result.diagnostics.length) {
    return { methods: [], reason: result.diagnostics.map(d => d.message).join(' ') };
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
