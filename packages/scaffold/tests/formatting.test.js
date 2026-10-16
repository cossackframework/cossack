import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { parseTemplate } from '@cossackframework/renderer/template';

const template = fileURLToPath(new URL('../template', import.meta.url));
const config = JSON.parse(await fs.readFile(path.join(template, '.prettierrc.json'), 'utf8'));
const format = (source, filepath = 'view.ts') => prettier.format(source, { ...config, filepath });

describe('generated application formatting', () => {
  it('formats every template source idempotently', async () => {
    const files = (await fs.readdir(path.join(template, 'src'), { recursive: true })).filter(file => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const source = await fs.readFile(path.join(template, 'src', file), 'utf8');
      const once = await format(source, file);
      expect(await format(once, file), file).toBe(once);
    }
  }, 120_000);

  it('formats html templates, keeps component tags, and stays idempotent', async () => {
    const source = `import { html } from '@cossackframework/renderer';
import { Button, Card } from '@cossackframework/ui';
export const view = (title: string, save: () => void) => html\`
  <main>
      <\${Card} hoverable padding="sm" title=\${title}>
    <h2>\${title}</h2>
        <\${Button} variant="ghost" @click=\${save}>Save</\${Button}>
      </\${Card}>
  </main>
\`;
export const plain = (name: string) => html\`<div class="a"   id="x"><p>Hello \${name}</p><input type="text" .value=\${name} ?disabled=\${!name}></div>\`;
`;
    const once = await format(source);
    expect(await format(once)).toBe(once);
    // Plain templates are formatted as HTML.
    expect(once).toContain('<div class="a" id="x">\n');
    expect(once).toContain('<input type="text" .value=${name} ?disabled=${!name} />');
    // Prettier cannot parse component tags as HTML, so it leaves their template as written.
    expect(once).toContain('<${Card} hoverable padding="sm" title=${title}>');
    expect(once).toContain('</${Card}>');
    // Formatted markup still parses without template problems.
    for (const literal of once.matchAll(/html`([^`]*)`/g)) {
      expect(parseTemplate(literal[1].split(/\$\{[^}]*\}/)).problems).toEqual([]);
    }
  });
});
