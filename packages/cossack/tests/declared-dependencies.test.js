import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-api';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const declared = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.optionalDependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
]);
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.m?js$/.test(entry.name) ? [full] : [];
  });
}

/** Module specifiers from real import syntax (not text inside template strings). */
function specifiers(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const packageName = specifier => specifier.startsWith('@')
  ? specifier.split('/').slice(0, 2).join('/')
  : specifier.split('/')[0];

describe('runtime dependencies', () => {
  it('declares every bare import used by the published CLI sources', () => {
    const missing = [];
    const files = [...sourceFiles(path.join(packageRoot, 'src')), ...sourceFiles(path.join(packageRoot, 'bin'))];
    for (const file of files) {
      for (const specifier of specifiers(file)) {
        if (specifier.startsWith('.') || specifier.startsWith('/') || builtins.has(specifier)) continue;
        if (specifier === manifest.name || specifier.startsWith(`${manifest.name}/`)) continue;
        if (!declared.has(packageName(specifier))) missing.push(`${path.relative(packageRoot, file)}: ${specifier}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
