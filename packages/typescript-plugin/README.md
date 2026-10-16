# @cossackframework/typescript-plugin

A TypeScript language service plugin for Cossack `html` and `svg` templates.
It shows the diagnostics of `cossack check templates` in the editor and
completes markup inside templates:

- Errors and warnings appear as TypeScript diagnostics: malformed markup,
  bindings that render nothing, unknown attributes, wrong attribute, event,
  `?boolean` and `.property` values, and component tag props.
- Hints appear as suggestions, such as a `component()` call that can be a
  component tag.
- Completions: tag names, end tags, attributes, `@events`, `.properties`,
  `?booleans`, enumerated attribute values and component tag props.

Generated applications include it. To add it to another project:

```bash
pnpm add -D @cossackframework/typescript-plugin
```

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@cossackframework/typescript-plugin" }]
  }
}
```

TypeScript loads language service plugins in its JavaScript server (tsserver).
VS Code runs its own tsserver, so let it find the plugin in the project's
`node_modules` (generated applications ship this in `.vscode/settings.json`):

```json
{ "typescript.tsserver.pluginPaths": ["."] }
```

The TypeScript 7 native compiler (`tsc`) does not run language service
plugins; builds check templates through `cossack check templates` and the Vite
plugin instead.
