/**
 * Post-process TypeScript declaration output for Deno compatibility.
 *
 * Deno's strict ESM resolver requires relative declaration imports to include
 * their runtime extension (for example, `./shared/cossack.js` instead of
 * `./shared/cossack`). TypeScript can emit those imports without extensions,
 * which makes the published `core` and `renderer` types fail when they are
 * traversed by the Deno adapter or a Deno application.
 *
 * This build-time script scans only `.d.ts`, `.d.mts`, and `.d.cts` files and
 * appends `.js` to extensionless relative import/export/require specifiers. It
 * does not modify runtime JavaScript or application source files. It runs from
 * the `core` and `renderer` builds because those packages own the declarations
 * consumed by Deno; it is not a build step for `deno-adapter` itself.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createScanner,
  LanguageVariant,
  SyntaxKind,
} from 'typescript/unstable/ast';

const declarationPattern = /\.d\.(?:ts|mts|cts)$/;
const explicitExtensionPattern = /\.(?:[cm]?[jt]sx?|json|node|wasm|css)$/i;

function toRuntimeSpecifier(specifier) {
  if (!/^\.{1,2}\//.test(specifier)) return specifier;

  const suffixIndex = specifier.search(/[?#]/);
  const pathname = suffixIndex === -1 ? specifier : specifier.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? '' : specifier.slice(suffixIndex);
  if (explicitExtensionPattern.test(pathname)) return specifier;

  return `${pathname}.js${suffix}`;
}

async function declarationFiles(root) {
  const files = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (declarationPattern.test(entry.name)) files.push(entryPath);
    }
  }

  await visit(root);
  return files;
}

async function rewriteDeclaration(file) {
  const source = await readFile(file, 'utf8');
  const scanner = createScanner(true, LanguageVariant.Standard, source);
  const replacements = [];
  let previous;
  let beforePrevious;

  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    if (kind === SyntaxKind.StringLiteral) {
      const followsImportOrFrom = previous?.kind === SyntaxKind.ImportKeyword
        || previous?.kind === SyntaxKind.FromKeyword;
      const isImportOrRequireCall = previous?.kind === SyntaxKind.OpenParenToken
        && (beforePrevious?.kind === SyntaxKind.ImportKeyword
          || (beforePrevious?.kind === SyntaxKind.Identifier && beforePrevious.text === 'require'));

      if (followsImportOrFrom || isImportOrRequireCall) {
        const specifier = scanner.getTokenValue();
        const replacement = toRuntimeSpecifier(specifier);
        if (replacement !== specifier) {
          replacements.push({
            start: scanner.getTokenStart() + 1,
            end: scanner.getTokenEnd() - 1,
            replacement,
          });
        }
      }
    }

    beforePrevious = previous;
    previous = { kind, text: scanner.getTokenText() };
  }
  if (replacements.length === 0) return 0;

  let output = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, replacement.start)
      + replacement.replacement
      + output.slice(replacement.end);
  }
  await writeFile(file, output);
  return replacements.length;
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  throw new Error('Usage: node scripts/rewrite-declaration-imports.mjs <declaration-dir> [...]');
}

let rewritten = 0;
for (const root of roots) {
  for (const file of await declarationFiles(path.resolve(root))) {
    rewritten += await rewriteDeclaration(file);
  }
}

console.log(`Rewrote ${rewritten} relative declaration import${rewritten === 1 ? '' : 's'} for ESM.`);
