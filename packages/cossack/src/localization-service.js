/** Read-only localization analysis. Never imports or executes application code. */
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript-api';

const LOCALE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const MODULES = new Set(['@cossackframework/core', '@cossackframework/framework']);
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const MAX_FILES = 4096;
const MAX_BYTES = 16 * 1024 * 1024;
const diagnostic = (code, severity, message, extra = {}) => ({ code: `COSSACK_LANG_${code}`, severity, message, ...extra });
const parameters = value => [...new Set([...value.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)].map(m => m[1].toLowerCase()))].sort();
const bindingNames = name => ts.isIdentifier(name) ? [name.text] : ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name) ? name.elements.flatMap(element => ts.isBindingElement(element) ? bindingNames(element.name) : []) : [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function validateLocalizationLocale(locale) {
  if (typeof locale !== 'string' || !LOCALE.test(locale)) throw Object.assign(new Error('Use a language code such as en or pt-BR.'), { code: 'COSSACK_LANG_LOCALE_INVALID' });
  return locale;
}

export async function inspectLocalization(root, { locale = 'en' } = {}) {
  validateLocalizationLocale(locale);
  root = path.resolve(root);
  const diagnostics = [];
  const files = new Map();
  let bytes = 0;
  let scanned = 0;
  const relative = file => path.relative(root, file).split(path.sep).join('/');
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++scanned > MAX_FILES * 4) { diagnostics.push(diagnostic('SOURCE_LIMIT', 'error', 'Localization source exceeds the scan limit.')); return; }
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) { diagnostics.push(diagnostic('SOURCE_UNSAFE', 'error', 'Symbolic links are not scanned.', { file: relative(file) })); continue; }
      if (entry.isDirectory()) { if (!['node_modules', '.git', '.cossack', 'dist'].includes(entry.name)) await walk(file); }
      else if (entry.isFile() && (CODE.test(entry.name) || dir === path.join(root, 'src/lang') && entry.name.endsWith('.json'))) {
        const stat = await fs.stat(file);
        if (stat.size > 1024 * 1024 || files.size >= MAX_FILES || bytes + stat.size > MAX_BYTES) {
          diagnostics.push(diagnostic('SOURCE_LIMIT', 'error', 'Localization source exceeds the scan limit.', { file: relative(file) })); continue;
        }
        const text = await fs.readFile(file, 'utf8');
        bytes += Buffer.byteLength(text);
        files.set(file, text);
      }
    }
  }
  const src = path.join(root, 'src');
  try {
    const stat = await fs.lstat(src);
    if (stat.isSymbolicLink() || !stat.isDirectory()) diagnostics.push(diagnostic('SOURCE_UNSAFE', 'error', 'The source directory must be a regular directory.', { file: 'src' }));
    else await walk(src);
  } catch (error) { if (error.code !== 'ENOENT') diagnostics.push(diagnostic('SOURCE_READ_FAILED', 'error', 'Cannot read localization sources.')); }
  const catalogs = new Map();
  for (const [file, text] of files) if (path.dirname(file) === path.join(root, 'src/lang') && file.endsWith('.json')) {
    const code = path.basename(file, '.json');
    if (!LOCALE.test(code)) { diagnostics.push(diagnostic('LOCALE_INVALID', 'error', 'Catalog filename must contain a language code.', { file: relative(file) })); continue; }
    try {
      const catalog = JSON.parse(text);
      if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog) || Object.values(catalog).some(value => typeof value !== 'string')) throw new Error();
      catalogs.set(code, catalog);
    } catch { diagnostics.push(diagnostic('CATALOG_INVALID', 'error', 'Catalog must be a JSON object with string values.', { file: relative(file), locale: code })); }
  }
  const base = catalogs.get(locale);
  if (!base) diagnostics.push(diagnostic('DEFAULT_MISSING', 'error', 'The selected default catalog is missing or invalid.', { locale, file: `src/lang/${locale}.json` }));
  const asts = new Map([...files].filter(([file]) => CODE.test(file)).map(([file, text]) => [file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)]));
  const resolveModule = (file, specifier) => {
    if (!specifier.startsWith('.')) return undefined;
    const stem = path.resolve(path.dirname(file), specifier);
    for (const candidate of [stem, ...['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'].map(ext => stem + ext), stem.replace(/\.js$/, '.ts')]) if (asts.has(candidate)) return candidate;
  };
  function isTranslationExport(file, name, seen = new Set()) {
    const token = `${file}:${name}`;
    if (seen.has(token)) return false;
    seen.add(token);
    const tree = asts.get(file);
    if (!tree) return false;
    for (const statement of tree.statements) {
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) if (!element.isTypeOnly && element.name.text === name) {
          const local = (element.propertyName ?? element.name).text;
          for (const declaration of tree.statements) if (ts.isImportDeclaration(declaration) && !declaration.importClause?.isTypeOnly && ts.isStringLiteral(declaration.moduleSpecifier)) {
            const bindings = declaration.importClause?.namedBindings;
            if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) if (!binding.isTypeOnly && binding.name.text === local) {
              const original = (binding.propertyName ?? binding.name).text;
              const specifier = declaration.moduleSpecifier.text;
              if (MODULES.has(specifier) && original === '__' || isTranslationExport(resolveModule(file, specifier), original, seen)) return true;
            }
          }
        }
      }
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const specifier = statement.moduleSpecifier.text;
        if (!statement.exportClause) {
          if (MODULES.has(specifier) && name === '__' || isTranslationExport(resolveModule(file, specifier), name, seen)) return true;
        } else if (ts.isNamedExports(statement.exportClause)) for (const element of statement.exportClause.elements) if (!element.isTypeOnly && element.name.text === name) {
          const original = (element.propertyName ?? element.name).text;
          if (MODULES.has(specifier) && original === '__' || isTranslationExport(resolveModule(file, specifier), original, seen)) return true;
        }
      }
    }
    return false;
  }
  const calls = [];
  const unresolved = [];
  for (const [file, tree] of asts) {
    if (tree.parseDiagnostics.length) { diagnostics.push(diagnostic('SOURCE_INVALID', 'error', 'Cannot parse localization source.', { file: relative(file) })); continue; }
    const imports = new Set();
    const namespaces = new Set();
    const declarations = new Set();
    for (const statement of tree.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const module = statement.moduleSpecifier.text;
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
          declarations.add(element.name.text);
          const original = (element.propertyName ?? element.name).text;
          if (!statement.importClause?.isTypeOnly && !element.isTypeOnly && (MODULES.has(module) && original === '__' || isTranslationExport(resolveModule(file, module), original))) imports.add(element.name.text);
        }
        if (bindings && ts.isNamespaceImport(bindings)) { declarations.add(bindings.name.text); if (!statement.importClause?.isTypeOnly && (MODULES.has(module) || isTranslationExport(resolveModule(file, module), '__'))) namespaces.add(bindings.name.text); }
        if (statement.importClause?.name) declarations.add(statement.importClause.name.text);
      }
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) declarations.add(statement.name.text);
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) for (const name of bindingNames(declaration.name)) declarations.add(name);
    }
    function shadows(node, name) {
      for (let scope = node.parent; scope && scope !== tree; scope = scope.parent) {
        if (ts.isFunctionLike(scope)) {
          if (scope.name && ts.isIdentifier(scope.name) && scope.name.text === name) return true;
          if (scope.parameters.some(param => bindingNames(param.name).includes(name))) return true;
        }
        if (ts.isCatchClause(scope) && scope.variableDeclaration && bindingNames(scope.variableDeclaration.name).includes(name)) return true;
        if ((ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) && scope.initializer && ts.isVariableDeclarationList(scope.initializer) && scope.initializer.declarations.some(declaration => bindingNames(declaration.name).includes(name))) return true;
        if (ts.isBlock(scope)) for (const statement of scope.statements) {
          if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) return true;
          if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => bindingNames(declaration.name).includes(name))) return true;
        }
      }
      return false;
    }
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        const identifier = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.name.text === '__' && namespaces.has(expression.expression.text) ? expression.expression.text : undefined;
        if (identifier && !shadows(node, identifier) && (imports.has(identifier) || namespaces.has(identifier) || identifier === '__' && !declarations.has('__'))) {
          const position = tree.getLineAndCharacterOfPosition(node.getStart(tree));
          const location = { file: relative(file), line: position.line + 1, column: position.character + 1 };
          const key = node.arguments[0];
          if (key && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))) {
            const params = node.arguments[1];
            const names = params && ts.isObjectLiteralExpression(params) && !params.properties.some(property => ts.isSpreadAssignment(property) || property.name && ts.isComputedPropertyName(property.name))
              ? params.properties.map(property => property.name?.text).filter(Boolean) : params ? null : [];
            calls.push({ key: key.text, ...location, parameters: names });
          } else unresolved.push(location);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  for (const location of unresolved) diagnostics.push(diagnostic('DYNAMIC_KEY', 'warning', 'Translation key is dynamic; check it explicitly.', location));
  const contracts = Object.create(null);
  for (const [code, catalog] of catalogs) for (const [key, value] of Object.entries(catalog)) {
    const variants = value.split('|');
    const params = parameters(value);
    const plural = variants.length > 1;
    const location = { file: `src/lang/${code}.json`, locale: code, key };
    if (!value.trim()) diagnostics.push(diagnostic('TRANSLATION_EMPTY', 'error', 'Translation is empty.', location));
    if (variants.length > 6 || variants.some(variant => !variant.trim())) diagnostics.push(diagnostic('PLURAL_INVALID', 'error', 'Plural translations require one to six nonempty variants.', location));
    if (variants.some(variant => !same(parameters(variant), params))) diagnostics.push(diagnostic('PLURAL_PARAMETERS', 'error', 'Every plural variant must use the same placeholders.', location));
    if (code === locale) contracts[key] = { parameters: [...new Set([...params, ...(plural ? ['count'] : [])])].sort(), plural };
    if (base && Object.hasOwn(base, key)) {
      const expected = parameters(base[key]);
      if (!same(params, expected)) diagnostics.push(diagnostic('PLACEHOLDERS_MISMATCH', 'error', 'Translation placeholders differ from the default catalog.', location));
      if (plural !== base[key].includes('|')) diagnostics.push(diagnostic('PLURAL_MISMATCH', 'error', 'Plural translation must preserve the default plural contract.', location));
    } else if (base) diagnostics.push(diagnostic('KEY_NOT_IN_DEFAULT', 'warning', 'Locale key is absent from the default catalog.', location));
  }
  if (base) for (const [code, catalog] of catalogs) if (code !== locale) for (const key of Object.keys(base)) if (!Object.hasOwn(catalog, key)) diagnostics.push(diagnostic('KEY_MISSING', 'error', 'Locale key is missing; runtime will use the default catalog.', { file: `src/lang/${code}.json`, locale: code, key, fallback: locale }));
  const used = new Set(calls.map(call => call.key));
  for (const call of calls) {
    if (!base || !Object.hasOwn(base, call.key)) diagnostics.push(diagnostic('KEY_UNKNOWN', 'error', 'Translation key is absent from the default catalog.', call));
    else if (call.parameters === null) diagnostics.push(diagnostic('DYNAMIC_PARAMETERS', 'warning', 'Translation parameters are dynamic; check them explicitly.', { key: call.key, file: call.file, line: call.line, column: call.column }));
    else {
      const missing = contracts[call.key].parameters.filter(name => !call.parameters.some(param => param.toLowerCase() === name));
      if (missing.length) diagnostics.push(diagnostic('PARAMETERS_MISSING', 'error', 'Translation call lacks required parameters.', { key: call.key, file: call.file, line: call.line, column: call.column, parameters: missing }));
    }
  }
  if (base) for (const key of Object.keys(base)) if (!used.has(key)) diagnostics.push(diagnostic('KEY_UNUSED', 'warning', 'Default catalog key has no statically discovered call.', { key, file: `src/lang/${locale}.json`, uncertain: unresolved.length > 0 }));
  return { defaultLocale: locale, fallbackLocale: locale, sourceDirectory: 'src', catalogs: [...catalogs.keys()].sort(), calls, unresolved, contracts, diagnostics, valid: !diagnostics.some(item => item.severity === 'error') };
}

export function generateLocalizationTypes(report) {
  if (!report.valid) throw Object.assign(new Error('Fix localization errors before generating types.'), { code: 'COSSACK_LANG_CHECK_FAILED' });
  const entries = Object.entries(report.contracts).sort(([a], [b]) => a.localeCompare(b)).map(([key, contract]) => {
    const params = contract.parameters.map(name => `${JSON.stringify(name)}: ${name === 'count' && contract.plural ? 'number' : 'string | number'}`).join('; ');
    return `    ${JSON.stringify(key)}: { ${params} };`;
  });
  return `// Generated by cossack lang types. Do not edit.\nimport '@cossackframework/core';\ndeclare module '@cossackframework/core' {\n  interface CossackTranslationRegistry {\n${entries.join('\n')}\n  }\n}\nexport {};\n`;
}
