import fs from 'node:fs/promises';
import path from 'node:path';

/** Resolve relative TypeScript base declarations without evaluating modules. */
export async function resolveImportedInheritance(code, compilerId, displayFile, facts) {
  if (facts.inheritance?.status !== 'unresolved' || !facts.inheritance.bases.length) return facts;
  const { parseSync } = await import('vite');
  const { inspectCompilerMethods } = await import('@cossackframework/framework/vite-security-plugin');
  const visited = new Set();
  const declarations = [...facts.inheritedDeclarations];
  const names = facts.inheritance.bases.slice(0, -1);
  const root = compilerId.endsWith(displayFile) ? compilerId.slice(0, -displayFile.length) : path.dirname(compilerId);
  const display = file => '/' + path.relative(root, file).split(path.sep).join('/');
  const parse = source => {
    const result = parseSync('inheritance.ts', source);
    if (result.errors?.length) throw new Error('Unparseable base');
    return result.program;
  };
  async function moduleFile(from, specifier) {
    if (typeof specifier !== 'string' || !specifier.startsWith('.')) throw new Error('Non-relative base');
    const target = path.resolve(path.dirname(from), specifier);
    const candidates = /\.(?:mts|ts)$/.test(target) ? [target]
      : target.endsWith('.mjs') ? [target.slice(0, -4) + '.mts']
        : target.endsWith('.js') ? [target.slice(0, -3) + '.ts']
          : path.extname(target) ? []
            : [target + '.ts', target + '.mts', path.join(target, 'index.ts'), path.join(target, 'index.mts')];
    const matches = [];
    for (const candidate of candidates) {
      try { if ((await fs.stat(candidate)).isFile()) matches.push(candidate); } catch { /* try next */ }
    }
    if (matches.length === 1) return matches[0];
    throw new Error('Missing or ambiguous base source');
  }
  async function imported(source, file, local) {
    const statement = parse(source).body.find(s => s.type === 'ImportDeclaration' && s.specifiers.some(p => p.local?.name === local));
    if (!statement) throw new Error('Unresolved base name');
    const specifier = statement.specifiers.find(p => p.local?.name === local);
    const exported = specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported?.name ?? specifier.imported?.value;
    if (!exported) throw new Error('Unsupported namespace base');
    return exportedClass(await moduleFile(file, statement.source.value), exported);
  }
  async function exportedClass(file, exported) {
    const key = `${file}#${exported}`;
    if (visited.has(key)) throw new Error('Cyclic inheritance or exports');
    visited.add(key);
    const source = await fs.readFile(file, 'utf8');
    const program = parse(source);
    let local;
    for (const statement of program.body) {
      if (statement.type === 'ExportDefaultDeclaration' && exported === 'default') {
        local = statement.declaration.id?.name ?? statement.declaration.name ?? 'Anonymous';
      }
      if (statement.type !== 'ExportNamedDeclaration') continue;
      if (statement.declaration?.id?.name === exported) local = exported;
      const alias = statement.specifiers?.find(p => (p.exported?.name ?? p.exported?.value) === exported);
      if (alias) {
        const name = alias.local?.name ?? alias.local?.value;
        if (statement.source) return exportedClass(await moduleFile(file, statement.source.value), name);
        local = name;
      }
    }
    if (!local) throw new Error('Missing explicit class export');
    const result = inspectCompilerMethods(source, file);
    if (result.diagnostics.length) throw new Error('Unsupported base metadata');
    const cls = result.classes.find(c => c.name === local);
    if (!cls) return imported(source, file, local);
    const append = base => {
      declarations.push({ className: base.name, members: base.members, methods: base.methods.map(m => ({ ...m, source: { ...m.source, file: display(file) } })) });
      names.push(base.name);
    };
    append(cls);
    for (const name of cls.inheritance.bases) {
      const base = result.classes.find(c => c.name === name);
      if (base) append(base);
    }
    if (cls.inheritance.status === 'resolved') return;
    const unresolved = cls.inheritance.bases.at(-1);
    if (!unresolved || result.classes.some(c => c.name === unresolved)) throw new Error('Unresolved local chain');
    await imported(source, file, unresolved);
  }
  try {
    await imported(code, compilerId, facts.inheritance.bases.at(-1));
    return { ...facts, inheritance: { status: 'resolved', bases: names }, inheritedDeclarations: declarations };
  } catch {
    return { ...facts, inheritedDeclarations: declarations };
  }
}
