/** Node-only metadata inspection. Never imports or evaluates application modules. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { discoverConfigSources } from './config-codegen.js';
import { normalizeConfigRequirements, type ConfigRequirements, type ConfigRequirementDiagnostic } from './config-requirements.js';

type AstNode = any;
export interface ConfigFactoryInspection {
  key: string;
  source: string;
  status: 'none' | 'declared' | 'unknown' | 'invalid';
  requirements?: ConfigRequirements;
  diagnostics: ConfigRequirementDiagnostic[];
}
const unwrap = (input: AstNode): AstNode => {
  let node = input;
  for (let count = 0; count < 32 && ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(node?.type); count++) node = node.expression;
  return node;
};
/** Binding names, not property keys, determine runtime named exports. */
function bindsRequirements(pattern: AstNode): boolean {
  if (pattern?.type === 'Identifier') return pattern.name === 'requirements';
  if (pattern?.type === 'AssignmentPattern') return bindsRequirements(pattern.left);
  if (pattern?.type === 'RestElement') return bindsRequirements(pattern.argument);
  if (pattern?.type === 'ArrayPattern') return pattern.elements.some(bindsRequirements);
  if (pattern?.type === 'ObjectPattern') return pattern.properties.some((entry: AstNode) =>
    bindsRequirements(entry.type === 'RestElement' ? entry.argument : entry.value));
  return false;
}
/** Only data syntax is accepted, with bounded depth and size. */
function literal(input: AstNode, budget = { nodes: 0 }, depth = 0): unknown {
  const node = unwrap(input);
  if (++budget.nodes > 4096 || depth > 16) throw new Error('dynamic');
  if (node?.type === 'Literal' && (['string', 'number', 'boolean'].includes(typeof node.value) || node.value === null)) return node.value;
  if (node?.type === 'ArrayExpression') {
    return node.elements.map((entry: AstNode) => literal(entry, budget, depth + 1));
  }
  if (node?.type !== 'ObjectExpression') throw new Error('dynamic');
  const result = Object.create(null);
  for (const property of node.properties) {
    if (property.type !== 'Property' || property.computed || property.method || property.kind !== 'init') throw new Error('dynamic');
    const key = property.key?.name ?? property.key?.value;
    if (typeof key !== 'string' || key === '__proto__') throw new Error('dynamic');
    result[key] = literal(property.value, budget, depth + 1);
  }
  return result;
}

/** Mutations, escaped objects and top-level effects invalidate literal initializers. */
function stableModule(program: AstNode): boolean {
  return program.body.every((statement: AstNode) => {
    if (statement.type === 'ImportDeclaration') return true;
    const declaration = statement.declaration ?? statement;
    if (['FunctionDeclaration', 'TSInterfaceDeclaration', 'TSTypeAliasDeclaration'].includes(declaration.type)) return true;
    if (declaration.type === 'TSModuleDeclaration' && declaration.declare) return true;
    if (statement.type === 'ExportNamedDeclaration' && !statement.declaration) return !statement.source;
    if (statement.type === 'ExportDefaultDeclaration') return ['ArrowFunctionExpression', 'FunctionExpression', 'Identifier'].includes(unwrap(declaration)?.type);
    if (declaration.type !== 'VariableDeclaration' || declaration.kind !== 'const') return false;
    return declaration.declarations.every((entry: AstNode) => {
      if (entry.id?.type !== 'Identifier') return false;
      if (['ArrowFunctionExpression', 'FunctionExpression'].includes(unwrap(entry.init)?.type)) return true;
      try { literal(entry.init); return true; } catch { return false; }
    });
  });
}

export async function inspectConfigRequirements(root: string): Promise<{ factories: ConfigFactoryInspection[]; diagnostics: ConfigRequirementDiagnostic[] }> {
  let parser: typeof import('vite').parseSync | undefined;
  try { parser = (await import('vite')).parseSync; } catch { /* unavailable is explicit */ }
  const factories: ConfigFactoryInspection[] = [];
  for (const { key, source: file } of discoverConfigSources(root)) {
    const row: ConfigFactoryInspection = { key, source: file, status: 'none', diagnostics: [] };
    const fail = (status: 'unknown' | 'invalid') => {
      row.status = status;
      row.diagnostics.push({ code: status === 'unknown' ? 'COSSACK_CONFIG_REQUIREMENTS_UNKNOWN' : 'COSSACK_CONFIG_REQUIREMENTS_INVALID', severity: 'error', name: 'requirements', kind: 'metadata', source: row.source,
        message: status === 'unknown' ? 'Configuration requirements could not be established from static literal metadata.' : 'Configuration requirements do not match the supported metadata schema.' });
    };
    try {
      const source = await readFile(resolve(root, row.source), 'utf8');
      if (!parser || source.length > 512 * 1024) { fail('unknown'); factories.push(row); continue; }
      const parsed = parser(file, source);
      if (parsed.errors?.length || !parsed.program) { fail('unknown'); factories.push(row); continue; }
      const program = parsed.program as AstNode;
      const constants = new Map<string, AstNode>();
      const exports: AstNode[] = [];
      let ambiguous = false;
      for (const statement of program.body) {
        const declaration = statement.declaration ?? statement;
        if (declaration.type === 'VariableDeclaration' && declaration.kind === 'const') {
          for (const entry of declaration.declarations) if (entry.id?.type === 'Identifier') constants.set(entry.id.name, entry.init);
        }
        if (statement.type === 'ExportAllDeclaration') ambiguous = true;
        if (statement.type !== 'ExportNamedDeclaration' || statement.exportKind === 'type') continue;
        if (declaration.type !== 'VariableDeclaration' && declaration.id?.name === 'requirements') exports.push(null);
        if (declaration.type === 'VariableDeclaration') for (const entry of declaration.declarations) {
          if (bindsRequirements(entry.id)) exports.push(declaration.kind === 'const' && entry.id.type === 'Identifier' ? entry.init : null);
        }
        for (const specifier of statement.specifiers ?? []) {
          if (specifier.exportKind !== 'type' && (specifier.exported?.name ?? specifier.exported?.value) === 'requirements') {
            exports.push(statement.source ? null : specifier.local);
          }
        }
      }
      if (!exports.length && !ambiguous) { factories.push(row); continue; }
      if (exports.length !== 1 || !stableModule(program)) { fail('unknown'); factories.push(row); continue; }
      let expression = unwrap(exports[0]);
      if (expression?.type === 'Identifier') expression = unwrap(constants.get(expression.name));
      let value: unknown;
      try { value = literal(expression); } catch { fail('unknown'); factories.push(row); continue; }
      try { row.requirements = normalizeConfigRequirements(value); row.status = 'declared'; } catch { fail('invalid'); }
    } catch { fail('unknown'); }
    factories.push(row);
  }
  return { factories, diagnostics: factories.flatMap(factory => factory.diagnostics) };
}
