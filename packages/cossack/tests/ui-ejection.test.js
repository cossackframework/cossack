import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_COMPONENTS } from '../src/templates/ui.js';
import { createLinkedApp } from './fixtures/linked-app.js';
import { cossack, typecheck, vite } from './fixtures/generated-app.js';

afterEach(() => vi.restoreAllMocks());

const names = Object.keys(UI_COMPONENTS);
const relativeImports = source => [...source.matchAll(/from\s*["'](\.[^"']*)["']/g)].map(match => match[1]);
// Resolve the real UI dependency from a workspace application, as the CLI does from a consuming app.
const workspaceApp = fileURLToPath(new URL('../../framework/', import.meta.url));

describe('UI source ejection', () => {
  it.each(names)('ejects %s with every private helper it imports', (name) => {
    vi.spyOn(process, 'cwd').mockReturnValue(workspaceApp);
    const entry = UI_COMPONENTS[name];
    const source = entry.template();
    const helpers = entry.helpers();
    expect(source).not.toContain('export {};');
    expect(source).toContain(`class ${entry.className}`);
    // Ejected files land in src/components/ui; helpers in its internal/ folder.
    const provided = new Set(helpers.map(helper => `./${helper.path.replace(/\.ts$/, '')}`));
    for (const specifier of relativeImports(source)) expect([...provided], `${name} imports ${specifier}`).toContain(specifier);
    for (const helper of helpers) {
      expect(helper.path).toMatch(/^internal\/[\w-]+\.ts$/);
      for (const specifier of relativeImports(helper.content)) expect([...provided]).toContain(`./internal/${specifier.slice(2)}`);
    }
  });
});

it('ejects every catalog component into one generated app that type-checks and builds', async () => {
  const { parent, root } = await createLinkedApp({ adapter: 'node', features: ['ui'], prefix: 'cossack-ui-ejection-',
    install: ['@cossackframework/solar-icons'] });
  try {
    // One after another, as users do: later ejections share helpers written by earlier ones.
    for (const name of names) {
      try { await cossack(root, ['add', 'ui', name, '--json']); }
      catch (error) { throw new Error(`cossack add ui ${name} failed:\n${error.stdout}\n${error.stderr}`); }
    }
    const directory = path.join(root, 'src/components/ui');
    const files = (await fs.readdir(directory, { recursive: true })).filter(file => file.endsWith('.ts')).map(file => file.split(path.sep).join('/'));
    const components = names.map(name => `${UI_COMPONENTS[name].className}.ts`);
    // index.ts is the scaffold's re-export barrel for the package.
    expect(files.filter(file => !file.startsWith('internal/') && file !== 'index.ts').sort()).toEqual([...components].sort());
    const sources = new Map(await Promise.all(files.map(async file => [file, await fs.readFile(path.join(directory, file), 'utf8')])));
    for (const [file, source] of sources) {
      for (const specifier of relativeImports(source)) {
        const target = path.posix.join(path.posix.dirname(file), specifier) + '.ts';
        expect(sources.has(target), `${file} imports missing ${specifier}`).toBe(true);
      }
    }
    // Each private helper is copied once and shared by the components that use it.
    for (const helper of ['class DialogController', 'class HoverController', 'class DisclosureController', 'class MenuController']) {
      expect([...sources].filter(([, source]) => source.includes(helper)).map(([file]) => file), helper).toHaveLength(1);
    }

    const imports = names.map(name => UI_COMPONENTS[name].className)
      .map(className => `import { ${className} } from '../../components/ui/${className}';`).join('\n');
    await fs.mkdir(path.join(root, 'src/pages/ejected-ui'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/pages/ejected-ui/index.ts'), `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
${imports}

const ejected = [${names.map(name => UI_COMPONENTS[name].className).join(', ')}];

@Page({ transport: 'http' })
export default class EjectedUiPage extends Cossack {
    render() { return html\`<p>\${ejected.length} ejected UI components</p>\`; }
}
`);
    await cossack(root, ['routes', '--generate', '--json']);
    await typecheck(root, 'Ejected UI components');
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
}, 300000);
