import fs from 'node:fs';
import path from 'node:path';

const unknown = (reason, services = []) => ({ method: 'typescript-source', status: 'unknown', services, reason });
const resolved = (services = []) => ({ method: 'typescript-source', status: 'resolved', services });

function exported(node, ts, kind) {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === kind);
}

function classDeclaration(ts, node) {
  return ts.isClassDeclaration(node) || ts.isClassExpression(node);
}

function moduleResolution(ts, root) {
  const options = {
    allowJs: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
  };
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) return { options, reason: undefined };
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) return { options, reason: 'The project tsconfig.json could not be read.' };
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configPath), undefined, configPath);
  if (parsed.errors.length) return { options, reason: 'The project tsconfig.json could not be parsed.' };
  return { options: { ...options, ...parsed.options }, reason: undefined };
}

function createResolver(ts, root, options) {
  const cache = new Map();

  function read(file) {
    const absolute = path.resolve(file);
    if (cache.has(absolute)) return cache.get(absolute);
    const code = fs.readFileSync(absolute, 'utf8');
    const extension = path.extname(absolute).toLowerCase();
    const scriptKind = extension === '.tsx' ? ts.ScriptKind.TSX
      : extension === '.jsx' ? ts.ScriptKind.JSX
        : ['.js', '.mjs', '.cjs'].includes(extension) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const source = ts.createSourceFile(absolute, code, ts.ScriptTarget.Latest, true, scriptKind);
    if (source.parseDiagnostics?.length) throw new Error('TypeScript source contains syntax errors.');
    const record = { file: absolute, source, code };
    cache.set(absolute, record);
    return record;
  }

  function moduleFile(from, specifier) {
    if (!specifier) return undefined;
    const result = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule;
    return result?.resolvedFileName;
  }

  function localBinding(record, name, visited = new Set()) {
    const key = `${record.file}#${name}`;
    if (visited.has(key)) return undefined;
    visited.add(key);
    const { source } = record;
    for (const statement of source.statements) {
      if (classDeclaration(ts, statement) && statement.name?.text === name) {
        return { file: record.file, name: statement.name.text, declaration: statement };
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer) continue;
          if (classDeclaration(ts, declaration.initializer)) {
            return { file: record.file, name: declaration.initializer.name?.text ?? name, declaration: declaration.initializer };
          }
          if (ts.isIdentifier(declaration.initializer)) return localBinding(record, declaration.initializer.text, visited);
          if (ts.isPropertyAccessExpression(declaration.initializer)) return resolveExpression(record, declaration.initializer, visited);
        }
      }
    }
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const clause = statement.importClause;
      const target = moduleFile(record.file, statement.moduleSpecifier.text);
      if (!clause || !target) continue;
      if (clause.name?.text === name) return clause.isTypeOnly ? undefined : resolveExport(target, 'default');
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name && !clause.isTypeOnly) {
        return { namespace: true, file: target, name };
      }
      if (bindings && ts.isNamedImports(bindings)) {
        const item = bindings.elements.find(element => element.name.text === name);
        if (item) {
          if (clause.isTypeOnly || item.isTypeOnly) return undefined;
          return resolveExport(target, item.propertyName?.text ?? item.name.text);
        }
      }
    }
    return undefined;
  }

  function resolveExport(file, name, visited = new Set()) {
    const absolute = path.resolve(file);
    const key = `${absolute}#${name}`;
    if (visited.has(key)) return undefined;
    visited.add(key);
    let record;
    try { record = read(absolute); } catch { return undefined; }
    const { source } = record;

    for (const statement of source.statements) {
      if (classDeclaration(ts, statement) && statement.name?.text === name && exported(statement, ts, ts.SyntaxKind.ExportKeyword)) {
        return { file: absolute, name: statement.name.text, declaration: statement };
      }
      if (name === 'default' && classDeclaration(ts, statement) && exported(statement, ts, ts.SyntaxKind.DefaultKeyword)) {
        return { file: absolute, name: statement.name?.text ?? 'anonymous', declaration: statement };
      }
      if (name === 'default' && ts.isExportAssignment(statement) && !statement.isExportEquals) {
        if (classDeclaration(ts, statement.expression)) {
          return { file: absolute, name: statement.expression.name?.text ?? 'anonymous', declaration: statement.expression };
        }
        if (ts.isIdentifier(statement.expression)) return localBinding(record, statement.expression.text);
      }
    }

    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement) || !statement.exportClause) continue;
      if (!ts.isNamedExports(statement.exportClause)) continue;
      const item = statement.exportClause.elements.find(element => element.name.text === name);
      if (!item) continue;
      const local = item.propertyName?.text ?? item.name.text;
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = moduleFile(absolute, statement.moduleSpecifier.text);
        return target ? resolveExport(target, local, visited) : undefined;
      }
      return localBinding(record, local);
    }

    if (name !== 'default') {
      for (const statement of source.statements) {
        if (ts.isExportDeclaration(statement) && !statement.isTypeOnly &&
            statement.exportClause && ts.isNamespaceExport(statement.exportClause) &&
            statement.exportClause.name.text === name && statement.moduleSpecifier &&
            ts.isStringLiteral(statement.moduleSpecifier)) {
          const target = moduleFile(absolute, statement.moduleSpecifier.text);
          if (target) return { namespace: true, file: target, name };
        }
        if (!ts.isExportDeclaration(statement) || statement.exportClause || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const target = moduleFile(absolute, statement.moduleSpecifier.text);
        const found = target && resolveExport(target, name, visited);
        if (found) return found;
      }
    }
    return undefined;
  }

  function resolveExpression(record, expression, visited) {
    if (ts.isIdentifier(expression)) return localBinding(record, expression.text, visited);
    if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression)) return undefined;
    const binding = localBinding(record, expression.expression.text, visited);
    if (!binding?.namespace) return undefined;
    return resolveExport(binding.file, expression.name.text);
  }

  return { read, localBinding, moduleFile, resolveExport, resolveExpression };
}

function recognizedPageDecorator(ts, record, declaration) {
  const aliases = new Set(['Page']);
  const namespaces = new Set();
  for (const statement of record.source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== '@cossackframework/core' || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        if (item.propertyName?.text === 'Page' || !item.propertyName && item.name.text === 'Page') aliases.add(item.name.text);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
  }
  const decorators = ts.canHaveDecorators(declaration) ? ts.getDecorators(declaration) ?? [] : [];
  return decorators.find(decorator => {
    let expression = decorator.expression;
    if (ts.isCallExpression(expression)) expression = expression.expression;
    if (ts.isIdentifier(expression)) return aliases.has(expression.text);
    return ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) &&
      namespaces.has(expression.expression.text) && expression.name.text === 'Page';
  });
}

function recognizedServiceDecorator(ts, record, declaration) {
  const aliases = new Set();
  const namespaces = new Set();
  for (const statement of record.source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== '@cossackframework/core' || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        if ((item.propertyName?.text ?? item.name.text) === 'Service' && !item.isTypeOnly) aliases.add(item.name.text);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
  }
  const decorators = ts.canHaveDecorators(declaration) ? ts.getDecorators(declaration) ?? [] : [];
  return decorators.find(decorator => {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression)) return false;
    if (ts.isIdentifier(expression.expression)) return aliases.has(expression.expression.text);
    return ts.isPropertyAccessExpression(expression.expression) &&
      ts.isIdentifier(expression.expression.expression) &&
      namespaces.has(expression.expression.expression.text) && expression.expression.name.text === 'Service';
  });
}

function serviceRegistration(ts, resolver, token) {
  const visited = new Set();
  while (token?.declaration) {
    const key = `${token.file}#${token.name}`;
    if (visited.has(key)) return 'unknown';
    visited.add(key);
    const record = resolver.read(token.file);
    const decorators = ts.canHaveDecorators(token.declaration) ? ts.getDecorators(token.declaration) ?? [] : [];
    if (recognizedServiceDecorator(ts, record, token.declaration)) return 'declared';
    if (decorators.length) return 'unknown';
    const base = token.declaration.heritageClauses
      ?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
    if (!base) return 'missing';
    token = resolver.resolveExpression(record, base.expression);
  }
  return 'unknown';
}

function serviceOptions(ts, record, declaration, resolver) {
  const decorator = recognizedPageDecorator(ts, record, declaration);
  if (!decorator) {
    const decorators = ts.canHaveDecorators(declaration) ? ts.getDecorators(declaration) ?? [] : [];
    if (decorators.length) return { error: 'A class decorator identity is unresolved, so inherited service ownership cannot be inferred.' };
    return { inherited: declaration.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0], value: undefined };
  }
  const call = decorator.expression;
  if (!ts.isCallExpression(call)) return { error: 'The @Page decorator must be called with an options object.' };
  if (!call.arguments.length) return { value: [] };
  const options = call.arguments[0];
  if (!ts.isObjectLiteralExpression(options)) return { error: 'The @Page options are not an object literal.' };
  if (options.properties.some(property => !ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name))) {
    return { error: 'Spread or computed @Page options can change the service declarations.' };
  }
  const property = options.properties.filter(item =>
    ts.isIdentifier(item.name) || ts.isStringLiteral(item.name) ? item.name.text === 'services' : false).at(-1);
  if (!property) return { value: [] };
  if (!ts.isArrayLiteralExpression(property.initializer)) return { error: 'The services option is not a static array.' };
  const tokens = [];
  for (const expression of property.initializer.elements) {
    if (!ts.isIdentifier(expression) && !ts.isPropertyAccessExpression(expression)) {
      return { error: `Service expression '${expression.getText(record.source)}' is dynamic.`, tokens };
    }
    const token = resolver.resolveExpression(record, expression);
    if (!token?.declaration) {
      return { error: `Service expression '${expression.getText(record.source)}' does not resolve to one class declaration.`, tokens };
    }
    const serviceSource = resolver.read(token.file);
    const position = token.declaration.getStart(serviceSource.source);
    const line = serviceSource.source.getLineAndCharacterOfPosition(position).line + 1;
    const relative = path.relative(resolver.root, token.file).split(path.sep).join('/');
    const source = relative === '..' || relative.startsWith('../') ? `external:${relative}` : `/${relative}`;
    tokens.push({
      expression: expression.getText(record.source), className: token.name, source, line,
      serviceDecorator: serviceRegistration(ts, resolver, token),
    });
  }
  return { value: tokens };
}

function classFromModule(resolver, file, name) {
  let binding = resolver.resolveExport(file, name);
  if (!binding) {
    try {
      const record = resolver.read(file);
      binding = resolver.localBinding(record, name);
    } catch { return undefined; }
  }
  if (!binding?.declaration) return undefined;
  return binding;
}

function inheritedPageServices(ts, resolver, root, filePath) {
  let record;
  try { record = resolver.read(path.resolve(root, filePath.slice(1))); }
  catch { return unknown('The layout source could not be read.'); }
  let token = classFromModule(resolver, record.file, 'default');
  if (!token) return unknown('The default layout export does not resolve to a class declaration.');
  const visited = new Set();
  while (token) {
    const key = `${token.file}#${token.name}`;
    if (visited.has(key)) return unknown('The layout inheritance chain contains a cycle.');
    visited.add(key);
    const sourceRecord = resolver.read(token.file);
    const page = serviceOptions(ts, sourceRecord, token.declaration, resolver);
    if (page.error) return unknown(page.error, page.tokens ?? []);
    if (page.value !== undefined) return resolved(page.value);
    const heritage = page.inherited;
    if (!heritage) return resolved([]);
    const base = resolver.resolveExpression(sourceRecord, heritage.expression);
    if (!base?.declaration) return unknown(`Inherited layout base '${heritage.expression.getText(sourceRecord.source)}' does not resolve to one class declaration.`);
    token = base;
  }
  return unknown('The layout inheritance chain could not be resolved.');
}

/** Resolve layout service expressions through static imports without executing modules. */
export async function inspectServiceOwnership(root, layoutPaths) {
  const results = new Map();
  if (!layoutPaths.length) return results;
  let ts;
  try { ts = (await import('typescript-api')).default; }
  catch {
    for (const filePath of layoutPaths) results.set(filePath, unknown('The TypeScript parser is unavailable.'));
    return results;
  }
  const config = moduleResolution(ts, root);
  if (config.reason) {
    for (const filePath of layoutPaths) results.set(filePath, unknown(config.reason));
    return results;
  }
  const resolver = createResolver(ts, root, config.options);
  resolver.root = root;
  for (const filePath of layoutPaths) {
    try { results.set(filePath, inheritedPageServices(ts, resolver, root, filePath)); }
    catch { results.set(filePath, unknown('Static compiler analysis could not resolve the service declarations.')); }
  }
  return results;
}
