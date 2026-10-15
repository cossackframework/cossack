/**
 * Build-time registry of realtime child components (Node only; used by the
 * Vite plugin).
 *
 * A realtime component is a class decorated with `@Component` from
 * `@cossackframework/core` whose literal options set
 * `transport: 'durable-object'`. Each one gets a stable id, `<file>#<export>`,
 * where `<file>` is its source path from the project root. The server builds a
 * realtime component only from this registry: a WebSocket upgrade names an id,
 * never a module, and the id must be registered. The SSR/worker environment
 * imports the registry through `virtual:cossack-realtime-components`; the
 * client receives nothing but the id, attached to the class.
 */
import { parseSync } from 'vite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

type AstNode = any; // Oxc nodes, narrowed by their type tags.

export const REALTIME_COMPONENTS_MODULE_ID = 'virtual:cossack-realtime-components';
/** Static property that carries a realtime component's registry id in both environments. */
export const REALTIME_COMPONENT_ID_PROPERTY = '__cossackRealtimeId';

export interface RealtimeComponentFact {
    /** Stable registry id: `<file>#<export name>`. */
    id: string;
    /** Source path from the project root, for example `/src/components/CartBadge.ts`. */
    file: string;
    /** Name the module exports the class under (`default` for a default export). */
    exportName: string;
    /** Local class binding. */
    className: string;
    line: number;
}

export interface RealtimeRegistryDiagnostic {
    code: 'COSSACK_REALTIME_COMPONENT_UNEXPORTED' | 'COSSACK_REALTIME_COMPONENT_SCOPE_REQUIRED' | 'COSSACK_REALTIME_COMPONENT_ANONYMOUS';
    message: string;
    file: string;
    line: number;
}

export interface RealtimeRegistryScan {
    components: RealtimeComponentFact[];
    diagnostics: RealtimeRegistryDiagnostic[];
}

const lineAt = (code: string, offset: number) => code.slice(0, offset).split('\n').length;

/** Local names of `Component` imported from core, and namespace imports of core. */
function componentDecorators(program: AstNode) {
    const names = new Set<string>();
    const namespaces = new Set<string>();
    for (const statement of program.body) {
        if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue;
        if (statement.source?.value !== '@cossackframework/core') continue;
        for (const specifier of statement.specifiers ?? []) {
            if (specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type' &&
                (specifier.imported?.name ?? specifier.imported?.value) === 'Component') names.add(specifier.local.name);
            if (specifier.type === 'ImportNamespaceSpecifier') namespaces.add(specifier.local.name);
        }
    }
    return { names, namespaces };
}

/** Exported names per local binding. */
function exportedNames(program: AstNode) {
    const exports = new Map<string, string[]>();
    const add = (local: string, exported: string) => exports.set(local, [...exports.get(local) ?? [], exported]);
    for (const statement of program.body) {
        if (statement.type === 'ExportNamedDeclaration' && statement.exportKind !== 'type') {
            const declaration = statement.declaration;
            if (declaration?.type === 'ClassDeclaration' && declaration.id) add(declaration.id.name, declaration.id.name);
            if (!statement.source) {
                for (const specifier of statement.specifiers ?? []) {
                    if (specifier.exportKind === 'type') continue;
                    const local = specifier.local?.name ?? specifier.local?.value;
                    const exported = specifier.exported?.name ?? specifier.exported?.value;
                    if (local && exported) add(local, exported);
                }
            }
        }
        if (statement.type === 'ExportDefaultDeclaration') {
            const declaration = statement.declaration;
            if ((declaration?.type === 'ClassDeclaration' || declaration?.type === 'ClassExpression') && declaration.id) add(declaration.id.name, 'default');
            if (declaration?.type === 'Identifier') add(declaration.name, 'default');
        }
    }
    return exports;
}

/** `{ transport: 'durable-object' }` options of one decorator, or undefined when not realtime. */
function realtimeOptions(decorator: AstNode, decorators: ReturnType<typeof componentDecorators>): { scope: boolean | null } | undefined {
    const call = decorator.expression;
    if (call?.type !== 'CallExpression') return undefined;
    const callee = call.callee;
    const isComponent = callee?.type === 'Identifier' && decorators.names.has(callee.name) ||
        callee?.type === 'MemberExpression' && !callee.computed && callee.object?.type === 'Identifier' &&
        decorators.namespaces.has(callee.object.name) && callee.property?.name === 'Component';
    if (!isComponent) return undefined;
    let options = call.arguments?.[0];
    while (['TSAsExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression'].includes(options?.type)) options = options.expression;
    if (options?.type !== 'ObjectExpression') return undefined;
    let realtime = false;
    let scope: boolean | null = false;
    for (const property of options.properties ?? []) {
        if (property.type !== 'Property' || property.computed) { if (scope === false) scope = null; continue; }
        const key = property.key?.name ?? property.key?.value;
        if (key === 'transport') realtime = property.value?.type === 'Literal' && property.value.value === 'durable-object';
        if (key === 'scope') scope = true;
    }
    return realtime ? { scope } : undefined;
}

/**
 * Realtime components declared in one module. `file` is the module's path
 * from the project root (`/src/...`).
 */
export function findRealtimeComponents(code: string, file: string): RealtimeRegistryScan {
    const result: RealtimeRegistryScan = { components: [], diagnostics: [] };
    if (!code.includes('durable-object')) return result;
    let program: AstNode;
    try {
        const parsed = parseSync(file, code);
        if (parsed.errors?.length) return result;
        program = parsed.program;
    } catch { return result; }
    const decorators = componentDecorators(program);
    if (!decorators.names.size && !decorators.namespaces.size) return result;
    const exports = exportedNames(program);
    for (const statement of program.body) {
        const declaration = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
            ? statement.declaration : statement;
        if (declaration?.type !== 'ClassDeclaration' && declaration?.type !== 'ClassExpression') continue;
        const options = (declaration.decorators ?? []).map((decorator: AstNode) => realtimeOptions(decorator, decorators)).find(Boolean);
        if (!options) continue;
        const line = lineAt(code, declaration.start);
        const className = declaration.id?.name;
        if (!className) {
            result.diagnostics.push({ code: 'COSSACK_REALTIME_COMPONENT_ANONYMOUS', file, line,
                message: `${file}:${line}: a realtime component class needs a name.` });
            continue;
        }
        const names = exports.get(className) ?? [];
        const exportName = names.includes(className) ? className : names.includes('default') ? 'default' : names[0];
        if (!exportName) {
            result.diagnostics.push({ code: 'COSSACK_REALTIME_COMPONENT_UNEXPORTED', file, line,
                message: `${file}:${line}: export the realtime component ${className}; the server builds it from the registry.` });
            continue;
        }
        if (options.scope === false) {
            result.diagnostics.push({ code: 'COSSACK_REALTIME_COMPONENT_SCOPE_REQUIRED', file, line,
                message: `${file}:${line}: the realtime component ${className} needs a scope function. Every page that embeds it ` +
                    "shares its instance per scope key. To run a child in its page's instance instead, omit transport." });
            continue;
        }
        result.components.push({ id: `${file}#${exportName}`, file, exportName, className, line });
    }
    return result;
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.cossack']);
const isSource = (name: string) => name.endsWith('.ts') && !name.endsWith('.d.ts') && !/\.(test|spec)\.ts$/.test(name);

/** Scan every TypeScript source under `<projectRoot>/src`. */
export function scanRealtimeComponents(projectRoot: string): RealtimeRegistryScan {
    const result: RealtimeRegistryScan = { components: [], diagnostics: [] };
    const source = join(projectRoot, 'src');
    const visit = (directory: string) => {
        let entries;
        try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name.startsWith('.')) continue;
            const path = join(directory, entry.name);
            if (entry.isDirectory()) { if (!SKIPPED_DIRECTORIES.has(entry.name)) visit(path); continue; }
            if (!entry.isFile() || !isSource(entry.name)) continue;
            let code: string;
            try { code = readFileSync(path, 'utf8'); } catch { continue; }
            const file = '/' + relative(projectRoot, path).replaceAll('\\', '/');
            const found = findRealtimeComponents(code, file);
            result.components.push(...found.components);
            result.diagnostics.push(...found.diagnostics);
        }
    };
    visit(source);
    return result;
}

/**
 * Source of `virtual:cossack-realtime-components`. The SSR/worker environment
 * imports exactly the registered realtime components; the client environment
 * gets an empty registry.
 */
export function realtimeRegistryModule(components: readonly RealtimeComponentFact[], ssr: boolean): string {
    if (!ssr || !components.length) return 'export default { components: {} };\n';
    const files = [...new Set(components.map(component => component.file))];
    const imports = files.map((file, index) => `import * as realtime${index} from ${JSON.stringify(file)};`);
    const entries = components.map(component =>
        `  ${JSON.stringify(component.id)}: realtime${files.indexOf(component.file)}[${JSON.stringify(component.exportName)}],`);
    return `${imports.join('\n')}\nexport default { components: {\n${entries.join('\n')}\n} };\n`;
}

/** Statements that attach each registry id to its class, appended to the declaring module. */
export function realtimeIdAssignments(components: readonly RealtimeComponentFact[]): string {
    return components.map(component => `\nif (typeof ${component.className} === 'function') Object.defineProperty(${component.className}, ` +
        `${JSON.stringify(REALTIME_COMPONENT_ID_PROPERTY)}, { value: ${JSON.stringify(component.id)} });`).join('') + (components.length ? '\n' : '');
}
