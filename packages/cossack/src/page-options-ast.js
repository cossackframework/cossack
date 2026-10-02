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

/** Walk the ESTree body; visit every node through `enter`. */
function walk(node, enter, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  enter(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'range') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.type === 'string') walk(item, enter, node);
      }
    } else if (value && typeof value.type === 'string') {
      walk(value, enter, node);
    }
  }
}

function lineNumberAt(code, index) {
  return code.slice(0, index).split('\n').length;
}

/** Identifier names the source imports as an alias of `Page` from core. */
function pageDecoratorAliases(program, code) {
  const aliases = new Set(['Page']);
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    const source = sourceText(statement.source, code);
    if (!source.includes('@cossackframework/core')) continue;
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
  for (const property of objectExpression.properties ?? []) {
    if (property.type !== 'Property' || property.key.type !== 'Identifier') continue;
    const key = property.key.name;
    if (key === 'transport' && property.value.type === 'Literal') {
      options.transport = property.value.value;
    } else if (key === 'ssg' && (property.value.type === 'Literal')) {
      options.ssg = property.value.value === true;
    } else if (key === 'middlewares' && property.value.type === 'ArrayExpression') {
      options.middlewares = (property.value.elements ?? []).filter(Boolean).length;
    } else if (key === 'services' && property.value.type === 'ArrayExpression') {
      options.services = (property.value.elements ?? [])
        .filter(element => element && element.type === 'Identifier')
        .map(element => element.name);
    }
  }
  return options;
}

/**
 * Parse `code` and extract the first @Page decorator's options. Returns
 * `{ options, method, reason }`: `method` is `ast` on success, `unknown`
 * when the options object is dynamic (an identifier or spread), and `null`
 * when no parser is available (the caller falls back to regex).
 */
export async function extractPageOptionsFromAst(code) {
  const parseSync = await loadParseSync();
  if (!parseSync) return null;
  let program;
  try {
    // oxc parseSync takes (filename, sourceText); the extension selects TS.
    program = parseSync('page.ts', code).program;
  } catch {
    return { options: null, method: 'unknown', reason: 'The file could not be parsed as TypeScript.' };
  }
  const aliases = pageDecoratorAliases(program, code);
  let decoratorCall = null;
  let decoratorLine = null;
  walk(program, (node, parent) => {
    if (decoratorCall) return;
    const isDecorator =
      (node.type === 'Decorator' && node.expression?.type === 'CallExpression') ||
      (node.type === 'CallExpression' && parent?.type === 'Decorator');
    if (!isDecorator) return;
    const call = node.type === 'Decorator' ? node.expression : node;
    if (call.callee?.type !== 'Identifier' || !aliases.has(call.callee.name)) return;
    decoratorCall = call;
    decoratorLine = lineNumberAt(code, call.start);
  });
  if (!decoratorCall) return { options: null, method: 'unknown', reason: 'No @Page decorator found.' };

  const argument = decoratorCall.arguments?.[0]?.expression ?? decoratorCall.arguments?.[0];
  if (!argument) {
    return { options: readOptionsObject({ properties: [] }, code), method: 'ast', decoratorLine };
  }
  if (argument.type === 'ObjectExpression') {
    return { options: readOptionsObject(argument, code), method: 'ast', decoratorLine };
  }
  return {
    options: null,
    method: 'unknown',
    decoratorLine,
    reason: `The @Page options are ${argument.type === 'Identifier' ? `the identifier ${argument.name}` : 'a dynamic expression'} and cannot be resolved statically.`,
  };
}
