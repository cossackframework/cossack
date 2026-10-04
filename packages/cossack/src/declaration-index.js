import path from 'node:path';
import fs from 'node:fs/promises';
import ts from 'typescript-api';
import { createHash } from 'node:crypto';

const format = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias;
const signatureFormat = ts.TypeFormatFlags.NoTruncation;

/** Index installed declaration modules, without tsconfig plugins or runtime imports. */
export async function indexDeclarations(folder, exports, { symbol: selectedSymbol } = {}) {
  const canonical = await fs.realpath(folder);
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true,
    strict: true, skipLibCheck: false, types: [], allowImportingTsExtensions: true,
  };
  const resolutions = [];
  for (const entry of exports) for (const target of entry.targets) {
    if (!['present', 'missing'].includes(target.status) || !/\.(?:[cm]?js|d\.[cm]?ts)$/.test(target.target)) continue;
    const resolved = ts.resolveModuleName(target.target, path.join(folder, '__cossack_catalog__.ts'), compilerOptions, ts.sys).resolvedModule;
    const file = resolved?.resolvedFileName;
    resolutions.push({ import: entry.import ?? entry.subpath, conditions: target.conditions, target: target.target,
      file: file ? path.relative(folder, file).split(path.sep).join('/') : null,
      status: file ? /\.d\.[cm]?ts$/.test(file) ? 'declaration' : 'source-not-indexed' : 'missing',
    });
  }
  const indexedImports = new Set(resolutions.filter(item => item.status === 'declaration').map(item => item.import));
  const unresolvedImports = [...new Set(resolutions.filter(item => !indexedImports.has(item.import)).map(item => item.import))];
  const files = [...new Set(resolutions.filter(item => item.status === 'declaration').map(item => path.resolve(folder,item.file)))];
  if (!files.length) return { compilerVersion: ts.version, status: 'unavailable', resolutions, unresolvedImports, entries: [], diagnostics: [], diagnosticCount: 0 };
  const program = ts.createProgram(files, compilerOptions);
  const checker = program.getTypeChecker();
  const localPath = file => {
    for (const base of [folder, canonical]) {
      const relative = path.relative(base, file);
      if (relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) return relative.split(path.sep).join('/');
    }
    return null;
  };
  const source = declaration => {
    if (!declaration) return null;
    const file = declaration.getSourceFile();
    const { line, character } = file.getLineAndCharacterOfPosition(declaration.getStart());
    return { file: localPath(file.fileName), line: line + 1, column: character + 1 };
  };
  const signatures = (type, kind, declaration) => checker.getSignaturesOfType(type, kind)
    .filter(signature => {
      const node = signature.getDeclaration();
      return !node || !(ts.getCombinedModifierFlags(node) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected));
    })
    .map(signature => checker.signatureToString(signature, declaration, signatureFormat));
  const isPublic = symbol => !(symbol.declarations ?? []).some(declaration => {
    const flags = ts.getCombinedModifierFlags(declaration);
    return !!(flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) || declaration.name?.kind === ts.SyntaxKind.PrivateIdentifier;
  });
  const documentation = symbol => ({
    documentation: ts.displayPartsToString(symbol.getDocumentationComment(checker)),
    tags: symbol.getJsDocTags(checker).map(tag => ({ name: tag.name, text: ts.displayPartsToString(tag.text ?? []) })),
  });
  const indexSignatures = type => checker.getIndexInfosOfType(type).map(info => ({
    keyType: checker.typeToString(info.keyType, info.declaration, format),
    valueType: checker.typeToString(info.type, info.declaration, format),
    readonly: info.isReadonly, source: source(info.declaration),
  }));
  const members = (type, context) => checker.getPropertiesOfType(type).filter(isPublic).filter(symbol => symbol.name !== 'prototype').map(symbol => {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    // Remapped properties can have no declaration node. Without an owner location,
    // TypeScript returns any instead of the instantiated mapped member type.
    const location = declaration ?? context ?? program.getSourceFile(files[0]);
    const value = checker.getTypeOfSymbolAtLocation(symbol, location);
    return { name: symbol.name, ...documentation(symbol), optional: !!(symbol.flags & ts.SymbolFlags.Optional),
      type: checker.typeToString(value, declaration, format),
      callSignatures: signatures(checker.getNonNullableType(value), ts.SignatureKind.Call, declaration), source: source(declaration) };
  }).sort((a,b) => a.name.localeCompare(b.name));
  const propsContract = type => {
    const props = checker.getPropertyOfType(type, 'props');
    if (!props || !isPublic(props)) return null;
    const declaration = props.valueDeclaration ?? props.declarations?.[0];
    const value = checker.getTypeOfSymbolAtLocation(props, declaration);
    const shape = checker.getNonNullableType(value);
    const structured = !!(shape.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection | ts.TypeFlags.Union));
    return { type: checker.typeToString(value, declaration, format), source: source(declaration),
      status: !structured ? 'unknown' : shape.flags & ts.TypeFlags.Union ? 'partial' : 'declared',
      ...documentation(props), members: structured ? members(shape, declaration) : [],
      indexSignatures: structured ? indexSignatures(shape) : [],
      // Shared members alone erase required/forbidden fields in discriminated props.
      // Preserve each branch while retaining the partial marker for union contracts.
      ...(shape.flags & ts.TypeFlags.Union ? { variants: shape.types.map(variant => {
        const object = !!(variant.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection));
        return { type: checker.typeToString(variant, declaration, format),
          status: object ? 'declared' : 'unknown',
          members: object ? members(variant, declaration) : [],
          indexSignatures: object ? indexSignatures(variant) : [] };
      }) } : {}),
    };
  };
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const entries = files.map(file => {
    const sf = program.getSourceFile(file);
    const module = sf && checker.getSymbolAtLocation(sf);
    if (!module) return { file: localPath(file), status: 'not-a-module', symbols: [] };
    const publicExports = checker.getExportsOfModule(module).map(symbol => ({ name: symbol.name, symbol }));
    const assignment = sf.statements.find(statement => ts.isExportAssignment(statement) && statement.isExportEquals);
    const assigned = assignment && checker.getSymbolAtLocation(assignment.expression);
    if (assigned) publicExports.push({ name: 'export=', symbol: assigned });
    const symbols = publicExports.filter(item => selectedSymbol === undefined || item.name === selectedSymbol).map(({ name, symbol: exported }) => {
      const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const declaration = target.valueDeclaration ?? target.declarations?.[0];
      if (!declaration) return { name, status: 'unresolved', runtime: 'not-verified' };
      const typeSpace = !!(target.flags & ts.SymbolFlags.Type);
      const type = typeSpace ? checker.getDeclaredTypeOfSymbol(target) : checker.getTypeOfSymbolAtLocation(target, declaration);
      const valueType = checker.getTypeOfSymbolAtLocation(target, declaration);
      return { name, declarationName: target.name, status: 'indexed', abstract: !!(ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Abstract), declarationKind: ts.SyntaxKind[declaration.kind],
        source: source(declaration), type: checker.typeToString(type, declaration, format),
        ...documentation(target),
        indexSignatures: type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection) ? indexSignatures(type) : [],
        propsContract: target.flags & ts.SymbolFlags.Class ? propsContract(type) : null,
        callSignatures: signatures(valueType, ts.SignatureKind.Call, declaration),
        constructSignatures: signatures(valueType, ts.SignatureKind.Construct, declaration),
        members: typeSpace && (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) ? members(type, declaration) : [],
        valueMembers: !(target.flags & ts.SymbolFlags.Class) && (valueType.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) ? members(valueType, declaration) : [],
        staticMembers: target.flags & ts.SymbolFlags.Class ? members(valueType, declaration) : [],
        // A class reached through `export type *` still has a class declaration.
        // These are declaration signatures, never proof of a runtime value export.
        runtime: 'not-verified',
      };
    }).sort((a,b) => a.name.localeCompare(b.name));
    return { file: localPath(file), status: symbols.some(symbol => symbol.status === 'unresolved') ? 'partial' : 'indexed', symbols,
      ...(selectedSymbol === undefined ? {} : { availableSymbols: publicExports.map(item => item.name).sort() }) };
  });
  const declarationHash = createHash('sha256');
  for (const file of program.getSourceFiles().filter(file => !program.isSourceFileDefaultLibrary(file)).sort((a,b) => a.fileName.localeCompare(b.fileName))) {
    declarationHash.update(file.fileName).update('\0').update(file.text).update('\0');
  }
  return { compilerVersion: ts.version, resolutions, unresolvedImports,
    status: unresolvedImports.length || diagnostics.length || entries.some(entry => entry.status !== 'indexed') ? 'partial' : 'indexed',
    declarationHash: declarationHash.digest('hex'), entries,
    diagnostics: diagnostics.slice(0, 100).map(diagnostic => ({ code: diagnostic.code,
      category: ts.DiagnosticCategory[diagnostic.category].toLowerCase(),
      file: diagnostic.file ? localPath(diagnostic.file.fileName) : null,
      line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : null })),
    diagnosticCount: diagnostics.length,
  };
}
