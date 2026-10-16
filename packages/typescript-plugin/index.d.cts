/**
 * TypeScript language service plugin factory, the shape tsserver loads from
 * `compilerOptions.plugins`. `modules.typescript` is the compiler module of the
 * server that loads the plugin; `create` wraps that server's language service.
 */
declare function init(modules: { typescript: any }): { create(info: any): any };
export = init;
